// Civil-date helpers. Calendar math happens on YYYY-MM-DD strings so that
// daylight saving changes never shift a record onto a different day.
import type { DateRange, Instant, LocalDate } from "./types";

const DAY_MS = 86_400_000;

function toUtcMidnight(date: LocalDate): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUtcMidnight(ms: number): LocalDate {
  return new Date(ms).toISOString().slice(0, 10);
}

export function isLocalDate(value: string): value is LocalDate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return fromUtcMidnight(toUtcMidnight(value)) === value;
}

export function addDays(date: LocalDate, days: number): LocalDate {
  return fromUtcMidnight(toUtcMidnight(date) + days * DAY_MS);
}

export function daysBetween(start: LocalDate, end: LocalDate): number {
  return Math.round((toUtcMidnight(end) - toUtcMidnight(start)) / DAY_MS);
}

/** 0 = Monday … 6 = Sunday. */
export function isoWeekdayIndex(date: LocalDate): number {
  return (new Date(toUtcMidnight(date)).getUTCDay() + 6) % 7;
}

/** The Monday that starts the week containing `date`. */
export function weekStart(date: LocalDate): LocalDate {
  return addDays(date, -isoWeekdayIndex(date));
}

export function weekRange(start: LocalDate): DateRange {
  return { start, end: addDays(start, 6) };
}

/** The most recent fully completed Monday–Sunday week before `today`. */
export function previousWeekRange(today: LocalDate): DateRange {
  return weekRange(addDays(weekStart(today), -7));
}

export function datesInRange(range: DateRange): LocalDate[] {
  const count = daysBetween(range.start, range.end) + 1;
  return Array.from({ length: Math.max(count, 0) }, (_, i) => addDays(range.start, i));
}

export function inRange(date: LocalDate, range: DateRange): boolean {
  return date >= range.start && date <= range.end;
}

interface ZonedParts {
  date: LocalDate;
  hour: number;
  minute: number;
}

function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

/** The civil date of an instant in the given IANA timezone. */
export function localDateOf(instant: Date | Instant, timeZone: string): LocalDate {
  return zonedParts(typeof instant === "string" ? new Date(instant) : instant, timeZone).date;
}

/**
 * Converts a wall-clock time in a timezone to a UTC instant.
 * Nonexistent DST-gap times resolve forward; ambiguous times pick the earlier offset.
 */
export function zonedTimeToInstant(date: LocalDate, time: string, timeZone: string): Instant {
  const [hour, minute] = time.split(":").map(Number);
  const wallAsUtc = toUtcMidnight(date) + (hour * 60 + minute) * 60_000;
  let guess = wallAsUtc;
  for (let i = 0; i < 3; i++) {
    const p = zonedParts(new Date(guess), timeZone);
    const shownAsUtc = toUtcMidnight(p.date) + (p.hour * 60 + p.minute) * 60_000;
    const diff = wallAsUtc - shownAsUtc;
    if (diff === 0) break;
    guess += diff;
  }
  return new Date(guess).toISOString();
}

const shortDate = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

const longDate = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

export function formatLocalDate(date: LocalDate, style: "short" | "long" = "short"): string {
  const d = new Date(toUtcMidnight(date));
  return (style === "long" ? longDate : shortDate).format(d);
}

export function formatRange(range: DateRange): string {
  return `${formatLocalDate(range.start)} – ${formatLocalDate(range.end)}`;
}

/** Formats an instant's wall-clock time; manual activities may have no start time. */
export function formatTime(instant: Instant | null, timeZone: string): string {
  if (instant === null) return "Time not recorded";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(instant));
}
