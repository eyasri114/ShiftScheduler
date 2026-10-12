import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getMyContext } from "@/lib/context";
import { createClient } from "@/lib/supabase/server";
import { dateRange, daysBetween, todayIso } from "@/lib/week";
import { decideVacation, deleteAbsence, reviewCertificate } from "./actions";
import { AbsenceForm, AttachForm } from "./forms";

type Absence = {
  id: string; member_id: string; type: "vacation" | "sick"; start_date: string; end_date: string;
  note: string | null; status: "pending" | "approved" | "rejected";
  attachment_path: string | null; attachment_review: "pending" | "valid" | "invalid" | null;
  members: { full_name: string } | null;
};

export default async function AbsencesPage() {
  const { user, context } = await getMyContext();
  if (!user) redirect("/login");
  if (!context) redirect("/onboarding");
  const isManager = context.role !== "employee";
  const today = todayIso();

  const supabase = await createClient();
  // Row-level security: employees get only their own rows, managers their branch.
  const [{ data, error }, { data: team }] = await Promise.all([
    supabase.from("absences")
      .select("id, member_id, type, start_date, end_date, note, status, attachment_path, attachment_review, members!absences_member_id_fkey(full_name)")
      .order("start_date"),
    isManager && context.branches[0]
      ? supabase.from("members").select("id, full_name, branch_members!inner(branch_id)")
          .eq("branch_members.branch_id", context.branches[0].id).eq("is_active", true).order("full_name")
      : Promise.resolve({ data: null }),
  ]);
  const all = (data ?? []) as unknown as Absence[];
  const mine = all.filter((a) => a.member_id === context.member_id);
  const list = isManager ? all : mine;

  const pending = list.filter((a) => a.type === "vacation" && a.status === "pending");
  const toReview = isManager ? list.filter((a) => a.type === "sick" && a.attachment_review === "pending") : [];
  const upcoming = list.filter((a) => a.status === "approved" && a.end_date >= today && !toReview.includes(a));
  const history = list.filter((a) => (a.status === "rejected" || a.end_date < today) && !pending.includes(a) && !toReview.includes(a)).reverse();

  const row = (a: Absence) => <AbsenceRow key={a.id} a={a} isManager={isManager} showName={isManager} />;

  return (
    <AppShell context={context}>
      <h1 className="text-2xl font-bold">{isManager ? "היעדרויות" : "חופשה ומחלה"}</h1>
      <p className="mt-1 max-w-3xl text-muted">
        {isManager
          ? "חופשה צריכה את אישורך. מחלה נרשמת מיד ומוציאה את העובד/ת מהמשמרות באותם ימים; את אישור המחלה בודקים כאן."
          : "בקשת חופשה נשלחת למנהל לאישור. על מחלה מדווחים מיד, ומצרפים אישור מחלה כשמקבלים אותו."}
      </p>

      {error && <p role="alert" className="mt-4 rounded-lg bg-bad-tint px-3 py-2 text-sm text-bad">לא הצלחנו לטעון את הבקשות. רעננו את הדף.</p>}

      <section className="mt-6 rounded-2xl border border-line bg-surface p-5">
        <h2 className="text-lg font-bold">בקשה חדשה</h2>
        <div className="mt-4">
          <AbsenceForm employees={team ? (team as { id: string; full_name: string }[]) : undefined} defaultDate={today} />
        </div>
      </section>

      {(isManager || pending.length > 0) && (
        <Section title={isManager ? `ממתינות לאישור (${pending.length})` : "ממתינות לאישור"} empty="אין בקשות ממתינות.">
          {pending.map(row)}
        </Section>
      )}
      {isManager && (
        <Section title={`אישורי מחלה לבדיקה (${toReview.length})`} empty="אין אישורים שממתינים לבדיקה.">
          {toReview.map(row)}
        </Section>
      )}
      <Section title={isManager ? "היעדרויות קרובות ונוכחיות" : "הבקשות שלי"} empty={isManager ? "אין היעדרויות מתוכננות." : "אין בקשות פתוחות."}>
        {upcoming.map(row)}
      </Section>
      {history.length > 0 && <Section title="היסטוריה" empty="">{history.map(row)}</Section>}
    </AppShell>
  );
}

function Section({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] }) {
  return (
    <section className="mt-6 rounded-2xl border border-line bg-surface p-5">
      <h2 className="text-lg font-bold">{title}</h2>
      {children.length ? <ul className="mt-2 divide-y divide-line">{children}</ul> : <p className="mt-2 text-sm text-muted">{empty}</p>}
    </section>
  );
}

function AbsenceRow({ a, isManager, showName }: { a: Absence; isManager: boolean; showName: boolean }) {
  const sick = a.type === "sick";
  const days = daysBetween(a.start_date, a.end_date);
  const status = sick
    ? !a.attachment_path ? ["warn", "לא צורף אישור מחלה"]
      : a.attachment_review === "valid" ? ["ok", "האישור נבדק ותקין"]
      : a.attachment_review === "invalid" ? ["bad", "האישור סומן כלא תקין"]
      : ["warn", "אישור צורף, ממתין לבדיקה"]
    : a.status === "pending" ? ["warn", "ממתינה לאישור"]
      : a.status === "approved" ? ["ok", "אושרה"] : ["bad", "נדחתה"];
  const tone = { ok: "text-ok", bad: "text-bad", warn: "text-[#99620f] dark:text-[#e3aa55]" }[status[0] as "ok" | "bad" | "warn"];
  const btn = "rounded-lg border border-line-strong px-2.5 py-1 text-xs font-medium hover:border-ink";

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-3">
      <div>
        {showName && <strong className="me-2">{a.members?.full_name}</strong>}
        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${sick ? "bg-bad-tint text-bad" : "bg-[#eeeaf8] text-[#6a55b4] dark:bg-[#252136] dark:text-[#a493e6]"}`}>
          {sick ? "מחלה" : "חופשה"}
        </span>
        <div className="mt-1 text-sm text-muted">
          <bdi dir="ltr" className="tabular-nums">{dateRange(a.start_date, a.end_date)}</bdi> · {days} {days === 1 ? "יום" : "ימים"}
          {a.note && <> · {a.note}</>}
        </div>
        <div className={`mt-0.5 text-sm ${tone}`}>{status[1]}</div>
        {sick && !a.attachment_path && <AttachForm absenceId={a.id} />}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {isManager && !sick && a.status === "pending" && (
          <>
            <form action={decideVacation.bind(null, a.id, true)}><button className="rounded-lg bg-ink px-3 py-1 text-xs font-semibold text-surface">אישור</button></form>
            <form action={decideVacation.bind(null, a.id, false)}><button className={btn}>דחייה</button></form>
          </>
        )}
        {a.attachment_path && (
          <a href={`/absences/${a.id}/file`} target="_blank" rel="noopener" className={btn}>{sick ? "צפייה באישור" : "צפייה בקובץ"}</a>
        )}
        {isManager && sick && a.attachment_path && a.attachment_review === "pending" && (
          <>
            <form action={reviewCertificate.bind(null, a.id, true)}><button className={btn}>תקין</button></form>
            <form action={reviewCertificate.bind(null, a.id, false)}><button className={btn}>לא תקין</button></form>
          </>
        )}
        {(isManager || (!sick && a.status === "pending")) && (
          <form action={deleteAbsence.bind(null, a.id)}>
            <button className="px-1 text-xs text-muted underline underline-offset-4">{isManager ? "מחיקה" : "ביטול בקשה"}</button>
          </form>
        )}
      </div>
    </li>
  );
}
