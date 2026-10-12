"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireManager } from "@/lib/manager";
import { analyze, autoSchedule, type Kind } from "@/lib/scheduler/engine";
import { ensureSchedule, loadWeek } from "@/lib/scheduler/load";
import { KIND_LABEL, SHIFT_KINDS, WEEKDAYS } from "@/lib/constants";
import { fromIso, isIsoDate } from "@/lib/week";

type Result = { error?: string; message?: string };

function checkWeek(week: string) {
  return isIsoDate(week) && fromIso(week).getDay() === 0;
}
function parseKey(slotKey: string): [number, Kind] | null {
  const [d, k] = slotKey.split("-");
  const day = Number(d);
  return Number.isInteger(day) && day >= 0 && day <= 6 && (SHIFT_KINDS as string[]).includes(k) ? [day, k as Kind] : null;
}
const done = () => revalidatePath("/schedule");

export async function runAutoSchedule(week: string): Promise<Result> {
  if (!checkWeek(week)) return { error: "שבוע לא תקין." };
  const { branch } = await requireManager();
  const scheduleId = await ensureSchedule(branch.id, week);
  if (!scheduleId) return { error: "אין הרשאה ליצור סידור לסניף הזה." };

  const data = await loadWeek(branch.id, week);
  if (!data.ctx.slots.length) return { error: "אין משמרות פתוחות בשבוע הזה. בדקו את הגדרות הסניף." };
  if (!data.ctx.employees.length) return { error: "אין עובדים פעילים בסניף." };

  const result = autoSchedule(data.ctx, data.assignment);
  const rows = Object.entries(result).flatMap(([key, ids]) => {
    const [weekday, kind] = parseKey(key)!;
    return ids.map((member_id) => ({ member_id, weekday, kind }));
  });
  const supabase = await createClient();
  const { error } = await supabase.rpc("apply_schedule", { p_schedule: scheduleId, p_assignments: rows });
  if (error) return { error: "שמירת הסידור נכשלה. נסו שוב." };

  const r = analyze(data.ctx, result, [...WEEKDAYS], KIND_LABEL);
  done();
  const problems = r.issues.length;
  return {
    message: `הסידור נבנה: ${r.filled} מתוך ${r.total} מקומות מאוישים` +
      (problems ? (problems === 1 ? ", פריט אחד לבדיקה." : `, ${problems} פריטים לבדיקה.`) : ". אין בעיות פתוחות."),
  };
}

export async function clearSchedule(week: string): Promise<Result> {
  if (!checkWeek(week)) return { error: "שבוע לא תקין." };
  const { branch } = await requireManager();
  const supabase = await createClient();
  const { data: s } = await supabase.from("schedules").select("id").eq("branch_id", branch.id).eq("week_start", week).maybeSingle();
  if (!s) return {};
  const { error } = await supabase.rpc("apply_schedule", { p_schedule: s.id, p_assignments: [] });
  if (error) return { error: "הניקוי נכשל." };
  done();
  return { message: "השיבוצים נוקו. שיבוצים נעולים נשארו." };
}

export async function assign(week: string, slotKey: string, memberId: string): Promise<Result> {
  const k = parseKey(slotKey);
  if (!checkWeek(week) || !k) return { error: "משמרת לא תקינה." };
  const { branch } = await requireManager();
  const scheduleId = await ensureSchedule(branch.id, week);
  if (!scheduleId) return { error: "אין הרשאה." };
  const supabase = await createClient();
  const { error } = await supabase.from("assignments")
    .upsert({ schedule_id: scheduleId, member_id: memberId, weekday: k[0], kind: k[1] },
      { onConflict: "schedule_id,member_id,weekday,kind", ignoreDuplicates: true });
  if (error) return { error: "השיבוץ נכשל." };
  done();
  return {};
}

export async function unassign(week: string, slotKey: string, memberId: string): Promise<Result> {
  const k = parseKey(slotKey);
  if (!checkWeek(week) || !k) return { error: "משמרת לא תקינה." };
  const { branch } = await requireManager();
  const supabase = await createClient();
  const { data: s } = await supabase.from("schedules").select("id").eq("branch_id", branch.id).eq("week_start", week).maybeSingle();
  if (!s) return {};
  await supabase.from("assignments").delete().match({ schedule_id: s.id, member_id: memberId, weekday: k[0], kind: k[1] });
  done();
  return {};
}

