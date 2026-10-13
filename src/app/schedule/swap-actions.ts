"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { pushRows, type PushRow } from "@/lib/notify";
import { SHIFT_KINDS, type ShiftKind } from "@/lib/constants";

export type SwapResult = { ok?: boolean; message?: string; error?: string };
export type SwapOption = {
  member_id: string; full_name: string; can_take: boolean;
  exchange: { weekday: number; kind: ShiftKind; label: string }[];
};

const isKind = (k: unknown): k is ShiftKind => (SHIFT_KINDS as unknown[]).includes(k);
const isDay = (d: unknown): d is number => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6;

/** Every swap step is one database function: it checks permissions and rules, and composes the alerts. */
async function run(fn: string, args: Record<string, unknown>): Promise<SwapResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    return { error: error.code === "42501" ? "אין לך הרשאה לפעולה הזו." : "הפעולה נכשלה. נסו שוב." };
  }
  const r = data as { ok: boolean; message: string; push?: PushRow[] };
  await pushRows(r.push ?? []);
  revalidatePath("/schedule");
  revalidatePath("/notifications");
  return r.ok ? { ok: true, message: r.message } : { error: r.message };
}

export async function getSwapOptions(scheduleId: string, weekday: number, kind: ShiftKind): Promise<SwapOption[] | { error: string }> {
  if (!isDay(weekday) || !isKind(kind)) return { error: "משמרת לא תקינה." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("swap_options", { p_schedule: scheduleId, p_weekday: weekday, p_kind: kind });
  if (error) return { error: "לא הצלחנו לטעון את האפשרויות. נסו שוב." };
  return (data ?? []) as SwapOption[];
}

export async function requestSwap(
  scheduleId: string, fromWeekday: number, fromKind: ShiftKind, targetId: string,
  toWeekday: number | null, toKind: ShiftKind | null, note: string,
): Promise<SwapResult> {
  if (!isDay(fromWeekday) || !isKind(fromKind)) return { error: "משמרת לא תקינה." };
  if ((toWeekday === null) !== (toKind === null) || (toWeekday !== null && (!isDay(toWeekday) || !isKind(toKind))))
    return { error: "משמרת לא תקינה." };
  return run("request_swap", {
    p_schedule: scheduleId, p_from_weekday: fromWeekday, p_from_kind: fromKind, p_target: targetId,
    p_to_weekday: toWeekday, p_to_kind: toKind, p_note: note.slice(0, 200),
  });
}

export async function respondSwap(id: string, accept: boolean) {
  return run("respond_swap", { p_swap: id, p_accept: accept });
}
export async function decideSwap(id: string, approve: boolean) {
  return run("decide_swap", { p_swap: id, p_approve: approve });
}
export async function cancelSwap(id: string) {
  return run("cancel_swap", { p_swap: id });
}
