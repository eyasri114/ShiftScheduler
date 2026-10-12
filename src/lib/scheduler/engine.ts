// Scheduling engine — pure TypeScript, no database or React, so it runs on the
// server (auto-schedule) and in the browser (instant checks on the board), and
// is unit-tested on its own.
//
// Hard rules (never broken by the engine; shown as problems if a manager
// overrides them by hand) and soft goals (weighed in a cost function) follow
// the specification. Approach: greedy construction that fills the hardest
// shifts first, then local search (move / swap), best of several restarts.

export type Kind = "morning" | "evening" | "night";
export const KINDS: Kind[] = ["morning", "evening", "night"];

export type Slot = {
  key: string;          // `${weekday}-${kind}`
  weekday: number;      // 0 = Sunday
  kind: Kind;
  required: number;
  startTime: string;    // "HH:MM"
  endTime: string;      // may be earlier than start → ends next day
  start: number;        // minutes from Sunday 00:00 of this week
  end: number;
};

export type Employee = {
  id: string;
  name: string;
  minShifts: number;
  maxShifts: number;
  isLead: boolean;
  isMinor: boolean;
  allowedKinds: Kind[];
  restWeekday: number | null;
};

export type Rules = { minRestHours: number; weeklyRestHours: number; requireLead: boolean };

export type Context = {
  slots: Slot[];
  employees: Employee[];
  /** `${employeeId}|${slotKey}` → preference. Missing = available. */
  availability: Record<string, "prefer" | "cannot">;
  /** `${employeeId}|${weekday}` → absence on that day. */
  absences: Record<string, "approved" | "pending">;
  /** Assignments the manager locked; the engine keeps them. */
  locked: Record<string, string[]>;
  rules: Rules;
};

/** slot key → employee ids */
export type Assignment = Record<string, string[]>;

const DAY = 1440;
const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

export function makeSlot(weekday: number, kind: Kind, required: number, startTime: string, endTime: string): Slot {
  const s = toMin(startTime);
  let e = toMin(endTime);
  if (e <= s) e += DAY;
  return { key: `${weekday}-${kind}`, weekday, kind, required, startTime, endTime,
    start: weekday * DAY + s, end: weekday * DAY + e };
}

// Israeli youth employment: no work between 22:00 and 06:00 (simplified; the
// exact limits depend on age and permits — verify with a labour lawyer).
const MINOR_START = 6 * 60, MINOR_END = 22 * 60;
function minorOk(slot: Slot) {
  const s = slot.start % DAY;
  const len = slot.end - slot.start;
  return s >= MINOR_START && s + len <= MINOR_END;
}

function onRestDay(emp: Employee, slot: Slot) {
  if (emp.restWeekday === null) return false;
  const r = emp.restWeekday * DAY;
  // also catches a night shift that runs into the rest day, and Saturday night into Sunday
  return [r, r + 7 * DAY].some((st) => slot.start < st + DAY && slot.end > st);
}

const shiftDayOf = (slot: Slot) => slot.weekday;

/** Why `emp` can't work `slot` given the other shifts they already have, or null. */
export function violation(emp: Employee, slot: Slot, otherKeys: string[], ctx: Context, byKey: Map<string, Slot>): string | null {
  if (ctx.absences[`${emp.id}|${slot.weekday}`] === "approved") return "בחופשה או במחלה";
  if (onRestDay(emp, slot)) return "יום המנוחה הקבוע שלו/ה";
  if (ctx.availability[`${emp.id}|${slot.key}`] === "cannot") return "סימן/ה שלא יכול/ה להגיע";
  if (!emp.allowedKinds.includes(slot.kind)) return "לא מוגדר/ת למשמרת כזו";
  if (emp.isMinor && !minorOk(slot)) return "קטין/ה: אסור לעבוד בין 22:00 ל-06:00";
  if (otherKeys.length + 1 > emp.maxShifts) return `מעל המקסימום (${emp.maxShifts} משמרות)`;

  const minRest = ctx.rules.minRestHours * 60;
  for (const k of otherKeys) {
    const o = byKey.get(k);
    if (!o) continue;
    if (shiftDayOf(o) === shiftDayOf(slot)) return "כבר משובץ/ת באותו יום";
    let gap: number;
    if (o.end <= slot.start) gap = slot.start - o.end;
    else if (slot.end <= o.start) gap = o.start - slot.end;
    else return "חופף למשמרת אחרת";
    if (gap < minRest) return `רק ${Math.round(gap / 6) / 10} שעות מנוחה בין משמרות`;
  }

  // longest continuous break in the week (wrapping around) must reach the weekly rest
  const iv = otherKeys.map((k) => byKey.get(k)).filter((x): x is Slot => !!x).concat([slot]).sort((a, b) => a.start - b.start);
  let prevEnd = 0, maxGap = 0;
  for (const x of iv) { maxGap = Math.max(maxGap, x.start - prevEnd); prevEnd = Math.max(prevEnd, x.end); }
  maxGap = Math.max(maxGap, 7 * DAY - prevEnd + (iv[0]?.start ?? 0));
  if (maxGap < ctx.rules.weeklyRestHours * 60) return `אין ${ctx.rules.weeklyRestHours} שעות מנוחה רצופות בשבוע`;
  return null;
}

