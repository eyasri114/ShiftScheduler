"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signUp } from "@/app/auth/actions";
import { Alert, Field, SubmitButton } from "@/components/ui";

export function SignupForm() {
  const [state, action] = useActionState(signUp, undefined);

  if (state?.notice) {
    return (
      <div className="flex flex-col gap-4">
        <Alert kind="notice">{state.notice}</Alert>
        <p className="text-sm text-muted">לא הגיע? בדקו בתיקיית הספאם, או נסו שוב בעוד כמה דקות.</p>
        <Link href="/login" className="text-center text-sm font-semibold underline underline-offset-4">
          חזרה לכניסה
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      {state?.error && <Alert kind="error">{state.error}</Alert>}
      <Field label="שם מלא" name="full_name" autoComplete="name" required />
      <Field label="אימייל" name="email" type="email" autoComplete="email" dir="ltr" required defaultValue={state?.email}
        hint="עובדים: השתמשו באימייל שהמנהל רשם עבורכם, כדי שהחשבון יחובר לסניף." />
      <Field label="סיסמה" name="password" type="password" autoComplete="new-password" dir="ltr" minLength={8} required
        hint="לפחות 8 תווים." />
      <SubmitButton pending="יוצר חשבון…">הרשמה</SubmitButton>
      <p className="text-center text-sm text-muted">
        כבר יש לך חשבון?{" "}
        <Link href="/login" className="font-semibold text-ink underline underline-offset-4">
          כניסה
        </Link>
      </p>
    </form>
  );
}
