import { createClient } from "@/lib/supabase/server";
import { kindsForModel, type ShiftKind } from "@/lib/constants";
import { addDays } from "@/lib/week";

export type WeekSlot = { weekday: number; kind: ShiftKind; start: string; end: string; required: number };

/**
 * The shifts that exist in a given week: the branch template, minus closed
 * days and shifts with nobody required, plus that week's overrides.
 */
export async function getWeekSlots(branchId: string, weekStart: string) {
  const supabase = await createClient();
  const [{ data: branch }, { data: template }, { data: schedule }] = await Promise.all([
    supabase.from("branches").select("shift_model, closed_weekdays").eq("id", branchId).single(),
    supabase.from("template_slots").select("weekday, kind, start_time, end_time, required").eq("branch_id", branchId),
    supabase.from("schedules").select("id, closed_weekdays, slot_overrides(weekday, kind, required)")
      .eq("branch_id", branchId).eq("week_start", weekStart).maybeSingle(),
  ]);

  const kinds = kindsForModel(branch?.shift_model ?? 2);
  const closed = new Set<number>((schedule?.closed_weekdays ?? branch?.closed_weekdays ?? []) as number[]);
  const overrides = new Map(
    ((schedule?.slot_overrides ?? []) as { weekday: number; kind: ShiftKind; required: number }[])
      .map((o) => [`${o.weekday}-${o.kind}`, o.required]),
  );

  const slots: WeekSlot[] = [];
  for (const t of (template ?? []) as { weekday: number; kind: ShiftKind; start_time: string; end_time: string; required: number }[]) {
    if (!kinds.includes(t.kind) || closed.has(t.weekday)) continue;
    const required = overrides.get(`${t.weekday}-${t.kind}`) ?? t.required;
    if (required <= 0) continue;
    slots.push({ weekday: t.weekday, kind: t.kind, start: t.start_time.slice(0, 5), end: t.end_time.slice(0, 5), required });
  }
  const dates = Array.from({ length: 7 }, (_, d) => addDays(weekStart, d));
  return { kinds, slots, closed, dates };
}
