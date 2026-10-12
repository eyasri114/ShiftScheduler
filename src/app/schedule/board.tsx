"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { analyze, candidates, type Assignment, type Context, type Kind } from "@/lib/scheduler/engine";
import type { BoardSlot } from "@/lib/scheduler/load";
import { KIND_LABEL, WEEKDAYS } from "@/lib/constants";
import { assign, clearSchedule, publish, runAutoSchedule, setDayClosed, setLocked, setRequired, unassign } from "./actions";

const TINT: Record<Kind, string> = {
  morning: "bg-[#fcf1dc] dark:bg-[#30271a]",
  evening: "bg-[#eeeaf8] dark:bg-[#252136]",
  night: "bg-[#e3e9f3] dark:bg-[#1a2536]",
};
const BAR: Record<Kind, string> = {
  morning: "shadow-[inset_-5px_0_0_#d38c17]",
  evening: "shadow-[inset_-5px_0_0_#6a55b4]",
  night: "shadow-[inset_-5px_0_0_#22406e]",
};

function Lock() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="size-3 flex-none">
      <path d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" />
    </svg>
  );
}

export function ScheduleBoard({
  week, dates, kinds, closed, slots, ctx, assignment, status, changedCount,
}: {
  week: string;
  dates: string[];
  kinds: Kind[];
  closed: number[];
  slots: BoardSlot[];
  ctx: Context;
  assignment: Assignment;
  status: "none" | "draft" | "published";
  changedCount: number;
}) {
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; bad?: boolean } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  const names = useMemo(() => new Map(ctx.employees.map((e) => [e.id, e])), [ctx.employees]);
  const a = useMemo(() => {
    // only active employees count; drop anyone no longer in the branch
    const out: Assignment = {};
    for (const [k, ids] of Object.entries(assignment)) out[k] = ids.filter((id) => names.has(id));
    return out;
  }, [assignment, names]);
  const r = useMemo(() => analyze(ctx, a, [...WEEKDAYS], KIND_LABEL), [ctx, a]);
  const slotAt = (d: number, k: Kind) => slots.find((s) => s.weekday === d && s.kind === k);

  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  function run(label: string, fn: () => Promise<{ error?: string; message?: string }>) {
    setBusy(label);
    startTransition(async () => {
      const res = await fn();
      setBusy(null);
      if (res.error) setToast({ text: res.error, bad: true });
      else if (res.message) setToast({ text: res.message });
    });
  }

  const started = r.started;
  const published = status === "published";
  const btn = "rounded-lg border border-line-strong bg-surface px-3.5 py-2 font-semibold hover:border-ink disabled:opacity-50";

  return (
    <div>
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <button className="rounded-lg bg-ink px-3.5 py-2 font-semibold text-surface disabled:opacity-60" disabled={pending}
          onClick={() => {
            if (published && !confirm("הסידור כבר פורסם. לבנות אותו מחדש? שיבוצים נעולים יישארו, ועובדים שהמשמרות שלהם ישתנו יראו את העדכון אחרי פרסום."))
              return;
            run("auto", () => runAutoSchedule(week));
          }}>
          {busy === "auto" ? "בונה סידור…" : "שבץ אוטומטית"}
        </button>
        <button className={btn} disabled={pending || !started}
          onClick={() => confirm("לנקות את כל השיבוצים של השבוע? שיבוצים נעולים יישארו.") && run("clear", () => clearSchedule(week))}>
          נקה שיבוצים
        </button>
        {!published ? (
          <button className={btn} disabled={pending || !started} onClick={() => run("pub", () => publish(week))}>
            {busy === "pub" ? "מפרסם…" : "פרסם לעובדים"}
          </button>
        ) : changedCount > 0 ? (
          <button className={btn} disabled={pending} onClick={() => run("pub", () => publish(week))}>
            פרסם עדכון ({changedCount})
          </button>
        ) : (
          <button className={btn} disabled>פורסם</button>
        )}
        <button className="rounded-lg px-3 py-2 font-medium text-muted underline underline-offset-4" onClick={() => window.print()}>הדפסה</button>
      </div>

      {/* summary */}
      <div className="mt-4">
        {!r.total ? (
          <p className="rounded-xl border border-line bg-surface px-4 py-3">אין משמרות פתוחות השבוע. אפשר להוסיף משמרת מהלוח, או לשנות את <a href="/settings" className="underline">הגדרות הסניף</a>.</p>
        ) : !started ? (
          <p className="rounded-xl border border-line bg-surface px-4 py-3 print:hidden">
            עוד לא נבנה סידור לשבוע הזה. לחצו על <strong>שבץ אוטומטית</strong> כדי לקבל טיוטה לפי האילוצים, ואז אפשר לתקן כל משמרת בלחיצה עליה.
          </p>
        ) : (
          <p className="flex flex-wrap gap-x-5 text-muted print:hidden">
            <span><strong className="text-xl text-ink tabular-nums">{r.filled}/{r.total}</strong> מקומות מאוישים</span>
            <span>{r.issues.length ? (r.issues.length === 1 ? "פריט אחד לבדיקה" : `${r.issues.length} פריטים לבדיקה`) : "אין בעיות פתוחות"}</span>
          </p>
        )}
      </div>

      {/* grid */}
      <div className="mt-4 overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[920px] border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="sticky right-0 z-[1] w-20 bg-surface" />
              {WEEKDAYS.map((day, d) => (
                <th key={day} className={`border-b border-r border-line px-2 py-2.5 text-center ${closed.includes(d) ? "text-muted" : ""}`}>
                  <div className="font-semibold">{day}</div>
                  <div className="text-xs font-normal text-muted">{Number(dates[d].slice(8, 10))}.{Number(dates[d].slice(5, 7))}</div>
                  <button className="mt-0.5 text-xs font-normal text-muted underline underline-offset-2 print:hidden" disabled={pending}
                    onClick={() => {
                      const closing = !closed.includes(d);
                      if (closing && Object.keys(a).some((k) => k.startsWith(`${d}-`) && a[k].length) &&
                          !confirm(`לסגור את יום ${day}? השיבוצים של היום יוסרו.`)) return;
                      run("day", () => setDayClosed(week, d, closing));
                    }}>
                    {closed.includes(d) ? "פתיחת היום" : "סגירת היום"}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {kinds.map((k) => (
              <tr key={k}>
                <th scope="row" className={`sticky right-0 z-[1] border-b border-line bg-surface px-3 text-start font-bold ${BAR[k]}`}>{KIND_LABEL[k]}</th>
                {WEEKDAYS.map((day, d) => {
                  const s = slotAt(d, k);
                  const key = `${d}-${k}`;
                  const cls = "border-b border-r border-line align-top";
                  if (closed.includes(d)) return <td key={key} className={`${cls} bg-background text-center text-sm text-muted`}><div className="py-6">סגור</div></td>;
                  if (!s || s.required <= 0) {
                    return (
                      <td key={key} className={`${cls} bg-background`}>
                        {s && (
                          <button className="flex min-h-28 w-full flex-col items-center justify-center text-sm text-muted print:hidden" onClick={() => setOpen(key)}>
                            אין משמרת<span className="underline underline-offset-2">הוספה</span>
                          </button>
                        )}
                      </td>
                    );
                  }
                  const ids = a[key] ?? [];
                  const locked = ctx.locked[key] ?? [];
                  const missing = Math.max(0, s.required - ids.length);
                  return (
                    <td key={key} className={`${cls} ${TINT[k]}`}>
                      <button onClick={() => setOpen(key)}
                        aria-label={`${KIND_LABEL[k]}, יום ${day}: ${ids.length} מתוך ${s.required}`}
                        className="flex min-h-28 w-full flex-col gap-1.5 p-2 text-start hover:shadow-[inset_0_0_0_2px_var(--line-strong)]">
                        <span className="flex w-full items-center justify-between gap-1 text-xs text-muted">
                          <bdi dir="ltr" className="tabular-nums">{s.startTime}–{s.endTime}</bdi>
                          {s.required !== s.templateRequired && (
                            <span className="rounded bg-surface px-1 font-semibold text-ink">{s.required > s.templateRequired ? "תגבור" : "צמצום"}</span>
                          )}
                          <span className={`rounded-full px-2 font-bold tabular-nums ${missing ? "bg-bad text-surface" : "bg-surface text-ok"}`}>{ids.length}/{s.required}</span>
                        </span>
                        <span className="flex flex-wrap gap-1">
                          {ids.map((id) => {
                            const e = names.get(id)!;
                            const bad = r.violations[`${key}|${id}`];
                            return (
                              <span key={id} title={bad}
                                className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border bg-surface px-1.5 py-1 text-[13px] leading-none ${bad ? "border-bad text-bad" : "border-line"}`}>
                                {locked.includes(id) && <Lock />}
                                {e.name}
                                {e.isLead && <span className="size-1.5 rounded-full bg-current opacity-70" title="אחראי/ת משמרת" />}
                              </span>
                            );
                          })}
                          {started && Array.from({ length: missing }, (_, i) => (
                            <span key={i} className="rounded-md border border-dashed border-bad px-1.5 py-1 text-[13px] leading-none text-bad print:hidden">חסר</span>
                          ))}
                        </span>
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* problems + fairness */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2 print:hidden">
        <section className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="text-lg font-bold">בעיות לבדיקה</h2>
          {!started ? <p className="mt-2 text-sm text-muted">יופיעו כאן אחרי בניית הסידור.</p>
            : !r.issues.length ? <p className="mt-2 text-sm text-muted">אין בעיות. אפשר לפרסם.</p>
            : (
              <ul className="mt-2 grid gap-1.5">
                {r.issues.map((i, n) => (
                  <li key={n} className={`rounded-md px-3 py-1.5 text-sm ${i.level === "bad" ? "bg-bad-tint text-bad" : "bg-[#faefdb] text-[#99620f] dark:bg-[#352812] dark:text-[#e3aa55]"}`}>
                    {i.slotKey ? <button className="text-start underline underline-offset-2" onClick={() => setOpen(i.slotKey!)}>{i.text}</button> : i.text}
                  </li>
                ))}
              </ul>
            )}
        </section>
        <section className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="text-lg font-bold">חלוקת המשמרות</h2>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted">
                <tr className="border-b border-line">
                  <th className="py-1.5 text-start font-medium">עובד/ת</th>
                  <th className="py-1.5 text-start font-medium">משמרות (טווח)</th>
                  {kinds.includes("night") && <th className="py-1.5 text-start font-medium">לילות</th>}
                  <th className="py-1.5 text-start font-medium">שישי ושבת</th>
                  <th className="py-1.5 text-start font-medium">העדפות שכובדו</th>
                </tr>
              </thead>
              <tbody>
                {r.stats.map((s) => (
                  <tr key={s.id} className="border-b border-line last:border-0">
                    <td className="py-1.5">{s.name}</td>
                    <td className={`py-1.5 tabular-nums ${started && s.shifts < s.min ? "font-semibold text-[#99620f]" : ""}`}>
                      {s.shifts} <span className="text-muted">(<bdi dir="ltr">{s.min}–{s.max}</bdi>)</span>
                    </td>
                    {kinds.includes("night") && <td className="py-1.5 tabular-nums">{s.nights}</td>}
                    <td className="py-1.5 tabular-nums">{s.weekend}</td>
                    <td className="py-1.5 tabular-nums">{s.preferred ? `${s.preferredGot} מתוך ${s.preferred}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* shift dialog */}
      <dialog ref={dialog} onClose={() => setOpen(null)} onClick={(e) => e.target === dialog.current && setOpen(null)}
        className="m-auto max-h-[calc(100dvh-3rem)] w-[min(560px,calc(100%-24px))] rounded-2xl bg-surface p-0 text-ink shadow-2xl backdrop:bg-black/50">
        {open && (
          <ShiftDialog key={open} slotKey={open} week={week} dates={dates} slots={slots} ctx={ctx} a={a}
            violations={r.violations} pending={pending} run={run} close={() => setOpen(null)} />
        )}
      </dialog>

      {toast && (
        <div role="status" className={`fixed bottom-5 left-1/2 z-50 max-w-[calc(100%-32px)] -translate-x-1/2 rounded-lg px-4 py-2.5 text-sm shadow-lg ${toast.bad ? "bg-bad text-surface" : "bg-ink text-surface"}`}>
          {toast.text}
        </div>
      )}
    </div>
  );
}

function ShiftDialog({ slotKey, week, dates, slots, ctx, a, violations, pending, run, close }: {
  slotKey: string; week: string; dates: string[]; slots: BoardSlot[]; ctx: Context; a: Assignment;
  violations: Record<string, string>; pending: boolean;
  run: (label: string, fn: () => Promise<{ error?: string; message?: string }>) => void; close: () => void;
}) {
  const s = slots.find((x) => x.key === slotKey)!;
  const names = new Map(ctx.employees.map((e) => [e.id, e]));
  const ids = a[slotKey] ?? [];
  const locked = ctx.locked[slotKey] ?? [];
  const full = ids.length >= s.required;
  const c = s.required > 0 ? candidates(ctx, a, slotKey) : { available: [], unavailable: [] };
  const small = "rounded-lg border border-line-strong px-2.5 py-1 text-xs font-medium hover:border-ink disabled:opacity-50";
  const tag = (t: string, tone = "") => <span className={`ms-1.5 rounded px-1.5 py-0.5 text-[11px] font-medium ${tone || "bg-background text-muted"}`}>{t}</span>;
  const empTags = (id: string) => {
    const e = names.get(id)!;
    return <>{e.isLead && tag("אחראי/ת")}{e.isMinor && tag("קטין/ה")}</>;
  };

  return (
    <div className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">{KIND_LABEL[s.kind]}, יום {WEEKDAYS[s.weekday]} {Number(dates[s.weekday].slice(8, 10))}.{Number(dates[s.weekday].slice(5, 7))}</h2>
          <p className="text-sm text-muted" dir="ltr" style={{ textAlign: "right" }}>{s.startTime}–{s.endTime}</p>
        </div>
        <button onClick={close} className="rounded-lg px-2 py-1 text-xl leading-none text-muted hover:text-ink" aria-label="סגירה">×</button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <span className="text-sm">עובדים נדרשים השבוע</span>
        <button className={small} disabled={pending || s.required <= 0} onClick={() => run("req", () => setRequired(week, slotKey, s.required - 1))} aria-label="פחות">−</button>
        <output className="min-w-6 text-center text-xl font-bold tabular-nums">{s.required}</output>
        <button className={small} disabled={pending || s.required >= 50} onClick={() => run("req", () => setRequired(week, slotKey, s.required + 1))} aria-label="יותר">+</button>
      </div>
      <p className="mt-1 text-xs text-muted">
        {s.required !== s.templateRequired
          ? <>שונה לשבוע הזה בלבד; בתבנית: {s.templateRequired}. <button className="underline" onClick={() => run("req", () => setRequired(week, slotKey, null))}>החזרה לתבנית</button></>
          : "שינוי כאן חל על השבוע הזה בלבד, למשל תגבור לערב חג או למבצע."}
      </p>

      {s.required > 0 && (
        <>
          <h3 className="mt-5 text-sm font-semibold text-muted">משובצים ({ids.length} מתוך {s.required})</h3>
          <ul className="divide-y divide-line">
            {ids.length ? ids.map((id) => (
              <li key={id} className="flex items-center justify-between gap-3 py-2">
                <div>
                  <strong>{names.get(id)?.name}</strong>{empTags(id)}
                  {violations[`${slotKey}|${id}`] && <div className="text-xs text-bad">{violations[`${slotKey}|${id}`]}</div>}
                  {locked.includes(id) && <div className="text-xs text-muted">נעול: השיבוץ האוטומטי לא יזיז אותו/ה</div>}
                </div>
                <div className="flex flex-none gap-1.5">
                  <button className={small} disabled={pending} aria-pressed={locked.includes(id)}
                    onClick={() => run("lock", () => setLocked(week, slotKey, id, !locked.includes(id)))}>
                    {locked.includes(id) ? "ביטול נעילה" : "נעילה"}
                  </button>
                  <button className={small} disabled={pending} onClick={() => run("un", () => unassign(week, slotKey, id))}>הסרה</button>
                </div>
              </li>
            )) : <li className="py-2 text-sm text-muted">אין עדיין</li>}
          </ul>

          <h3 className="mt-5 text-sm font-semibold text-muted">זמינים</h3>
          <ul className="divide-y divide-line">
            {c.available.length ? c.available.map((x) => (
              <li key={x.id} className="flex items-center justify-between gap-3 py-2">
                <div>
                  <strong>{names.get(x.id)?.name}</strong>{empTags(x.id)}
                  {x.prefers && tag("מעדיף/ה", "bg-ok-tint text-ok")}
                  {x.pendingLeave && tag("ביקש/ה חופשה", "bg-[#faefdb] text-[#99620f]")}
                  <div className="text-xs text-muted">{x.shifts} משמרות השבוע</div>
                </div>
                <button className={small} disabled={pending || full} title={full ? "המשמרת מלאה" : undefined}
                  onClick={() => run("as", () => assign(week, slotKey, x.id))}>שיבוץ</button>
              </li>
            )) : <li className="py-2 text-sm text-muted">אין עובדים זמינים שעומדים בכללים.</li>}
          </ul>

          {c.unavailable.length > 0 && (
            <>
              <h3 className="mt-5 text-sm font-semibold text-muted">לא מתאימים למשמרת הזו</h3>
              <ul className="divide-y divide-line">
                {c.unavailable.map((x) => (
                  <li key={x.id} className="flex items-center justify-between gap-3 py-2">
                    <div>
                      <strong>{names.get(x.id)?.name}</strong>{empTags(x.id)}
                      <div className="text-xs text-bad">{x.reason}</div>
                    </div>
                    <button className={small} disabled={pending || full}
                      onClick={() => confirm(`לשבץ בכל זאת? ${x.reason}.`) && run("as", () => assign(week, slotKey, x.id))}>
                      שיבוץ בכל זאת
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
      <div className="mt-5 flex justify-end">
        <button onClick={close} className="rounded-lg bg-ink px-4 py-2 font-semibold text-surface">סיום</button>
      </div>
    </div>
  );
}
