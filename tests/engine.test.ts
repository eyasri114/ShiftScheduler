// Unit tests for the scheduling engine.  Run: npm run test:engine
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analyze, autoSchedule, candidates, makeSlot, seeded, violation, prepare,
  type Context, type Employee, type Kind,
} from "../src/lib/scheduler/engine.ts";

const DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const KN: Record<Kind, string> = { morning: "בוקר", evening: "ערב", night: "לילה" };

const emp = (id: string, o: Partial<Employee> = {}): Employee => ({
  id, name: id, minShifts: 2, maxShifts: 5, isLead: false, isMinor: false,
  allowedKinds: ["morning", "evening", "night"], restWeekday: null, ...o,
});

/** The demo branch: Sun–Fri, 3 morning + 3 evening, Thu evening 4, Fri morning 5, no Friday evening. */
function demo(): Context {
  const slots = [];
  for (let d = 0; d < 6; d++) {
    slots.push(makeSlot(d, "morning", d === 5 ? 5 : 3, "07:00", d === 5 ? "14:00" : "15:00"));
    if (d < 5) slots.push(makeSlot(d, "evening", d === 4 ? 4 : 3, "15:00", "23:00"));
  }
  const employees = [
    emp("dana", { minShifts: 3, isLead: true }), emp("avi", { minShifts: 3, isLead: true }),
    emp("maya", { maxShifts: 4 }), emp("yossi", { minShifts: 3 }),
    emp("noa", { maxShifts: 3, isMinor: true, allowedKinds: ["morning"] }), emp("omer", { maxShifts: 4 }),
    emp("shira", { minShifts: 3 }), emp("itay", { minShifts: 3, isLead: true }),
    emp("roni", { maxShifts: 4 }), emp("tamar", { maxShifts: 3 }),
    emp("ahmad", { minShifts: 3, restWeekday: 5 }), emp("olga", { maxShifts: 4, restWeekday: 0 }),
  ];
  return {
    slots, employees,
    availability: { "dana|0-evening": "cannot", "dana|5-morning": "prefer", "avi|1-morning": "cannot", "maya|0-morning": "prefer" },
    absences: { "tamar|3": "pending", "tamar|4": "pending", "omer|2": "approved" },
    locked: {},
    rules: { minRestHours: 8, weeklyRestHours: 36, requireLead: true },
  };
}

const run = (ctx: Context, current = {}) => autoSchedule(ctx, current, { random: seeded(42), restarts: 6, iterations: 2000 });

test("fills every shift of the demo branch with no rule broken", () => {
  const ctx = demo();
  const a = run(ctx);
  const r = analyze(ctx, a, DAYS, KN);
  assert.equal(r.filled, r.total, JSON.stringify(r.issues));
  assert.deepEqual(Object.keys(r.violations), []);
  assert.equal(r.issues.filter((i) => i.level === "bad").length, 0);
});

test("never uses someone who can't come, is absent, or is on their rest day", () => {
  const ctx = demo();
  const a = run(ctx);
  assert.ok(!a["0-evening"].includes("dana"), "dana marked she can't");
  assert.ok(!a["1-morning"].includes("avi"), "avi marked he can't");
  assert.ok(!a["2-morning"].includes("omer") && !a["2-evening"].includes("omer"), "omer is on approved leave");
  assert.ok(!a["5-morning"].includes("ahmad"), "ahmad rests on Friday");
  assert.ok(!a["0-morning"].includes("olga") && !a["0-evening"].includes("olga"), "olga rests on Sunday");
});

test("a minor is never put on a shift that ends after 22:00", () => {
  const ctx = demo();
  ctx.employees.find((e) => e.id === "noa")!.allowedKinds = ["morning", "evening"];
  const a = run(ctx);
  for (let d = 0; d < 5; d++) assert.ok(!a[`${d}-evening`].includes("noa"));
  const p = prepare(ctx);
  assert.match(violation(ctx.employees.find((e) => e.id === "noa")!, p.byKey.get("1-evening")!, [], ctx, p.byKey) ?? "", /קטין/);
});

test("rest between shifts: evening → next morning is 8 hours (ok at 8, refused at 12)", () => {
  const ctx = demo();
  const p = prepare(ctx);
  const dana = ctx.employees[0];
  assert.equal(violation(dana, p.byKey.get("2-morning")!, ["1-evening"], ctx, p.byKey), null);
  ctx.rules.minRestHours = 12;
  assert.match(violation(dana, p.byKey.get("2-morning")!, ["1-evening"], ctx, p.byKey) ?? "", /מנוחה/);
});

test("one shift per day and the weekly maximum are respected", () => {
  const ctx = demo();
  const a = run(ctx);
  const p = prepare(ctx);
  for (const e of ctx.employees) {
    const mine = Object.keys(a).filter((k) => a[k].includes(e.id));
    assert.ok(mine.length <= e.maxShifts, `${e.id} over max`);
    const days = mine.map((k) => p.byKey.get(k)!.weekday);
    assert.equal(new Set(days).size, days.length, `${e.id} twice in a day`);
  }
});

test("locked assignments stay where the manager put them", () => {
  const ctx = demo();
  ctx.locked = { "3-morning": ["tamar"] };
  const a = run(ctx, { "3-morning": ["tamar"] });
  assert.ok(a["3-morning"].includes("tamar"));
});

test("avoids people with a pending vacation request when possible", () => {
  const ctx = demo();
  const a = run(ctx);
  assert.ok(!a["3-morning"].includes("tamar") && !a["4-morning"].includes("tamar") &&
            !a["3-evening"].includes("tamar") && !a["4-evening"].includes("tamar"));
});

test("not enough people: reports what's missing instead of breaking rules", () => {
  const ctx = demo();
  ctx.employees = ctx.employees.slice(0, 4);
  const a = run(ctx);
  const r = analyze(ctx, a, DAYS, KN);
  assert.ok(r.filled < r.total);
  assert.ok(r.issues.some((i) => /חסרים/.test(i.text)));
  assert.deepEqual(Object.keys(r.violations), []);
});

test("candidates explain why someone can't be added", () => {
  const ctx = demo();
  const c = candidates(ctx, {}, "0-evening");
  assert.match(c.unavailable.find((u) => u.id === "dana")!.reason, /לא יכול/);
  assert.ok(c.available.some((x) => x.id === "avi"));
});

test("a 60-person branch with three shifts is scheduled in under 5 seconds", () => {
  const slots = [];
  for (let d = 0; d < 7; d++) {
    slots.push(makeSlot(d, "morning", 8, "07:00", "15:00"));
    slots.push(makeSlot(d, "evening", 8, "15:00", "23:00"));
    slots.push(makeSlot(d, "night", 3, "23:00", "07:00"));
  }
  const employees = Array.from({ length: 60 }, (_, i) => emp(`e${i}`, { isLead: i % 6 === 0, restWeekday: i % 7 }));
  const ctx: Context = { slots, employees, availability: {}, absences: {}, locked: {},
    rules: { minRestHours: 8, weeklyRestHours: 36, requireLead: true } };
  const t = Date.now();
  const a = autoSchedule(ctx, {}, { random: seeded(7) });
  const ms = Date.now() - t;
  const r = analyze(ctx, a, DAYS, KN);
  assert.equal(r.filled, r.total);
  assert.deepEqual(Object.keys(r.violations), []);
  assert.ok(ms < 5000, `took ${ms} ms`);
});
