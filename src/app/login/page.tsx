import { Card } from "@/components/ui";
import { LoginForm } from "./login-form";

const ERRORS: Record<string, string> = {
  link: "קישור האישור לא תקין או שפג תוקפו. נסו להתחבר, או הירשמו שוב לקבלת קישור חדש.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <Card title="כניסה" subtitle="מנהלים ועובדים נכנסים מאותו מקום.">
      <LoginForm initialError={error ? ERRORS[error] : undefined} />
    </Card>
  );
}
