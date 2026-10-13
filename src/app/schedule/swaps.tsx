"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { ShiftKind } from "@/lib/constants";
import { cancelSwap, decideSwap, getSwapOptions, requestSwap, respondSwap, type SwapOption, type SwapResult } from "./swap-actions";

const small = "rounded-lg border border-line-strong px-2.5 py-1 text-xs font-semibold hover:border-ink disabled:opacity-50";
const primary = "rounded-lg bg-ink px-3 py-1 text-xs font-semibold text-surface disabled:opacity-60";

/** "החלפה" next to one of my shifts: give it away, or exchange it with a coworker's shift. */
export function SwapButton({ scheduleId, weekday, kind, label }: {
  scheduleId: string; weekday: number; kind: ShiftKind; label: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<SwapOption[] | null>(null);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<string>();
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open) return;
    dialog.current?.showModal();
    setOptions(null); setError(undefined); setDone(undefined); setNote("");
    getSwapOptions(scheduleId, weekday, kind).then((r) => (Array.isArray(r) ? setOptions(r) : setError(r.error)));
  }, [open, scheduleId, weekday, kind]);

  const send = (target: string, toDay: number | null, toKind: ShiftKind | null) => start(async () => {
    setError(undefined);
    const r = await requestSwap(scheduleId, weekday, kind, target, toDay, toKind, note);
    if (r.error) setError(r.error); else setDone(r.message);
  });

  const takers = options?.filter((o) => o.can_take) ?? [];
  const traders = options?.filter((o) => o.exchange.length) ?? [];

  return (
    <>
      <button className={small} onClick={() => setOpen(true)}>החלפה</button>
      <dialog ref={dialog} onClose={() => setOpen(false)} onClick={(e) => e.target === dialog.current && dialog.current?.close()}
        className="m-auto max-h-[calc(100dvh-3rem)] w-[min(520px,calc(100%-24px))] rounded-2xl bg-surface p-0 text-ink shadow-2xl backdrop:bg-black/50">
        {open && (
          <div className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold">החלפת משמרת</h2>
                <p className="text-sm text-muted">{label}</p>
              </div>
              <button onClick={() => dialog.current?.close()} className="px-2 text-xl leading-none text-muted hover:text-ink" aria-label="סגירה">×</button>
            </div>

            {done ? (
              <div className="mt-5">
                <p role="status" className="rounded-lg bg-ok-tint px-3 py-2 text-sm text-ok">{done}</p>
                <p className="mt-2 text-sm text-muted">תקבל/י התראה כשהבקשה תאושר או תידחה.</p>
              </div>
            ) : (
              <>
                {error && <p role="alert" className="mt-4 rounded-lg bg-bad-tint px-3 py-2 text-sm text-bad">{error}</p>}
                {!options && !error && <p className="mt-4 text-sm text-muted">בודק מי יכול/ה…</p>}
                {options && (
                  <>
                    <label className="mt-4 flex flex-col gap-1.5">
                      <span className="text-sm font-medium">הודעה לעמית/ה (לא חובה)</span>
                      <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200}
                        className="rounded-lg border border-line-strong bg-surface px-3 py-2" />
                    </label>

                    <h3 className="mt-5 text-sm font-semibold text-muted">למסור את המשמרת</h3>
                    {takers.length ? (
                      <ul className="divide-y divide-line">
                        {takers.map((o) => (
                          <li key={o.member_id} className="flex items-center justify-between gap-3 py-2">
                            <strong>{o.full_name}</strong>
                            <button className={small} disabled={pending} onClick={() => send(o.member_id, null, null)}>הצעה</button>
                          </li>
                        ))}
                      </ul>
                    ) : <p className="text-sm text-muted">אין עמיתים שיכולים לקחת את המשמרת בלי לשבור כלל שיבוץ.</p>}

                    <h3 className="mt-5 text-sm font-semibold text-muted">להחליף במשמרת של עמית/ה</h3>
                    {traders.length ? (
                      <ul className="divide-y divide-line">
                        {traders.map((o) => (
                          <li key={o.member_id} className="py-2">
                            <strong>{o.full_name}</strong>
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                              {o.exchange.map((x) => (
                                <button key={`${x.weekday}-${x.kind}`} className={small} disabled={pending}
                                  onClick={() => send(o.member_id, x.weekday, x.kind)}>
                                  ⇄ {x.label}
                                </button>
                              ))}
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : <p className="text-sm text-muted">אין משמרות שאפשר להחליף בלי לשבור כלל שיבוץ.</p>}
                    <p className="mt-4 text-xs text-muted">מוצגים רק עמיתים ומשמרות שעומדים בכל כללי השיבוץ (מנוחה, יום מנוחה, אילוצים, חופשות ועוד).</p>
                  </>
                )}
              </>
            )}
          </div>
        )}
      </dialog>
    </>
  );
}

type Act = "accept" | "decline" | "approve" | "reject" | "cancel";

/** The buttons on one swap request, for whoever is allowed to act on it. */
export function SwapAct({ id, actions }: { id: string; actions: Act[] }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<SwapResult>();
  const go = (fn: () => Promise<SwapResult>) => start(async () => setMsg(await fn()));
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {actions.includes("accept") && <button className={primary} disabled={pending} onClick={() => go(() => respondSwap(id, true))}>הסכמה</button>}
      {actions.includes("decline") && <button className={small} disabled={pending} onClick={() => go(() => respondSwap(id, false))}>דחייה</button>}
      {actions.includes("approve") && <button className={primary} disabled={pending} onClick={() => go(() => decideSwap(id, true))}>אישור</button>}
      {actions.includes("reject") && <button className={small} disabled={pending} onClick={() => go(() => decideSwap(id, false))}>דחייה</button>}
      {actions.includes("cancel") && <button className="px-1 text-xs text-muted underline underline-offset-4" disabled={pending} onClick={() => go(() => cancelSwap(id))}>ביטול הבקשה</button>}
      {msg && <span role="status" className={`text-xs ${msg.error ? "text-bad" : "text-ok"}`}>{msg.error ?? msg.message}</span>}
    </div>
  );
}
