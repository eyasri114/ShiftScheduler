"use client";

import { useActionState, useState } from "react";
import { Alert, Field, SubmitButton } from "@/components/ui";
import { KIND_LABEL, WEEKDAYS, kindsForModel, type ShiftKind } from "@/lib/constants";
import { saveSettings } from "./actions";

export type Slot = { weekday: number; kind: ShiftKind; start_time: string; end_time: string; required: number };
export type BranchSettings = {
  name: string; shift_model: number; min_rest_hours: number; weekly_rest_hours: number;
  require_shift_lead: boolean; closed_weekdays: number[]; swap_approval: "manager" | "auto";
};

const KIND_STYLE: Record<ShiftKind, string> = {
  morning: "border-t-[#d38c17]", evening: "border-t-[#6a55b4]", night: "border-t-[#22406e]",
};

export function SettingsForm({ branch, slots }: { branch: BranchSettings; slots: Slot[] }) {
  const [state, action] = useActionState(saveSettings, undefined);
  const [model, setModel] = useState(branch.shift_model);
  const [closed, setClosed] = useState(new Set(branch.closed_weekdays));
  const kinds = kindsForModel(model);
  const slot = (d: number, k: ShiftKind) => slots.find((s) => s.weekday === d && s.kind === k);
  const hhmm = (t?: string) => (t ?? "").slice(0, 5);

  return (
    <form action={action} className="flex flex-col gap-6">
      {state?.error && <Alert kind="error">{state.error}</Alert>}
      {state?.saved && <Alert kind="notice">ההגדרות נשמרו. הסידורים הבאים ייבנו לפיהן.</Alert>}

      <section className="rounded-2xl border border-line bg-surface p-5">
        <h2 className="text-lg font-bold">פרטי הסניף</h2>
        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          <Field label="שם הסניף" name="name" defaultValue={branch.name} required />
          <fieldset>
            <legend className="text-sm font-medium">שיטת משמרות</legend>
            <div className="mt-2.5 flex flex-wrap gap-5">
              {[2, 3].map((m) => (
                <label key={m} className="flex items-center gap-2">
                  <input type="radio" name="shift_model" value={m} checked={model === m}
                    onChange={() => setModel(m)} className="size-4 accent-ink" />
                  {m === 2 ? "בוקר וערב" : "בוקר, ערב ולילה"}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-surface p-5">
        <h2 className="text-lg font-bold">שעות ומספר עובדים לפי יום</h2>
        <p className="mt-1 text-sm text-muted">
          זו התבנית הקבועה של הסניף. 0 עובדים = אין משמרת כזו באותו יום. שינוי לשבוע מסוים (ערב חג, מבצע) ייעשה בלוח הסידור.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] border-separate border-spacing-y-1.5 text-sm">
            <thead>
              <tr className="text-muted">
                <th className="px-2 py-1 text-start font-medium">יום</th>
                <th className="px-2 py-1 text-start font-medium">פתוח</th>
                {kinds.map((k) => <th key={k} className="px-2 py-1 text-start font-medium">{KIND_LABEL[k]}</th>)}
              </tr>
            </thead>
            <tbody>
              {WEEKDAYS.map((day, d) => {
                const isClosed = closed.has(d);
                return (
                  <tr key={day}>
                    <th scope="row" className="px-2 text-start font-semibold">{day}</th>
                    <td className="px-2">
                      <input type="checkbox" name="open" value={d} checked={!isClosed} aria-label={`יום ${day} פתוח`}
                        onChange={(e) => {
                          const next = new Set(closed);
                          if (e.target.checked) next.delete(d); else next.add(d);
                          setClosed(next);
                        }} className="size-4 accent-ink" />
                    </td>
                    {kinds.map((k) => {
                      const s = slot(d, k);
                      return (
                        <td key={k} className="px-1">
                          <div className={`rounded-lg border border-line border-t-4 p-2 ${KIND_STYLE[k]} ${isClosed ? "opacity-40" : ""}`}>
                            <label className="flex items-center gap-2">
                              <span className="text-xs text-muted">עובדים</span>
                              <input type="number" name={`req-${d}-${k}`} min={0} max={50} defaultValue={s?.required ?? 0}
                                aria-label={`${KIND_LABEL[k]} יום ${day}: מספר עובדים`}
                                className="w-16 rounded-md border border-line-strong bg-surface px-2 py-1 tabular-nums" />
                            </label>
                            <div className="mt-1.5 flex items-center gap-1" dir="ltr">
                              <input type="time" name={`start-${d}-${k}`} defaultValue={hhmm(s?.start_time) || "07:00"} required
                                aria-label={`${KIND_LABEL[k]} יום ${day}: התחלה`}
                                className="w-[6.5rem] rounded-md border border-line-strong bg-surface px-1.5 py-1" />
                              <span className="text-muted">–</span>
                              <input type="time" name={`end-${d}-${k}`} defaultValue={hhmm(s?.end_time) || "15:00"} required
                                aria-label={`${KIND_LABEL[k]} יום ${day}: סיום`}
                                className="w-[6.5rem] rounded-md border border-line-strong bg-surface px-1.5 py-1" />
                            </div>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-surface p-5">
        <h2 className="text-lg font-bold">כללי שיבוץ</h2>
        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          <Field label="מנוחה מינימלית בין משמרות (שעות)" name="min_rest_hours" type="number" min={0} max={24}
            defaultValue={branch.min_rest_hours} required />
          <Field label="מנוחה שבועית רצופה (שעות)" name="weekly_rest_hours" type="number" min={0} max={72}
            defaultValue={branch.weekly_rest_hours} required />
        </div>
        <label className="mt-4 flex items-center gap-2">
          <input type="checkbox" name="require_shift_lead" defaultChecked={branch.require_shift_lead} className="size-4 accent-ink" />
          בכל משמרת צריך אחראי/ת משמרת
        </label>
        <p className="mt-3 text-xs text-muted">
          ברירות המחדל מבוססות על חוק שעות עבודה ומנוחה. כדאי לאמת אותן מול יועץ לפני שימוש אמיתי.
        </p>
      </section>

      <section className="rounded-2xl border border-line bg-surface p-5">
        <h2 className="text-lg font-bold">החלפות משמרות בין עובדים</h2>
        <p className="mt-1 text-sm text-muted">
          עובד/ת יכול/ה למסור משמרת לעמית/ה או להחליף איתו/ה משמרת, והעמית/ה צריך/ה להסכים. בכל מקרה ההחלפה מתבצעת רק אם שני העובדים עומדים בכל כללי השיבוץ.
        </p>
        <fieldset className="mt-4 grid gap-3">
          <legend className="sr-only">מי מאשר החלפות</legend>
          <label className="flex items-start gap-2.5">
            <input type="radio" name="swap_approval" value="manager" defaultChecked={branch.swap_approval !== "auto"} className="mt-1 size-4 accent-ink" />
            <span><strong>באישור מנהל</strong><span className="block text-sm text-muted">אחרי שהעמית/ה מסכים/ה, ההחלפה מחכה לאישורך בלוח הסידור.</span></span>
          </label>
          <label className="flex items-start gap-2.5">
            <input type="radio" name="swap_approval" value="auto" defaultChecked={branch.swap_approval === "auto"} className="mt-1 size-4 accent-ink" />
            <span><strong>אוטומטית</strong><span className="block text-sm text-muted">ההחלפה מתבצעת מיד כששני העובדים מסכימים, ואת/ה מקבל/ת הודעה עליה.</span></span>
          </label>
        </fieldset>
      </section>

      <div className="sm:max-w-xs">
        <SubmitButton pending="שומר…">שמירת הגדרות</SubmitButton>
      </div>
    </form>
  );
}
