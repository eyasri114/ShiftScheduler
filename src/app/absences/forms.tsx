"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Alert, Field, SubmitButton } from "@/components/ui";
import { attachCertificate, requestAbsence, type AbsenceFormState } from "./actions";

export function AbsenceForm({
  employees, defaultDate,
}: {
  employees?: { id: string; full_name: string }[]; // managers can file for an employee
  defaultDate: string;
}) {
  const [state, action] = useActionState(requestAbsence, undefined);
  const [type, setType] = useState<"vacation" | "sick">("vacation");
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.saved) { ref.current?.reset(); setType("vacation"); } }, [state]);

  return (
    <form ref={ref} action={action} className="flex flex-col gap-4">
      {state?.error && <Alert kind="error">{state.error}</Alert>}
      {state?.saved && <Alert kind="notice">{state.saved}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        {employees && (
          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="text-sm font-medium">עובד/ת</span>
            <select name="member_id" className="rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-base">
              {employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </select>
          </label>
        )}
        <fieldset className="sm:col-span-2">
          <legend className="text-sm font-medium">סוג</legend>
          <div className="mt-2 flex gap-5">
            {(["vacation", "sick"] as const).map((t) => (
              <label key={t} className="flex items-center gap-2">
                <input type="radio" name="type" value={t} checked={type === t} onChange={() => setType(t)} className="size-4 accent-ink" />
                {t === "vacation" ? "חופשה" : "מחלה"}
              </label>
            ))}
          </div>
        </fieldset>
        <Field label="מתאריך" name="start_date" type="date" defaultValue={defaultDate} required />
        <Field label="עד תאריך" name="end_date" type="date" defaultValue={defaultDate} required />
        <div className="sm:col-span-2">
          <Field label="הערה (לא חובה)" name="note" />
        </div>
        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="text-sm font-medium">{type === "sick" ? "אישור מחלה (לא חובה עכשיו)" : "קובץ מצורף (לא חובה)"}</span>
          <input type="file" name="file" accept="image/*,application/pdf"
            className="rounded-lg border border-dashed border-line-strong bg-surface px-3 py-2.5 text-sm file:me-3 file:rounded-md file:border-0 file:bg-ink file:px-3 file:py-1.5 file:text-surface" />
          <span className="text-xs text-muted">
            {type === "sick"
              ? "צילום מהטלפון או PDF, עד 10MB. אפשר לצרף גם מאוחר יותר. רק את/ה והמנהל רואים את הקובץ."
              : "תמונה או PDF, עד 10MB."}
          </span>
        </label>
      </div>
      <div className="sm:max-w-xs">
        <SubmitButton pending="שולח…">{type === "sick" ? "דיווח מחלה" : "שליחת בקשת חופשה"}</SubmitButton>
      </div>
    </form>
  );
}

export function AttachForm({ absenceId }: { absenceId: string }) {
  const [state, action] = useActionState(
    (s: AbsenceFormState, f: FormData) => attachCertificate(absenceId, s, f), undefined);
  return (
    <form action={action} className="mt-2 flex flex-wrap items-center gap-2">
      <input type="file" name="file" accept="image/*,application/pdf" required aria-label="קובץ אישור מחלה"
        className="max-w-60 text-xs file:me-2 file:rounded-md file:border file:border-line-strong file:bg-surface file:px-2 file:py-1" />
      <button className="rounded-lg border border-line-strong px-2.5 py-1 text-xs font-medium hover:border-ink">העלאה</button>
      {state?.error && <span className="text-xs text-bad">{state.error}</span>}
      {state?.saved && <span className="text-xs text-ok">{state.saved}</span>}
    </form>
  );
}