// ---------------------------------------------------------------------------

type Prepared = {
  ctx: Context;
  byKey: Map<string, Slot>;
  empById: Map<string, Employee>;
  target: Map<string, number>;
  anyLead: boolean;
  nightEligible: Set<string>;
};

export function prepare(ctx: Context): Prepared {
  const byKey = new Map(ctx.slots.map((s) => [s.key, s]));
  const empById = new Map(ctx.employees.map((e) => [e.id, e]));
  const total = ctx.slots.reduce((a, s) => a + s.required, 0);
  const sumMax = ctx.employees.reduce((a, e) => a + e.maxShifts, 0) || 1;
  const target = new Map(ctx.employees.map((e) =>
    [e.id, Math.min(e.maxShifts, Math.max(e.minShifts, (total * e.maxShifts) / sumMax))]));
  return {
    ctx, byKey, empById, target,
    anyLead: ctx.employees.some((e) => e.isLead),
    nightEligible: new Set(ctx.employees.filter((e) => e.allowedKinds.includes("night") && !e.isMinor).map((e) => e.id)),
  };
}

const keysOf = (a: Assignment, id: string, p: Prepared) =>
  Object.keys(a).filter((k) => p.byKey.has(k) && a[k]?.includes(id));
const hasLead = (ids: string[], p: Prepared) => ids.some((id) => p.empById.get(id)?.isLead);

function cost(a: Assignment, p: Prepared): number {
  const { ctx } = p;
  let c = 0;
  for (const s of ctx.slots) {
    const ids = a[s.key] ?? [];
    if (ids.length < s.required) c += (s.required - ids.length) * 1000;
    if (ctx.rules.requireLead && p.anyLead && ids.length && !hasLead(ids, p)) c += 150;
  }
  const nights: number[] = [], weekends: number[] = [];
  for (const e of ctx.employees) {
    const list = keysOf(a, e.id, p).map((k) => p.byKey.get(k)!).sort((x, y) => x.start - y.start);
    const n = list.length;
    if (n < e.minShifts) c += (e.minShifts - n) * 80;
    c += (n - p.target.get(e.id)!) ** 2 * 6;
    let pref = 0, night = 0, we = 0;
    for (const s of list) {
      if (ctx.availability[`${e.id}|${s.key}`] === "prefer") pref++;
      if (ctx.absences[`${e.id}|${s.weekday}`] === "pending") c += 60;
      if (s.kind === "night") night++;
      if (s.weekday >= 5) we++;
    }
    c -= pref * 25;
    for (let i = 1; i < list.length; i++)
      if (list[i].weekday === list[i - 1].weekday + 1 && list[i].kind !== list[i - 1].kind) c += 8;
    if (p.nightEligible.has(e.id)) nights.push(night);
    weekends.push(we);
  }
  const variance = (xs: number[]) => {
    if (!xs.length) return 0;
    const m = xs.reduce((x, y) => x + y, 0) / xs.length;
    return xs.reduce((x, y) => x + (y - m) ** 2, 0);
  };
  return c + variance(nights) * 15 + variance(weekends) * 15;
}

function lockedIn(p: Prepared, current: Assignment): Assignment {
  const a: Assignment = {};
  for (const s of p.ctx.slots) {
    a[s.key] = (p.ctx.locked[s.key] ?? []).filter((id) => p.empById.has(id) && (current[s.key] ?? []).includes(id));
  }
  return a;
}

