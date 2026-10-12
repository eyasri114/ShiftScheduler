import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getMyContext, type MyContext } from "@/lib/context";
import { createClient } from "@/lib/supabase/server";
import { loadWeek } from "@/lib/scheduler/load";
import { getWeekSlots } from "@/lib/branch-data";
import { KIND_LABEL, WEEKDAYS, type ShiftKind } from "@/lib/constants";
import { addDays, thisWeekStart, weekParam, weekRange } from "@/lib/week";
import { ScheduleBoard } from "./board";

type Search = Promise<{ week?: string }>;

export default async function SchedulePage({ searchParams }: { searchParams: Search }) {
  const { user, context } = await getMyContext();
  if (!user) redirect("/login");
  if (!context) redirect("/onboarding");
  const branch = context.branches[0];
  if (!branch) redirect("/");
  const isManager = context.role !== "employee";
  // managers plan next week; employees look at this week first
  const week = weekParam((await searchParams).week, isManager ? undefined : thisWeekStart());

  return (
    <AppShell context={context}>
      {isManager
        ? <ManagerBoard branchId={branch.id} week={week} />
        : <EmployeeSchedule branchId={branch.id} week={week} context={context} />}
    </AppShell>
  );
}

function WeekNav({ week }: { week: string }) {
  const cls = "rounded-lg border border-line-strong px-3 py-1.5 hover:border-ink";
  return (
    <div className="flex items-center gap-2 text-sm print:hidden">
      <Link href={`/schedule?week=${addDays(week, -7)}`} className={cls}>השבוע הקודם</Link>
      <bdi dir="ltr" className="px-1 font-semibold tabular-nums">{weekRange(week)}</bdi>
      <Link href={`/schedule?week=${addDays(week, 7)}`} className={cls}>השבוע הבא</Link>
    </div>
  );
}

async function ManagerBoard({ branchId, week }: { branchId: string; week: string }) {
  const data = await loadWeek(branchId, week);
  const status = data.schedule?.status ?? "none";
  const changed = data.changedSincePublish.length;
  const pill = status === "published"
    ? changed ? ["bg-[#faefdb] text-[#99620f]", "יש שינויים שלא פורסמו"] : ["bg-ok-tint text-ok", "פורסם לעובדים"]
    : ["border border-line-strong text-muted", "טיוטה"];
  const dates = Array.from({ length: 7 }, (_, d) => addDays(week, d));

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">
            סידור עבודה <span className="print:inline hidden">· <bdi dir="ltr">{weekRange(week)}</bdi></span>
          </h1>
          <span className={`mt-2 inline-block rounded-full px-3 py-1 text-xs font-semibold print:hidden ${pill[0]}`}>{pill[1]}</span>
        </div>
        <WeekNav week={week} />
      </div>
      <div className="mt-5">
        <ScheduleBoard
          key={week}
          week={week} dates={dates} kinds={data.kinds} closed={data.closed} slots={data.boardSlots}
          ctx={data.ctx} assignment={data.assignment} status={status} changedCount={changed}
        />
      </div>
    </>
  );
}

async function EmployeeSchedule({ branchId, week, context }: { branchId: string; week: string; context: MyContext }) {
  const supabase = await createClient();
  // Row-level security: an employee only gets a schedule once it is published.
  const [{ data: schedule }, { data: roster }, slotsData] = await Promise.all([
    supabase.from("schedules").select("id, assignments(member_id, weekday, kind)")
      .eq("branch_id", branchId).eq("week_start", week).maybeSingle(),
    supabase.rpc("branch_roster", { p_branch: branchId }),
    getWeekSlots(branchId, week),
  ]);
  const names = new Map(((roster ?? []) as { member_id: string; full_name: string }[]).map((r) => [r.member_id, r.full_name]));
  const rows = (schedule?.assignments ?? []) as { member_id: string; weekday: number; kind: ShiftKind }[];
  const mine = rows.filter((r) => r.member_id === context.member_id)
    .map((r) => ({ ...r, slot: slotsData.slots.find((s) => s.weekday === r.weekday && s.kind === r.kind) }))
    .sort((x, y) => x.weekday - y.weekday || slotsData.kinds.indexOf(x.kind) - slotsData.kinds.indexOf(y.kind));

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-2xl font-bold">הסידור</h1>
        <WeekNav week={week} />
      </div>
      {!schedule ? (
        <p className="mt-6 rounded-xl border border-line bg-surface px-4 py-3">
          הסידור לשבוע הזה עוד לא פורסם. הוא יופיע כאן ברגע שהמנהל יפרסם אותו.
        </p>
      ) : (
        <>
          <section className="mt-6 rounded-2xl border border-line bg-surface p-5">
            <h2 className="text-lg font-bold">המשמרות שלי</h2>
            {mine.length ? (
              <ul className="mt-2 grid gap-1.5">
                {mine.map((m) => (
                  <li key={`${m.weekday}-${m.kind}`} className="flex items-center gap-2">
                    <span className="font-semibold">יום {WEEKDAYS[m.weekday]} {Number(slotsData.dates[m.weekday].slice(8, 10))}.{Number(slotsData.dates[m.weekday].slice(5, 7))}</span>
                    <span>· {KIND_LABEL[m.kind]}</span>
                    {m.slot && <bdi dir="ltr" className="text-muted">{m.slot.start}–{m.slot.end}</bdi>}
                  </li>
                ))}
              </ul>
            ) : <p className="mt-2 text-muted">אין לך משמרות בשבוע הזה.</p>}
          </section>

          <div className="mt-6 overflow-x-auto rounded-2xl border border-line bg-surface">
            <table className="w-full min-w-[760px] border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th className="w-16" />
                  {WEEKDAYS.map((d, i) => (
                    <th key={d} className="border-b border-r border-line px-2 py-2 text-center font-semibold">
                      {d}<div className="text-xs font-normal text-muted">{Number(slotsData.dates[i].slice(8, 10))}.{Number(slotsData.dates[i].slice(5, 7))}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {slotsData.kinds.map((k) => (
                  <tr key={k}>
                    <th scope="row" className="border-b border-line px-3 text-start font-bold">{KIND_LABEL[k]}</th>
                    {WEEKDAYS.map((d, i) => {
                      const s = slotsData.slots.find((x) => x.weekday === i && x.kind === k);
                      const ids = rows.filter((r) => r.weekday === i && r.kind === k).map((r) => r.member_id);
                      return (
                        <td key={d} className={`border-b border-r border-line p-2 align-top ${s ? "" : "bg-background"}`}>
                          {s ? (
                            <div className="flex flex-wrap gap-1">
                              {ids.map((id) => (
                                <span key={id} className={`rounded-md border px-1.5 py-1 leading-none ${id === context.member_id ? "border-ink bg-ink text-surface" : "border-line"}`}>
                                  {names.get(id) ?? "—"}
                                </span>
                              ))}
                            </div>
                          ) : <span className="text-xs text-muted">—</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