export async function setLocked(week: string, slotKey: string, memberId: string, locked: boolean): Promise<Result> {
  const k = parseKey(slotKey);
  if (!checkWeek(week) || !k) return { error: "משמרת לא תקינה." };
  const { branch } = await requireManager();
  const supabase = await createClient();
  const { data: s } = await supabase.from("schedules").select("id").eq("branch_id", branch.id).eq("week_start", week).maybeSingle();
  if (!s) return {};
  await supabase.from("assignments").update({ is_locked: locked })
    .match({ schedule_id: s.id, member_id: memberId, weekday: k[0], kind: k[1] });
  done();
  return {};
}

/** This week only: how many people a shift needs. null = back to the template. */
export async function setRequired(week: string, slotKey: string, required: number | null): Promise<Result> {
  const k = parseKey(slotKey);
  if (!checkWeek(week) || !k) return { error: "משמרת לא תקינה." };
  if (required !== null && (!Number.isInteger(required) || required < 0 || required > 50)) return { error: "מספר לא תקין." };
  const { branch } = await requireManager();
  const scheduleId = await ensureSchedule(branch.id, week);
  if (!scheduleId) return { error: "אין הרשאה." };
  const supabase = await createClient();
  const key = { schedule_id: scheduleId, weekday: k[0], kind: k[1] };
  const { error } = required === null
    ? await supabase.from("slot_overrides").delete().match(key)
    : await supabase.from("slot_overrides").upsert({ ...key, required }, { onConflict: "schedule_id,weekday,kind" });
  if (error) return { error: "השמירה נכשלה." };
  done();
  return {};
}

export async function setDayClosed(week: string, weekday: number, closed: boolean): Promise<Result> {
  if (!checkWeek(week) || !Number.isInteger(weekday) || weekday < 0 || weekday > 6) return { error: "יום לא תקין." };
  const { branch } = await requireManager();
  const scheduleId = await ensureSchedule(branch.id, week);
  if (!scheduleId) return { error: "אין הרשאה." };
  const supabase = await createClient();
  const { data: s } = await supabase.from("schedules").select("closed_weekdays").eq("id", scheduleId).single();
  const set = new Set<number>((s?.closed_weekdays ?? []) as number[]);
  if (closed) set.add(weekday); else set.delete(weekday);
  await supabase.from("schedules").update({ closed_weekdays: [...set].sort() }).eq("id", scheduleId);
  if (closed) {
    // nobody works on a closed day
    await supabase.from("assignments").delete().match({ schedule_id: scheduleId, weekday });
  }
  done();
  return {};
}

export async function publish(week: string): Promise<Result> {
  if (!checkWeek(week)) return { error: "שבוע לא תקין." };
  const { branch } = await requireManager();
  const supabase = await createClient();
  const { data: s } = await supabase.from("schedules").select("id, status").eq("branch_id", branch.id).eq("week_start", week).maybeSingle();
  if (!s) return { error: "אין סידור לפרסם." };

  let affected: number;
  if (s.status === "published") {
    const { data } = await supabase.rpc("changed_since_publish", { p_schedule: s.id });
    affected = (data ?? []).length;
  } else {
    const { data } = await supabase.from("assignments").select("member_id").eq("schedule_id", s.id);
    affected = new Set((data ?? []).map((a) => a.member_id)).size;
  }
  const { error } = await supabase.from("schedules").update({ status: "published", published_at: new Date().toISOString() }).eq("id", s.id);
  if (error) return { error: "הפרסום נכשל." };
  done();
  revalidatePath("/");
  return {
    message: s.status === "published"
      ? `העדכון פורסם. ${affected} עובדים שהמשמרות שלהם השתנו יראו את השינוי.`
      : `הסידור פורסם. ${affected} עובדים רואים עכשיו את המשמרות שלהם.`,
  };
}
