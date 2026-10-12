/** Hebrew messages for the Supabase Auth errors people actually run into. */
export function authErrorMessage(message: string | undefined): string {
  const m = (message ?? "").toLowerCase();
  if (m.includes("invalid login credentials")) return "האימייל או הסיסמה שגויים.";
  if (m.includes("email not confirmed")) return "צריך לאשר את כתובת האימייל. בדקו את תיבת הדואר ולחצו על הקישור.";
  if (m.includes("already registered") || m.includes("already been registered"))
    return "כבר קיים חשבון עם האימייל הזה. אפשר להתחבר.";
  if (m.includes("password should be") || m.includes("weak password"))
    return "הסיסמה קצרה או חלשה מדי. בחרו לפחות 8 תווים.";
  if (m.includes("rate limit") || m.includes("too many"))
    return "יותר מדי ניסיונות. נסו שוב בעוד כמה דקות.";
  if (m.includes("invalid email") || m.includes("unable to validate email"))
    return "כתובת האימייל לא תקינה.";
  if (m.includes("fetch failed") || m.includes("network"))
    return "אין חיבור לשרת. בדקו את החיבור לאינטרנט ונסו שוב.";
  return "משהו השתבש. נסו שוב.";
}
