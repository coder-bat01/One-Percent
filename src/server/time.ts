import { Temporal } from "@js-temporal/polyfill";

export const now = () => Date.now();
export function dateAt(at: number, timezone: string): string {
  return Temporal.Instant.fromEpochMilliseconds(Math.floor(at))
    .toZonedDateTimeISO(timezone)
    .toPlainDate()
    .toString();
}
export function addDays(date: string, days: number): string {
  return Temporal.PlainDate.from(date).add({ days }).toString();
}
export function midnight(date: string, timezone: string): number {
  return Temporal.PlainDate.from(date).toZonedDateTime(timezone)
    .epochMilliseconds;
}
export function weekday(date: string): number {
  return Temporal.PlainDate.from(date).dayOfWeek;
}
export function dateRange(start: string, end: string): string[] {
  const result: string[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) result.push(day);
  return result;
}
export function period(
  range: "week" | "month",
  anchor: string,
): [string, string] {
  const day = Temporal.PlainDate.from(anchor);
  if (range === "week") {
    const start = day.subtract({ days: day.dayOfWeek - 1 });
    return [start.toString(), start.add({ days: 6 }).toString()];
  }
  return [
    day.with({ day: 1 }).toString(),
    day.with({ day: day.daysInMonth }).toString(),
  ];
}
