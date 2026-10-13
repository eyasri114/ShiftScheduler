import { createClient } from "@/lib/supabase/server";
import { KIND_LABEL, WEEKDAYS, type ShiftKind } from "@/lib/constants";
import { addDays, todayIso } from "@/lib/week";
import { SwapAct } from "./swaps";

type Swap = {
  id: string; requester_id: string; target_id: string;
  from_weekday: number; from_kind: ShiftKind; to_weekday: number | null; to_kind: ShiftKind | null;
  note: string | null; status: string; failure_reason: string | null; updated_at: string;
  schedules: { week_start: string; branch_id: string };
};

const shift = (week: string, d: number, k: ShiftKind) => {
  const date = addDays(week, d);
  return `${KIND_LABEL[k]}, יום ${WEEKDAYS[d]} ${Number(date.slice(8, 10))}.${Number(date.slice(5, 7))}`;
};

/**
 * Swap requests the viewer is part of (employee) or responsible for (manager).
 * Row-level security decides which rows come back.
 */
export async function SwapList({ branchId, myId, isManager, approvalMode }: {
  branchId: string; myId: string; isManager: boolean; approvalMode?: "manager" | "auto";
}) {
  const supabase = await createClient();
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [{ data }, { data: roster }] = await Promise.all([
    supabase.from("shift_swaps")
      .select("id, requester_id, target_id, from_weekday, from_kind, to_weekday, to_kind, note, status, failure_reason, updated_at, schedules!inner(week_start, branch_id)")
      .eq("schedules.branch_id", branchId)
      .or(`status.in.(pending_peer,pending_manager),updated_at.gte.${since}`)
      .order("updated_at", { ascending: false }).limit(40),
    supabase.rpc("branch_roster", { p_branch: branchId }),
  ]);
  const names = new Map(((roster ?? []) as { member_id: string; full_name: string }[]).map((r) => [r.member_id, r.full_name]));
  const today = todayIso();
  const swaps = ((data ?? []) as unknown as Swap[])
    // past shifts drop off the list
    .filter((s) => addDays(s.schedules.week_start, s.from_weekday) >= today || !s.status.startsWith("pending"));

  const name = (id: string) => (id === myId ? "את/ה" : names.get(id) ?? "—");
  const what = (s: Swap) => s.to_weekday === null
    ? <>{name(s.requester_id)} מוסר/ת ל{name(s.target_id)}: <strong>{shift(s.schedules.week_start, s.from_weekday, s.from_kind)}</strong></>
    : <>{name(s.requester_id)} ⇄ {name(s.target_id)}: <strong>{shift(s.schedules.week_start, s.from_weekday, s.from_kind)}</strong> תמורת <strong>{shift(s.schedules.week_start, s.to_weekday, s.to_kind!)}</strong></>;
  const status = (s: Swap): [string, string] => ({
    pending_peer: [`ממתין לתשובה של ${names.get(s.target_id) ?? ""}`, "text-[#99620f] dark:text-[#e3aa55]"],
    pending_manager: ["ממתין לאישור המנהל", "text-[#99620f] dark:text-[#e3aa55]"],
    approved: ["ההחלפה בוצעה", "text-ok"],
    rejected: ["המנהל לא אישר", "text-bad"],
    declined: ["נדחתה", "text-bad"],
    cancelled: ["בוטלה", "text-muted"],
    failed: [`לא התאפשרה: ${s.failure_reason ?? ""}`, "text-bad"],
  } as Record<string, [string, string]>)[s.status] ?? [s.status, "text-muted"];

  const actionsFor = (s: Swap) => {
    if (s.status === "pending_peer" && s.target_id === myId) return ["accept", "decline"] as const;
    if (s.status === "pending_manager" && isManager && s.requester_id !== myId) return ["approve", "reject"] as const;
    if (s.status.startsWith("pending") && s.requester_id === myId) return ["cancel"] as const;
    return [] as const;
  };

  // just-decided requests stay at the top for a moment, so the confirmation stays on screen
  const now = Date.now();
  const top = (s: Swap) => s.status.startsWith("pending") || now - Date.parse(s.updated_at) < 120_000;
  const open = swaps.filter(top);
  const recent = swaps.filter((s) => !top(s));
  const waitingForMe = open.filter((s) => actionsFor(s).some((a) => a !== "cancel")).length;
  if (!isManager && !swaps.length) return null;

  return (
    <section className="mt-6 rounded-2xl border border-line bg-surface p-5 print:hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold">
          החלפות משמרות{waitingForMe > 0 && <span className="ms-2 rounded-full bg-bad px-2 py-0.5 text-xs text-surface">{waitingForMe} ממתינות לך</span>}
        </h2>
        {isManager && approvalMode && (
          <a href="/settings" className="text-xs text-muted underline underline-offset-4">
            {approvalMode === "auto" ? "החלפות מתבצעות אוטומטית" : "החלפות דורשות את אישורך"} · שינוי בהגדרות
          </a>
        )}
      </div>
      {!swaps.length && <p className="mt-2 text-sm text-muted">אין בקשות החלפה. עובדים מבקשים החלפה ממסך הסידור שלהם.</p>}
      {open.length > 0 && (
        <ul className="mt-2 divide-y divide-line">
          {open.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
              <div className="text-sm">
                <div>{what(s)}</div>
                {s.note && <div className="text-muted">״{s.note}״</div>}
                <div className={`text-xs ${status(s)[1]}`}>{status(s)[0]}</div>
              </div>
              <SwapAct id={s.id} actions={[...actionsFor(s)]} />
            </li>
          ))}
        </ul>
      )}
      {recent.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-sm text-muted">אחרונות ({recent.length})</summary>
          <ul className="mt-1 divide-y divide-line">
            {recent.map((s) => (
              <li key={s.id} className="py-2 text-sm">
                <div>{what(s)}</div>
                <div className={`text-xs ${status(s)[1]}`}>{status(s)[0]}</div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
