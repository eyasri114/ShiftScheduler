"use client";

import { useOptimistic, useState, useTransition } from "react";
import { KIND_LABEL, WEEKDAYS, type ShiftKind } from "@/lib/constants";
import type { WeekSlot } from "@/lib/branch-data";
import { clearWeek, setAvailability, type Level } from "./actions";

const NEXT: Record<"ok" | "prefer" | "cannot", Level> = { ok: "prefer", prefer: "cannot", cannot: null };
const LABEL = { ok: "זמין/ה", prefer: "מעדיף/ה", cannot: "לא יכול/ה" };
const STYLE = {
  ok: "border-line-strong bg-surface text-ink",
  prefer: "border-transparent bg-ok-tint text-ok",
  cannot: "border-transparent bg-bad-tint text-bad",
};

export type Blocked = Record<number, string>; // weekday -> reason (vacation, sick, rest day)

export function AvailabilityGrid({
  memberId, weekStart, kinds, slots, dates, initial, locked, blocked, allowedKinds,
}: {
  memberId: string;
  weekStart: string;
  kinds: ShiftKind[];
  slots: WeekSlot[];
  dates: string[];
  initial: Record<string, "prefer" | "cannot">;
  locked: boolean;
  blocked: Blocked;
  allowedKinds: ShiftKind[];
}) {
  const [values, setOptimistic] = useOptimistic(initial, (state, [key, level]: [string, Level]) => {
    const next = { ...state };
    if (level) next[key] = level; else delete next[key];
    return next;
  });
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const slotAt = (d: number, k: ShiftKind) => slots.find((s) => s.weekday === d && s.kind === k);

  function cycle(d: number, k: ShiftKind) {
    const key = `${d}-${k}`;
    const level = NEXT[values[key] ?? "ok"];
    setError(undefined);
    startTransition(async () => {
      setOptimistic([key, level]);
      const r = await setAvailability(memberId, weekStart, d, k, level);
      if (r.error) setError(r.error);
    });
  }

  const marks = Object.keys(values).length;

  function renderCell(d: number, k: ShiftKind) {
    const day = WEEKDAYS[d];
    const slot = slotAt(d, k);
    const reason = !slot ? "אין משמרת" : blocked[d] ?? (!allowedKinds.includes(k) ? "לא רלוונטי" : null);
    if (reason) {
      return (
        <span className="block rounded-lg border border-dashed border-line-strong px-1 py-3.5 text-center text-xs text-muted">
          {reason}
        </span>
      );
    }
    const state = values[`${d}-${k}`] ?? "ok";
    return (
      <button
        type="button"
        disabled={locked}
        onClick={() => cycle(d, k)}
        aria-label={`${KIND_LABEL[k]} יום ${day}, ${slot!.start}–${slot!.end}: ${LABEL[state]}`}
        className={`block w-full rounded-lg border px-1 py-2 text-center text-sm font-semibold transition disabled:cursor-default ${STYLE[state]} ${locked ? "opacity-70" : "hover:brightness-95"}`}
      >
        {LABEL[state]}
        <span className="block text-[11px] font-normal opacity-70" dir="ltr">{slot!.start}–{slot!.end}</span>
      </button>
    );
  }

  return (
    <div>
      {error && <p role="alert" className="mb-3 rounded-lg bg-bad-tint px-3 py-2 text-sm text-bad">{error}</p>}
      {/* phones: one card per day */}
      <div className="grid gap-2 sm:hidden">
        {WEEKDAYS.map((day, d) => (
          <div key={day} className="rounded-2xl border border-line bg-surface p-3">
            <div className="flex items-baseline justify-between">
              <strong>{day}</strong>
              <span className="text-xs text-muted">{Number(dates[d].slice(8, 10))}.{Number(dates[d].slice(5, 7))}</span>
            </div>
            <div className={`mt-2 grid gap-2 ${kinds.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
              {kinds.map((k) => (
                <div key={k}>
                  <span className="mb-1 block text-xs font-medium text-muted">{KIND_LABEL[k]}</span>
                  {renderCell(d, k)}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="hidden overflow-x-auto rounded-2xl border border-line bg-surface p-3 sm:block">
        <table className="w-full min-w-[640px] border-separate border-spacing-1.5">
          <thead>
            <tr>
              <th className="w-16" />
              {WEEKDAYS.map((day, d) => (
                <th key={day} className="text-center text-sm font-semibold">
                  {day}
                  <span className="block text-xs font-normal text-muted">{Number(dates[d].slice(8, 10))}.{Number(dates[d].slice(5, 7))}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {kinds.map((k) => (
              <tr key={k}>
                <th scope="row" className="text-start text-sm font-semibold">{KIND_LABEL[k]}</th>
                {WEEKDAYS.map((day, d) => <td key={day}>{renderCell(d, k)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
        <span>
          {locked ? "השבוע הזה כבר עבר, ואי אפשר לשנות בו אילוצים." : "לחיצה על משמרת עוברת בין זמין/ה, מעדיף/ה ולא יכול/ה. כל שינוי נשמר מיד."}
        </span>
        {!locked && marks > 0 && (
          <button type="button" className="underline underline-offset-4"
            onClick={() => startTransition(async () => {
              Object.keys(values).forEach((key) => setOptimistic([key, null]));
              const r = await clearWeek(memberId, weekStart);
              if (r.error) setError(r.error);
            })}>
            סמן/י הכול כזמין
          </button>
        )}
      </div>
    </div>
  );
}
