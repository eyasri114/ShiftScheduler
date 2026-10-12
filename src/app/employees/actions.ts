"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireManager } from "@/lib/manager";
import { SHIFT_KINDS, type ShiftKind } from "@/lib/constants";

export type EmployeeFormState = { error?: string; saved?: string } | undefined;

type MemberInput = {
  full_name: string;
  email: string | null;
  phone: string | null;
  birth_date: string | null;
  is_shift_lead: boolean;
  allowed_kinds: ShiftKind[];
  rest_weekday: number | null;
  min_shifts: number;
  max_shifts: number;
  role?: "employee" | "manager";
};

function parse(form: FormData): MemberInput | string {
  const s = (k: string) => String(form.get(k) ?? "").trim();
  const full_name = s("full_name");
  if (!full_name) return "חסר שם.";

  const email = s("email").toLowerCase() || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "כתובת האימייל לא תקינה.";

  const birth_date = s("birth_date") || null;
  if (birth_date && Number.isNaN(Date.parse(birth_date))) return "תאריך הלידה לא תקין.";

  const allowed_kinds = form.getAll("allowed_kinds").map(String).filter((k): k is ShiftKind =>
    (SHIFT_KINDS as string[]).includes(k));
  if (allowed_kinds.length === 0) return "בחרו לפחות סוג משמרת אחד.";

  const min_shifts = Number(s("min_shifts") || 0);
  const max_shifts = Number(s("max_shifts") || 5);
  if (![min_shifts, max_shifts].every((n) => Number.isInteger(n) && n >= 0 && n <= 7))
    return "מספר המשמרות בשבוע צריך להיות בין 0 ל-7.";
  if (min_shifts > max_shifts) return "המינימום גדול מהמקסימום.";

  const rest = s("rest_weekday");
  const role = s("role");
  return {
    full_name,
    email,
    phone: s("phone") || null,
    birth_date,
    is_shift_lead: form.get("is_shift_lead") === "on",
    allowed_kinds,
    rest_weekday: rest === "" ? null : Number(rest),
    min_shifts,
    max_shifts,
    ...(role === "employee" || role === "manager" ? { role } : {}),
  };
}

function dbError(code: string | undefined): string {
  if (code === "23505") return "כבר קיים בעסק עובד עם האימייל הזה.";
  if (code === "42501") return "אין לך הרשאה לפעולה הזו.";
  if (code === "23514") return "חלק מהערכים לא תקינים. בדקו את מספרי המשמרות.";
  return "השמירה נכשלה. נסו שוב.";
}

export async function addEmployee(_: EmployeeFormState, form: FormData): Promise<EmployeeFormState> {
  const { branch } = await requireManager();
  const input = parse(form);
  if (typeof input === "string") return { error: input };

  const supabase = await createClient();
  const { error } = await supabase.rpc("add_branch_member", { p_branch: branch.id, p_member: input });
  if (error) return { error: dbError(error.code) };

  revalidatePath("/employees");
  revalidatePath("/");
  return { saved: `${input.full_name} נוסף/ה לסניף.` };
}

export async function updateEmployee(id: string, _: EmployeeFormState, form: FormData): Promise<EmployeeFormState> {
  await requireManager();
  const input = parse(form);
  if (typeof input === "string") return { error: input };

  const supabase = await createClient();
  const { data, error } = await supabase.from("members").update(input).eq("id", id).select("id");
  if (error) return { error: dbError(error.code) };
  if (!data?.length) return { error: dbError("42501") };

  revalidatePath("/employees");
  revalidatePath("/");
  redirect("/employees");
}

export async function setEmployeeActive(id: string, active: boolean) {
  await requireManager();
  const supabase = await createClient();
  await supabase.from("members").update({ is_active: active }).eq("id", id);
  revalidatePath("/employees");
  revalidatePath(`/employees/${id}`);
  revalidatePath("/");
}
