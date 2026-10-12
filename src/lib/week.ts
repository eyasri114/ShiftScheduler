// Dates are handled as plain "YYYY-MM-DD" strings in local time, so a shift on
// Friday stays on Friday whatever the server's time zone.

const pad = (n: number) => String(n).padStart(2, "0");

export const toIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function fromIso(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(iso: string, n: number): string {
  const d = fromIso(iso);
  d.setDate(d.getDate() + n);
  return toIso(d);
}

export const isIsoDate = (s: unknown): s is string =>
  typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(fromIso(s).getTime());

/** Today in Israel, regardless of where the server runs. */
export function todayIso(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());
}

/** The Sunday that starts the week containing `iso`. */
export function weekStartOf(iso: string): string {
  return addDays(iso, -fromIso(iso).getDay());
}

/** Next week's Sunday — the week employees submit constraints for. */
export const nextWeekStart = () => addDays(weekStartOf(todayIso()), 7);

/** A valid Sunday from a URL parameter, or next week. */
export function weekParam(value: string | string[] | undefined): string {
  const v = Array.isArray(value) ? value[0] : value;
  return isIsoDate(v) && fromIso(v).getDay() === 0 ? v : nextWeekStart();
}

export const shortDate = (iso: string) => {
  const d = fromIso(iso);
  return `${d.getDate()}.${d.getMonth() + 1}`;
};

export const weekRange = (weekStart: string) => {
  const end = fromIso(addDays(weekStart, 6));
  return `${shortDate(weekStart)}–${end.getDate()}.${end.getMonth() + 1}.${end.getFullYear()}`;
};

export const dateRange = (from: string, to: string) =>
  from === to ? shortDate(from) : `${shortDate(from)}–${shortDate(to)}`;

export const daysBetween = (from: string, to: string) =>
  Math.round((fromIso(to).getTime() - fromIso(from).getTime()) / 86_400_000) + 1;
