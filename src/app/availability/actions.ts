"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { SHIFT_KINDS, type ShiftKind } from "@/lib/constants";
import { fromIso, isIsoDate } from "@/lib/week";

export type Level = "prefer" | "cannot" | null;

/** Saves one cell of the constraints grid. null = available (row removed). */
export async function setAvailability(
  memberId: string, weekStart: string, weekday: number, kind: ShiftKind, level: Level,
): Promise<{ error?: string }> {
  if (!isIsoDate(weekStart) || fromIso(weekStart).getDay() !== 0) return { error: "שבוע לא תקין." };
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || !SHIFT_KINDS.includes(kind))
    return { error: "משמרת לא תקינה." };

  const supabase = await createClient();
  const key = { member_id: memberId, week_start: weekStart, weekday, kind };

  // Row-level security decides who may change this: the employee (for weeks
  // that haven't ended) or their manager.
  const { error } = level
    ? await supabase.from("availability").upsert({ ...key, level, updated_at: new Date().toISOString() },
        { onConflict: "member_id,week_start,weekday,kind" })
    : await supabase.from("availability").delete().match(key);

  if (error) {
    return { error: error.code === "42501" ? "אי אפשר לשנות אילוצים לשבוע שכבר עבר." : "השמירה נכשלה. נסו שוב." };
  }
  revalidatePath("/availability");
  return {};
}

export async function clearWeek(memberId: string, weekStart: string): Promise<{ error?: string }> {
  if (!isIsoDate(weekStart)) return { error: "שבוע לא תקין." };
  const supabase = await createClient();
  const { error } = await supabase.from("availability").delete().match({ member_id: memberId, week_start: weekStart });
  if (error) return { error: "הניקוי נכשל. נסו שוב." };
  revalidatePath("/availability");
  return {};
}