function greedy(p: Prepared, current: Assignment, rnd: () => number): Assignment {
  const { ctx } = p;
  const a = lockedIn(p, current);
  const eligible = (s: Slot) => ctx.employees.filter((e) =>
    e.allowedKinds.includes(s.kind) && !(e.isMinor && !minorOk(s)) &&
    ctx.availability[`${e.id}|${s.key}`] !== "cannot" && ctx.absences[`${e.id}|${s.weekday}`] !== "approved").length;
  const order = ctx.slots
    .map((s) => ({ s, r: eligible(s) / Math.max(1, s.required) + rnd() * 0.4 }))
    .sort((x, y) => x.r - y.r).map((x) => x.s);

  for (const s of order) {
    while (a[s.key].length < s.required) {
      let best: Employee | null = null, bestScore = Infinity;
      for (const e of ctx.employees) {
        if (a[s.key].includes(e.id)) continue;
        const ks = keysOf(a, e.id, p);
        if (violation(e, s, ks, ctx, p.byKey)) continue;
        let score = ks.length * 12 + (ks.length / Math.max(1, e.maxShifts)) * 25;
        if (ks.length < e.minShifts) score -= 40;
        if (ctx.availability[`${e.id}|${s.key}`] === "prefer") score -= 35;
        if (ctx.absences[`${e.id}|${s.weekday}`] === "pending") score += 60;
        if (ctx.rules.requireLead && e.isLead && !hasLead(a[s.key], p)) score -= 60;
        if (s.kind === "night") score += ks.filter((k) => p.byKey.get(k)!.kind === "night").length * 15;
        if (s.weekday >= 5) score += ks.filter((k) => p.byKey.get(k)!.weekday >= 5).length * 15;
        score += rnd() * 10;
        if (score < bestScore) { bestScore = score; best = e; }
      }
      if (!best) break;
      a[s.key].push(best.id);
    }
  }
  return a;
}

function localSearch(a: Assignment, p: Prepared, iterations: number, rnd: () => number): Assignment {
  const { ctx } = p;
  const slots = ctx.slots;
  if (!slots.length || !ctx.employees.length) return a;
  const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const lockedAt = (k: string) => ctx.locked[k] ?? [];
  let cur = cost(a, p);

  for (let i = 0; i < iterations; i++) {
    if (rnd() < 0.6) {
      // move: put someone into a slot, optionally taking someone out
      const s = pick(slots);
      const ids = a[s.key];
      const free = ids.filter((id) => !lockedAt(s.key).includes(id));
      let out: string | null = null;
      if (!(ids.length < s.required && (rnd() < 0.6 || !free.length))) {
        if (!free.length) continue;
        out = pick(free);
      }
      const inn = pick(ctx.employees);
      if (ids.includes(inn.id)) continue;
      if (out) ids.splice(ids.indexOf(out), 1);
      if (violation(inn, s, keysOf(a, inn.id, p), ctx, p.byKey)) { if (out) ids.push(out); continue; }
      ids.push(inn.id);
      const next = cost(a, p);
      if (next <= cur) cur = next;
      else { ids.splice(ids.indexOf(inn.id), 1); if (out) ids.push(out); }
    } else {
      // swap two people between two slots
      const s1 = pick(slots), s2 = pick(slots);
      if (s1 === s2) continue;
      const A = a[s1.key], B = a[s2.key];
      const fa = A.filter((id) => !lockedAt(s1.key).includes(id));
      const fb = B.filter((id) => !lockedAt(s2.key).includes(id));
      if (!fa.length || !fb.length) continue;
      const x = pick(fa), y = pick(fb);
      if (x === y || B.includes(x) || A.includes(y)) continue;
      A.splice(A.indexOf(x), 1); B.splice(B.indexOf(y), 1);
      let ok = !violation(p.empById.get(x)!, s2, keysOf(a, x, p), ctx, p.byKey);
      if (ok) {
        B.push(x);
        ok = !violation(p.empById.get(y)!, s1, keysOf(a, y, p), ctx, p.byKey);
        if (ok) A.push(y); else B.splice(B.indexOf(x), 1);
      }
      if (ok) {
        const next = cost(a, p);
        if (next <= cur) { cur = next; continue; }
        A.splice(A.indexOf(y), 1); B.splice(B.indexOf(x), 1);
      }
      A.push(x); B.push(y);
    }
  }
  return a;
}

