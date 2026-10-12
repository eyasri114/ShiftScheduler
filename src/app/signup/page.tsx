import { Card } from "@/components/ui";
import { SignupForm } from "./signup-form";

export default function SignupPage() {
  return (
    <Card title="הרשמה" subtitle="בעלי עסקים פותחים כאן עסק חדש; עובדים מצטרפים לסניף שלהם.">
      <SignupForm />
    </Card>
  );
}
