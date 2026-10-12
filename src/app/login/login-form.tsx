"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signIn } from "@/app/auth/actions";
import { Alert, Field, SubmitButton } from "@/components/ui";

export function LoginForm({ initialError }: { initialError?: string }) {
  const [state, action] = useActionState(signIn, initialError ? { error: initialError } : undefined);

  return (
    <form action={action} className="flex flex-col gap-4">
      {state?.error && <Alert kind="error">{state.error}</Alert>}
      <Field label="אימייל" name="email" type="email" autoComplete="email" dir="ltr" required defaultValue={state?.email} />
      <Field label="סיסמה" name="password" type="password" autoComplete="current-password" dir="ltr" required />
      <SubmitButton pending="מתחבר…">כניסה</SubmitButton>
      <p className="text-center text-sm text-muted">
        אין לך חשבון?{" "}
        <Link href="/signup" className="font-semibold text-ink underline underline-offset-4">
          הרשמה
        </Link>
      </p>
    </form>
  );
}
