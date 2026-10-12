"use client";

import { useActionState, useEffect, useRef } from "react";
import { Alert, Field, SubmitButton } from "@/components/ui";
import { KIND_LABEL, WEEKDAYS, type ShiftKind } from "@/lib/constants";
import type { EmployeeFormState } from "./actions";

export type MemberValues = {
  full_name: string;
  email: string | null;
  phone: string | null;
  birth_date: string | null;
  role: "owner" | "manager" | "employee";
  is_shift_lead: boolean;
  allowed_kinds: ShiftKind[];
  rest_weekday: number | null;
  min_shifts: number;
  max_shifts: number;
};

const EMPTY: MemberValues = {
  full_name: "", email: null, phone: null, birth_date: null, role: "employee",
  is_shift_lead: false, allowed_kinds: ["morning", "evening", "night"],
  rest_weekday: null, min_shifts: 2, max_shifts: 5,
};

export function EmployeeForm({
  action,
  initial = EMPTY,
  kinds,
  canSetRole,
  submitLabel,
}: {
  action: (state: EmployeeFormState, form: FormData) => Promise<EmployeeFormState>;
  initial?: MemberValues;
  kinds: ShiftKind[];
  canSetRole: boolean;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState(action, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  const isNew = initial === EMPTY;

  // After adding someone, clear the form for the next one.
  useEffect(() => {
    if (state?.saved && isNew) formRef.current?.reset();
  }, [state, isNew]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-5">
      {state?.error && <Alert kind="error">{state.error}</Alert>}
      {state?.saved && <Alert kind="notice">{state.saved}</Alert>}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="שם מלא" name="full_name" defaultValue={initial.full_name} required />
        <Field label="אימייל (לכניסה לאפליקציה)" name="email" type="email" dir="ltr"
          defaultValue={initial.email ?? ""} hint="העובד/ת נרשמים עם האימייל הזה ומחוברים לסניף אוטומטית." />
        <Field label="טלפון" name="phone" type="tel" dir="ltr" defaultValue={initial.phone ?? ""} />
        <Field label="תאריך לידה" name="birth_date" type="date" defaultValue={initial.birth_date ?? ""}
          hint="עובד/ת מתחת לגיל 18 לא ישובצו למשמרות לילה." />
      </div>

      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="sr-only">היקף משרה</legend>
        <Field label="מינימום משמרות בשבוע" name="min_shifts" type="number" min={0} max={7}
          defaultValue={initial.min_shifts} required />
        <Field label="מקסימום משמרות בשבוע" name="max_shifts" type="number" min={0} max={7}
          defaultValue={initial.max_shifts} required />
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">יום מנוחה קבוע</span>
          <select name="rest_weekday" defaultValue={initial.rest_weekday ?? ""}
            className="rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-base">
            <option value="">ללא</option>
            {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
          </select>
          <span className="text-xs text-muted">למשל ראשון לעובד/ת נוצרי/ה, שישי לעובד/ת מוסלמי/ת.</span>
        </label>
      </fieldset>

      <fieldset>
        <legend className="text-sm font-medium">משמרות שהעובד/ת יכול/ה לעבוד</legend>
        <div className="mt-2 flex flex-wrap gap-4">
          {kinds.map((k) => (
            <label key={k} className="flex items-center gap-2">
              <input type="checkbox" name="allowed_kinds" value={k} defaultChecked={initial.allowed_kinds.includes(k)}
                className="size-4 accent-ink" />
              {KIND_LABEL[k]}
            </label>
          ))}
          {/* Keep night permission when the branch doesn't use night shifts right now. */}
          {!kinds.includes("night") && initial.allowed_kinds.includes("night") && (
            <input type="hidden" name="allowed_kinds" value="night" />
          )}
        </div>
      </fieldset>

      <div className="flex flex-wrap gap-x-8 gap-y-3">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="is_shift_lead" defaultChecked={initial.is_shift_lead} className="size-4 accent-ink" />
          אחראי/ת משמרת
        </label>
        {canSetRole && initial.role !== "owner" && (
          <label className="flex items-center gap-2">
            <span>תפקיד</span>
            <select name="role" defaultValue={initial.role}
              className="rounded-lg border border-line-strong bg-surface px-2 py-1.5">
              <option value="employee">עובד/ת</option>
              <option value="manager">מנהל/ת סניף</option>
            </select>
          </label>
        )}
      </div>

      <div className="sm:max-w-xs">
        <SubmitButton pending="שומר…">{submitLabel}</SubmitButton>
      </div>
    </form>
  );
}
