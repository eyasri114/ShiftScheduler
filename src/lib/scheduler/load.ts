import { createClient } from "@/lib/supabase/server";
import { isMinor, kindsForModel } from "@/lib/constants";
import { addDays } from "@/lib/week";
import { makeSlot, type Assignment, type Context, type Kind } from "./engine";

export type BoardSlot = {
  key: string; weekday: number; kind: Kind; startTime: string; endTime: string;
  required: number; templateRequired: number;
};

export type WeekData = Awaited<ReturnType<typeof loadWeek>>;

/** Everything the board and the engine need for one branch-week, read with the manager's permissions. */
export async function loadWeek(branchId: string, week: string) {
  const supabase = await createClient();
  const weekEnd = addDays(week, 6);

  const [{ data: branch }, { data: template }, { data: schedule }, { data: members }] = await Promise.all([
    supabase.from("branches").select("shift_model, closed_weekdays, min_rest_hours, weekly_rest_hours, require_shift_lead")
      .eq("id", branchId).single(),
    supabase.from("template_slots").select("weekday, kind, start_time, end_time, required").eq("branch_id", branchId),
    supabase.from("schedules")
      .select("id, status, published_at, closed_weekdays, slot_overrides(weekday, kind, required), assignments(member_id, weekday, kind, is_locked)")
      .eq("branch_id", branchId).eq("week_start", week).maybeSingle(),
    supabase.from("members")
      .select("id, full_name, min_shifts, max_shifts, is_shift_lead, birth_date, allowed_kinds, rest_weekday, branch_members!inner(branch_id)")
      .eq("branch_members.branch_id", branchId).eq("is_active", true).order("full_name"),
  ]);

  const ids = (members ?? []).map((m) => m.id);
  const [{ data: avail }, { data: absences }, { data: changed }] = await Promise.all([
    ids.length ? supabase.from("availability").select("member_id, weekday, kind, level").eq("week_start", week).in("member_id", ids)
      : Promise.resolve({ data: [] }),
    ids.length ? supabase.from("absences").select("member_id, status, start_date, end_date")
      .in("member_id", ids).in("status", ["approved", "pending"]).lte("start_date", weekEnd).gte("end_date", week)
      : Promise.resolve({ data: [] }),
    schedule?.status === "published" ? supabase.rpc("changed_since_publish", { p_schedule: schedule.id })
      : Promise.resolve({ data: [] }),
  ]);

  const kinds = kindsForModel(branch?.shift_model ?? 2) as Kind[];
  const closed = ((schedule?.closed_weekdays ?? branch?.closed_weekdays ?? []) as number[]);
  const overrides = new Map(((schedule?.slot_overrides ?? []) as { weekday: number; kind: Kind; required: number }[])
    .map((o) => [`${o.weekday}-${o.kind}`, o.required]));

  // Every template shift of the week (including ones with 0 required, so the board can add them)
  const boardSlots: BoardSlot[] = ((template ?? []) as { weekday: number; kind: Kind; start_time: string; end_time: string; required: number }[])
    .filter((t) => kinds.includes(t.kind))
    .map((t) => ({
      key: `${t.weekday}-${t.kind}`, weekday: t.weekday, kind: t.kind,
      startTime: t.start_time.slice(0, 5), endTime: t.end_time.slice(0, 5),
      templateRequired: t.required, required: overrides.get(`${t.weekday}-${t.kind}`) ?? t.required,
    }));

  const ctx: Context = {
    slots: boardSlots.filter((s) => s.required > 0 && !closed.includes(s.weekday))
      .map((s) => makeSlot(s.weekday, s.kind, s.required, s.startTime, s.endTime)),
    employees: (members ?? []).map((m) => ({
      id: m.id, name: m.full_name, minShifts: m.min_shifts, maxShifts: m.max_shifts, isLead: m.is_shift_lead,
      isMinor: isMinor(m.birth_date, new Date(week + "T12:00:00")),
      allowedKinds: m.allowed_kinds as Kind[], restWeekday: m.rest_weekday,
    })),
    availability: Object.fromEntries((avail ?? []).map((a) => [`${a.member_id}|${a.weekday}-${a.kind}`, a.level])),
    absences: {},
    locked: {},
    rules: {
      minRestHours: branch?.min_rest_hours ?? 8,
      weeklyRestHours: branch?.weekly_rest_hours ?? 36,
      requireLead: branch?.require_shift_lead ?? true,
    },
  };
  for (const a of (absences ?? []) as { member_id: string; status: "approved" | "pending"; start_date: string; end_date: string }[]) {
    for (let d = 0; d < 7; d++) {
      const date = addDays(week, d);
      if (date < a.start_date || date > a.end_date) continue;
      const key = `${a.member_id}|${d}`;
      if (a.status === "approved" || !ctx.absences[key]) ctx.absences[key] = a.status;
    }
  }

  const assignment: Assignment = {};
  for (const a of (schedule?.assignments ?? []) as { member_id: string; weekday: number; kind: Kind; is_locked: boolean }[]) {
    const key = `${a.weekday}-${a.kind}`;
    (assignment[key] ??= []).push(a.member_id);
    if (a.is_locked) (ctx.locked[key] ??= []).push(a.member_id);
  }

  return {
    week, kinds, closed, boardSlots, ctx, assignment,
    schedule: schedule ? { id: schedule.id as string, status: schedule.status as "draft" | "published", publishedAt: schedule.published_at as string | null } : null,
    changedSincePublish: ((changed ?? []) as string[]),
  };
}

/** The schedule row for a branch-week, created as a draft if it doesn't exist yet. */
export async function ensureSchedule(branchId: string, week: string): Promise<string | null> {
  const supabase = await createClient();
  const { data: existing } = await supabase.from("schedules").select("id").eq("branch_id", branchId).eq("week_start", week).maybeSingle();
  if (existing) return existing.id;
  const { data: branch } = await supabase.from("branches").select("closed_weekdays").eq("id", branchId).single();
  const { data, error } = await supabase.from("schedules")
    .insert({ branch_id: branchId, week_start: week, closed_weekdays: branch?.closed_weekdays ?? [] })
    .select("id").single();
  if (error) {
    // someone else created it at the same moment
    const { data: again } = await supabase.from("schedules").select("id").eq("branch_id", branchId).eq("week_start", week).maybeSingle();
    return again?.id ?? null;
  }
  return data.id;
}
