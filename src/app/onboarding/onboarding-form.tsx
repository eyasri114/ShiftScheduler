"use client";

import { useActionState } from "react";
import { createBusiness } from "@/app/auth/actions";
import { Alert, Field, SubmitButton } from "@/components/ui";

export function OnboardingForm({ defaultName }: { defaultName: string }) {
  const [state, action] = useActionState(createBusiness, undefined);
  return (
    <form action={action} className="flex flex-col gap-4">
      {state?.error && <Alert kind="error">{state.error}</Alert>}
      <Field label="שם העסק" name="org_name" placeholder="למשל: קפה הנמל" required />
      <Field label="שם הסניף הראשון" name="branch_name" placeholder="למשל: סניף מרכז" required
        hint="אפשר להוסיף סניפים נוספים בהמשך." />
      <Field label="השם שלך" name="full_name" defaultValue={defaultName} required />
      <SubmitButton pending="פותח את העסק…">פתיחת העסק</SubmitButton>
    </form>
  );
}
