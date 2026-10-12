import { redirect } from "next/navigation";
import { Card } from "@/components/ui";
import { getMyContext } from "@/lib/context";
import { signOut } from "@/app/auth/actions";
import { OnboardingForm } from "./onboarding-form";

export default async function OnboardingPage() {
  const { user, context } = await getMyContext();
  if (!user) redirect("/login");
  if (context) redirect("/");

  return (
    <Card
      title="פתיחת עסק חדש"
      subtitle="החשבון שלך עוד לא משויך לעסק. אם את/ה עובד/ת, בקש/י מהמנהל להוסיף אותך עם האימייל הזה."
    >
      <OnboardingForm defaultName={String(user.user_metadata?.full_name ?? "")} />
      <p className="mt-4 text-center text-xs text-muted" dir="ltr">{user.email}</p>
      <form action={signOut} className="mt-2 text-center">
        <button className="text-sm text-muted underline underline-offset-4">יציאה</button>
      </form>
    </Card>
  );
}
