import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireManager } from "@/lib/manager";
import { createClient } from "@/lib/supabase/server";
import { KIND_LABEL, WEEKDAYS, isMinor, kindsForModel, type ShiftKind } from "@/lib/constants";
import { addEmployee } from "./actions";
import { EmployeeForm } from "./employee-form";

type Row = {
  id: string; full_name: string; email: string | null; role: "owner" | "manager" | "employee";
  is_active: boolean; is_shift_lead: boolean; birth_date: string | null; user_id: string | null;
  allowed_kinds: ShiftKind[]; rest_weekday: number | null; min_shifts: number; max_shifts: number;
};

export default async function EmployeesPage() {
  const { context, branch } = await requireManager();
  const supabase = await createClient();

  const [{ data: members, error }, { data: b }] = await Promise.all([
    supabase
      .from("members")
      .select("id, full_name, email, role, is_active, is_shift_lead, birth_date, user_id, allowed_kinds, rest_weekday, min_shifts, max_shifts, branch_members!inner(branch_id)")
      .eq("branch_members.branch_id", branch.id)
      .order("is_active", { ascending: false })
      .order("full_name"),
    supabase.from("branches").select("shift_model").eq("id", branch.id).single(),
  ]);
  const rows = (members ?? []) as unknown as Row[];
  const kinds = kindsForModel(b?.shift_model ?? 2);
  const active = rows.filter((r) => r.is_active).length;
  const inactive = rows.length - active;

  return (
    <AppShell context={context} branchName={branch.name}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">עובדים</h1>
          <p className="mt-1 text-muted">
            {active} פעילים{inactive ? (inactive === 1 ? ", 1 לא פעיל" : `, ${inactive} לא פעילים`) : ""}
          </p>
        </div>
      </div>

      <details className="group mt-6 rounded-2xl border border-line bg-surface" open={rows.length <= 1}>
        <summary className="cursor-pointer list-none px-5 py-4 font-semibold marker:hidden">
          <span className="inline-flex items-center gap-2">
            <span aria-hidden className="text-xl leading-none group-open:rotate-45 transition">+</span>
            הוספת עובד/ת
          </span>
        </summary>
        <div className="border-t border-line px-5 py-5">
          <EmployeeForm action={addEmployee} kinds={kinds} canSetRole={context.role === "owner"} submitLabel="הוספה לסניף" />
        </div>
      </details>

      {error && <p className="mt-6 text-bad">לא הצלחנו לטעון את רשימת העובדים.</p>}

      <div className="mt-6 overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="text-start text-muted">
            <tr className="border-b border-line">
              <th className="px-4 py-3 text-start font-medium">שם</th>
              <th className="px-4 py-3 text-start font-medium">משמרות בשבוע</th>
              <th className="px-4 py-3 text-start font-medium">סוגי משמרות</th>
              <th className="px-4 py-3 text-start font-medium">יום מנוחה</th>
              <th className="px-4 py-3 text-start font-medium">חשבון</th>
              <th className="px-4 py-3"><span className="sr-only">פעולות</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id} className={`border-b border-line last:border-0 ${m.is_active ? "" : "text-muted"}`}>
                <td className="px-4 py-3">
                  <span className="font-semibold">{m.full_name}</span>
                  <span className="ms-2 inline-flex flex-wrap gap-1 align-middle">
                    {m.role === "owner" && <Tag>בעלים</Tag>}
                    {m.role === "manager" && <Tag>מנהל/ת</Tag>}
                    {m.is_shift_lead && <Tag>אחראי/ת</Tag>}
                    {isMinor(m.birth_date) && <Tag tone="warn">קטין/ה</Tag>}
                    {!m.is_active && <Tag tone="muted">לא פעיל/ה</Tag>}
                  </span>
                  {m.email && <div className="mt-0.5 text-xs text-muted" dir="ltr" style={{ textAlign: "right" }}>{m.email}</div>}
                </td>
                <td className="px-4 py-3 tabular-nums"><bdi dir="ltr">{m.min_shifts}–{m.max_shifts}</bdi></td>
                <td className="px-4 py-3">{m.allowed_kinds.filter((k) => kinds.includes(k)).map((k) => KIND_LABEL[k]).join(", ")}</td>
                <td className="px-4 py-3">{m.rest_weekday === null ? "—" : WEEKDAYS[m.rest_weekday]}</td>
                <td className="px-4 py-3">
                  {m.user_id ? <span className="text-ok">מחובר/ת</span>
                    : m.email ? <span className="text-muted">ממתין/ה להרשמה</span>
                    : <span className="text-muted">אין אימייל</span>}
                </td>
                <td className="px-4 py-3 text-end">
                  <Link href={`/employees/${m.id}`} className="font-medium underline underline-offset-4">עריכה</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}

function Tag({ children, tone }: { children: React.ReactNode; tone?: "warn" | "muted" }) {
  const cls = tone === "warn" ? "bg-[#faefdb] text-[#99620f] dark:bg-[#352812] dark:text-[#e3aa55]"
    : tone === "muted" ? "bg-background text-muted" : "bg-background text-ink";
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}>{children}</span>;
}
