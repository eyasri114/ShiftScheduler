import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { requireManager } from "@/lib/manager";
import { createClient } from "@/lib/supabase/server";
import { kindsForModel } from "@/lib/constants";
import { setEmployeeActive, updateEmployee } from "../actions";
import { EmployeeForm, type MemberValues } from "../employee-form";

export default async function EditEmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { context, branch } = await requireManager();
  const supabase = await createClient();

  const [{ data: m }, { data: b }] = await Promise.all([
    supabase
      .from("members")
      .select("full_name, email, phone, birth_date, role, is_active, is_shift_lead, allowed_kinds, rest_weekday, min_shifts, max_shifts")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("branches").select("shift_model").eq("id", branch.id).single(),
  ]);
  if (!m) notFound(); // also when row-level security hides it

  const isSelf = id === context.member_id;
  const isOwnerRecord = m.role === "owner";

  return (
    <AppShell context={context} branchName={branch.name}>
      <Link href="/employees" className="text-sm text-muted underline underline-offset-4">→ חזרה לעובדים</Link>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{m.full_name}</h1>
        {!isSelf && !isOwnerRecord && (
          <form action={setEmployeeActive.bind(null, id, !m.is_active)}>
            <button className="rounded-lg border border-line-strong px-3 py-1.5 text-sm font-medium hover:border-ink">
              {m.is_active ? "סמן/י כלא פעיל/ה" : "החזר/י לפעילות"}
            </button>
          </form>
        )}
      </div>
      {!m.is_active && (
        <p className="mt-2 rounded-lg bg-background px-3 py-2 text-sm text-muted">
          העובד/ת לא פעיל/ה: לא ישובצו ולא יופיעו ברשימות, אבל כל הנתונים נשמרים.
        </p>
      )}

      <div className="mt-6 rounded-2xl border border-line bg-surface p-5">
        <EmployeeForm
          action={updateEmployee.bind(null, id)}
          initial={m as MemberValues}
          kinds={kindsForModel(b?.shift_model ?? 2)}
          canSetRole={context.role === "owner" && !isSelf}
          submitLabel="שמירת שינויים"
        />
      </div>
    </AppShell>
  );
}
