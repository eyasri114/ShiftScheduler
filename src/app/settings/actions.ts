"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireManager } from "@/lib/manager";
import { kindsForModel } from "@/lib/constants";

export type SettingsState = { error?: string; saved?: boolean } | undefined;

const TIME = /^([01]\d|2[0-3]):[0-5]\d(:00)?$/;

export async function saveSettings(_: SettingsState, form: FormData): Promise<SettingsState> {
  const { branch } = await requireManager();
  const s = (k: string) => String(form.get(k) ?? "").trim();
  const int = (k: string) => Number(s(k));

  const name = s("name");
  if (!name) return { error: "חסר שם לסניף." };
  const shift_model = int("shift_model") === 3 ? 3 : 2;
  const min_rest_hours = int("min_rest_hours");
  const weekly_rest_hours = int("weekly_rest_hours");
  if (!Number.isInteger(min_rest_hours) || min_rest_hours < 0 || min_rest_hours > 24)
    return { error: "מנוחה בין משמרות: בין 0 ל-24 שעות." };
  if (!Number.isInteger(weekly_rest_hours) || weekly_rest_hours < 0 || weekly_rest_hours > 72)
    return { error: "מנוחה שבועית: בין 0 ל-72 שעות." };

  const open = new Set(form.getAll("open").map(Number));
  const closed_weekdays = [0, 1, 2, 3, 4, 5, 6].filter((d) => !open.has(d));

  const slots = [];
  for (let d = 0; d < 7; d++) {
    for (const k of kindsForModel(shift_model)) {
      const required = int(`req-${d}-${k}`);
      const start_time = s(`start-${d}-${k}`);
      const end_time = s(`end-${d}-${k}`);
      if (!Number.isInteger(required) || required < 0 || required > 50)
        return { error: "מספר העובדים במשמרת צריך להיות בין 0 ל-50." };
      if (!TIME.test(start_time) || !TIME.test(end_time))
        return { error: "יש שעת משמרת לא תקינה." };
      if (start_time.slice(0, 5) === end_time.slice(0, 5))
        return { error: "שעת ההתחלה והסיום של משמרת לא יכולות להיות זהות." };
      slots.push({ branch_id: branch.id, weekday: d, kind: k, required, start_time, end_time });
    }
  }

  const supabase = await createClient();
  const { data: updated, error: e1 } = await supabase
    .from("branches")
    .update({
      name, shift_model, min_rest_hours, weekly_rest_hours, closed_weekdays,
      require_shift_lead: form.get("require_shift_lead") === "on",
    })
    .eq("id", branch.id)
    .select("id");
  if (e1 || !updated?.length) return { error: "אין הרשאה לשמור את הגדרות הסניף, או שהשמירה נכשלה." };

  const { error: e2 } = await supabase.from("template_slots").upsert(slots, { onConflict: "branch_id,weekday,kind" });
  if (e2) return { error: "שמירת שעות המשמרות נכשלה. נסו שוב." };

  revalidatePath("/", "layout");
  return { saved: true };
}
