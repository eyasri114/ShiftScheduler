export const WEEKDAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"] as const;

export type ShiftKind = "morning" | "evening" | "night";
export const SHIFT_KINDS: ShiftKind[] = ["morning", "evening", "night"];
export const KIND_LABEL: Record<ShiftKind, string> = { morning: "בוקר", evening: "ערב", night: "לילה" };

/** Shift kinds a branch uses: morning/evening, or morning/evening/night. */
export const kindsForModel = (model: number): ShiftKind[] =>
  model === 3 ? SHIFT_KINDS : ["morning", "evening"];

/** Under 18 on the given date (Israeli youth employment rules). */
export function isMinor(birthDate: string | null | undefined, on: Date = new Date()): boolean {
  if (!birthDate) return false;
  const b = new Date(birthDate + "T00:00:00");
  const eighteen = new Date(b.getFullYear() + 18, b.getMonth(), b.getDate());
  return on < eighteen;
}