/** Small deterministic random generator, so a seed reproduces a result in tests. */
export function seeded(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export function autoSchedule(ctx: Context, current: Assignment = {},
  opts: { restarts?: number; iterations?: number; random?: () => number } = {}): Assignment {
  const p = prepare(ctx);
  const rnd = opts.random ?? Math.random;
  let best: Assignment | null = null, bestCost = Infinity;
  for (let r = 0; r < (opts.restarts ?? 8); r++) {
    const a = localSearch(greedy(p, current, rnd), p, opts.iterations ?? 2500, rnd);
    const c = cost(a, p);
    if (c < bestCost) { bestCost = c; best = a; }
  }
  return best ?? {};
}

// ---------------------------------------------------------------------------
// Analysis for the board: problems, per-person stats, candidates for a shift.

export type Issue = { level: "bad" | "warn"; text: string; slotKey?: string };
export type Stat = { id: string; name: string; shifts: number; min: number; max: number; nights: number; weekend: number; preferred: number; preferredGot: number };

export function analyze(ctx: Context, a: Assignment, dayNames: string[], kindNames: Record<Kind, string>) {
  const p = prepare(ctx);
  const issues: Issue[] = [];
  const violations: Record<string, string> = {}; // `${slotKey}|${employeeId}` → reason
  let filled = 0, total = 0;
  const started = ctx.slots.some((s) => (a[s.key] ?? []).length);
  const label = (s: Slot) => `${kindNames[s.kind]}, יום ${dayNames[s.weekday]}`;

  for (const s of ctx.slots) {
    const ids = (a[s.key] ?? []).filter((id) => p.empById.has(id));
    total += s.required;
    filled += Math.min(ids.length, s.required);
    if (ids.length < s.required) issues.push({ level: "bad", text: `${label(s)}: חסרים ${s.required - ids.length}`, slotKey: s.key });
    if (ctx.rules.requireLead && p.anyLead && ids.length && !hasLead(ids, p))
      issues.push({ level: "warn", text: `${label(s)}: אין אחראי/ת משמרת`, slotKey: s.key });
  }
  const stats: Stat[] = [];
  for (const e of ctx.employees) {
    const ks = keysOf(a, e.id, p);
    const seen = new Set<string>();
    for (const k of ks) {
      const v = violation(e, p.byKey.get(k)!, ks.filter((x) => x !== k), ctx, p.byKey);
      if (v) {
        violations[`${k}|${e.id}`] = v;
        if (!seen.has(v)) { seen.add(v); issues.push({ level: "bad", text: `${e.name}: ${v}`, slotKey: k }); }
      }
    }
    if (started && ks.length < e.minShifts) issues.push({ level: "warn", text: `${e.name}: ${ks.length} משמרות, פחות מהמינימום (${e.minShifts})` });
    const prefs = Object.entries(ctx.availability).filter(([k, v]) => v === "prefer" && k.startsWith(e.id + "|") && p.byKey.has(k.split("|")[1]));
    stats.push({
      id: e.id, name: e.name, shifts: ks.length, min: e.minShifts, max: e.maxShifts,
      nights: ks.filter((k) => p.byKey.get(k)!.kind === "night").length,
      weekend: ks.filter((k) => p.byKey.get(k)!.weekday >= 5).length,
      preferred: prefs.length, preferredGot: prefs.filter(([k]) => ks.includes(k.split("|")[1])).length,
    });
  }
  issues.sort((x, y) => (x.level === "bad" ? 0 : 1) - (y.level === "bad" ? 0 : 1));
  return { issues, violations, stats, filled, total, started };
}

/** Who can (and can't) be added to a shift right now, with reasons. */
export function candidates(ctx: Context, a: Assignment, slotKey: string) {
  const p = prepare(ctx);
  const slot = p.byKey.get(slotKey);
  if (!slot) return { available: [], unavailable: [] };
  const inSlot = new Set(a[slotKey] ?? []);
  const available: { id: string; shifts: number; prefers: boolean; pendingLeave: boolean }[] = [];
  const unavailable: { id: string; reason: string }[] = [];
  for (const e of ctx.employees) {
    if (inSlot.has(e.id)) continue;
    const ks = keysOf(a, e.id, p).filter((k) => k !== slotKey);
    const v = violation(e, slot, ks, ctx, p.byKey);
    if (v) unavailable.push({ id: e.id, reason: v });
    else available.push({ id: e.id, shifts: ks.length,
      prefers: ctx.availability[`${e.id}|${slotKey}`] === "prefer",
      pendingLeave: ctx.absences[`${e.id}|${slot.weekday}`] === "pending" });
  }
  available.sort((x, y) => Number(y.prefers) - Number(x.prefers) || x.shifts - y.shifts);
  return { available, unavailable };
}
