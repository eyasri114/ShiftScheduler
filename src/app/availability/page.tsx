import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getMyContext } from "@/lib/context";
import { createClient } from "@/lib/supabase/server";
import { getWeekSlots } from "@/lib/branch-data";
import { isMinor, WEEKDAYS, type ShiftKind } from "@/lib/constants";
import { addDays, todayIso, weekParam, weekRange } from "@/lib/week";
import { AvailabilityGrid, type Blocked } from "./availability-grid";

type Search = Promise<{ week?: string; member?: string }>;

export default async function AvailabilityPage({ searchParams }: { searchParams: Search }) {
  const { user, context } = await getMyContext();
  if (!user) redirect("/login");
  if (!context) redirect("/onboarding");
  const branch = context.branches[0];
  if (!branch) redirect("/");

  const sp = await searchParams;
  const week = weekParam(sp.week);
  const isManager = context.role !== "employee";
  const memberId = isManager ? sp.member : context.member_id;

  return (
    <AppShell context={context}>
      {isManager && !memberId
        ? <TeamOverview branchId={branch.id} week={week} myId={context.member_id} />
        : <MemberWeek branchId={branch.id} week={week} memberId={memberId!} isManager={isManager}
            isSelf={memberId === context.member_id} />}
    </AppShell>
  );
}

function WeekNav({ week, extra = "" }: { week: string; extra?: string }) {
  const link = (w: string) => `/availability?week=${w}${extra}`;
  return (
    <div className="flex items-center gap-2 text-sm">
      <Link href={link(addDays(week, -7))} className="rounded-lg border border-line-strong px-3 py-1.5 hover:border-ink">השבוע הקודם</Link>
      <bdi dir="ltr" className="px-1 font-semibold tabular-nums">{weekRange(week)}</bdi>
      <Link href={link(addDays(week, 7))} className="rounded-lg border border-line-strong px-3 py-1.5 hover:border-ink">השבוע הבא</Link>
    </div>
  );
}

async function TeamOverview({ branchId, week, myId }: { branchId: string; week: string; myId: string }) {
  const supabase = await createClient();
  const [{ data: summary }, { data: members }] = await Promise.all([
    supabase.rpc("availability_summary", { p_branch: branchId, p_week: week }),
    supabase.from("members").select("id, full_name, branch_members!inner(branch_id)")
      .eq("branch_members.branch_id", branchId).eq("is_active", true).order("full_name"),
  ]);
  const byId = new Map(((summary ?? []) as { member_id: string; marks: number; cannot: number; prefer: number }[])
    .map((s) => [s.member_id, s]));
  const rows = (members ?? []) as { id: string; full_name: string }[];
  const submitted = rows.filter((m) => (byId.get(m.id)?.marks ?? 0) > 0).length;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">אילוצים</h1>
          <p className="mt-1 text-muted">{submitted} מתוך {rows.length} עובדים סימנו אילוצים לשבוע הזה.</p>
        </div>
        <WeekNav week={week} />
      </div>
      <div className="mt-6 overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="text-muted">
            <tr className="border-b border-line">
              <th className="px-4 py-3 text-start font-medium">עובד/ת</th>
              <th className="px-4 py-3 text-start font-medium">לא יכול/ה</th>
              <th className="px-4 py-3 text-start font-medium">מעדיף/ה</th>
              <th className="px-4 py-3"><span className="sr-only">פעולות</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => {
              const s = byId.get(m.id);
              return (
                <tr key={m.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 font-semibold">
                    {m.full_name}{m.id === myId && <span className="ms-2 text-xs font-normal text-muted">(את/ה)</span>}
                    {!s?.marks && <span className="ms-2 rounded bg-background px-1.5 py-0.5 text-xs font-medium text-muted">לא סימן/ה</span>}
                  </td>
                  <td className="px-4 py-3 tabular-nums">{s?.cannot || "—"}</td>
                  <td className="px-4 py-3 tabular-nums">{s?.prefer || "—"}</td>
                  <td className="px-4 py-3 text-end">
                    <Link href={`/availability?week=${week}&member=${m.id}`} className="font-medium underline underline-offset-4">
                      צפייה ועריכה
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-sm text-muted">
        עובדים שלא סימנו כלום נחשבים זמינים לכל המשמרות. במערכת המלאה תישלח להם תזכורת.
      </p>
    </>
  );
}

async function MemberWeek({ branchId, week, memberId, isManager, isSelf }: {
  branchId: string; week: string; memberId: string; isManager: boolean; isSelf: boolean;
}) {
  const supabase = await createClient();
  const weekEnd = addDays(week, 6);
  const [{ data: m }, { data: avail }, { data: absences }, slotsData] = await Promise.all([
    supabase.from("members").select("full_name, allowed_kinds, rest_weekday, birth_date").eq("id", memberId).maybeSingle(),
    supabase.from("availability").select("weekday, kind, level").eq("member_id", memberId).eq("week_start", week),
    supabase.from("absences").select("type, status, start_date, end_date").eq("member_id", memberId)
      .eq("status", "approved").lte("start_date", weekEnd).gte("end_date", week),
    getWeekSlots(branchId, week),
  ]);
  if (!m) {
    return <p className="text-bad">לא נמצא עובד/ת.</p>;
  }

  const blocked: Blocked = {};
  for (let d = 0; d < 7; d++) {
    const date = addDays(week, d);
    const a = (absences ?? []).find((x) => x.start_date <= date && x.end_date >= date);
    if (a) blocked[d] = a.type === "sick" ? "במחלה" : "בחופשה";
    else if (m.rest_weekday === d) blocked[d] = "יום מנוחה";
  }
  const minor = isMinor(m.birth_date, new Date(week));
  const allowedKinds = (m.allowed_kinds as ShiftKind[]).filter((k) => !(minor && k === "night"));
  const initial = Object.fromEntries((avail ?? []).map((a) => [`${a.weekday}-${a.kind}`, a.level]));
  const locked = !isManager && weekEnd < todayIso();
  const extra = isManager ? `&member=${memberId}` : "";

  return (
    <>
      {isManager && (
        <Link href={`/availability?week=${week}`} className="text-sm text-muted underline underline-offset-4">→ כל העובדים</Link>
      )}
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{isSelf ? "האילוצים שלי" : `האילוצים של ${m.full_name}`}</h1>
          <p className="mt-1 text-muted">
            {isSelf
              ? "סמנו לאילו משמרות אתם יכולים להגיע. המנהל בונה את הסידור לפי הסימונים."
              : "אפשר לעדכן בשם העובד/ת, למשל אם הודיע/ה בטלפון."}
            {m.rest_weekday !== null && ` יום מנוחה קבוע: ${WEEKDAYS[m.rest_weekday]}.`}
          </p>
        </div>
        <WeekNav week={week} extra={extra} />
      </div>
      <div className="mt-6">
        <AvailabilityGrid
          key={`${memberId}-${week}`}
          memberId={memberId} weekStart={week} kinds={slotsData.kinds} slots={slotsData.slots}
          dates={slotsData.dates} initial={initial} locked={locked} blocked={blocked} allowedKinds={allowedKinds}
        />
      </div>
    </>
  );
}
