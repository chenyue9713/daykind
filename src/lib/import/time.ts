// Timezone helpers for imports. Offsets are in minutes east of UTC.
import { localDateOf } from "@/lib/domain/dates";
import type { Instant, LocalDate } from "@/lib/domain/types";

/** The UTC offset of an IANA timezone at an instant. */
export function offsetMinutesAt(timeZone: string, instant: Instant | Date): number {
  const date = typeof instant === "string" ? new Date(instant) : instant;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const wallAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  const truncated = Math.floor(date.getTime() / 1000) * 1000;
  return Math.round((wallAsUtc - truncated) / 60_000);
}

/** The civil date at an instant shifted by a fixed offset. */
export function localDateAtOffset(instant: Instant, offsetMinutes: number): LocalDate {
  return new Date(Date.parse(instant) + offsetMinutes * 60_000).toISOString().slice(0, 10);
}

/**
 * Reads a wall-clock time (stored as if it were UTC) as local time in a
 * timezone. Nonexistent DST-gap times resolve forward; ambiguous times pick
 * the earlier offset.
 */
export function floatingToInstant(floating: Instant, timeZone: string): Instant {
  const wall = Date.parse(floating);
  let guess = wall;
  for (let i = 0; i < 3; i++) {
    const next = wall - offsetMinutesAt(timeZone, new Date(guess)) * 60_000;
    if (next === guess) break;
    guess = next;
  }
  return new Date(guess).toISOString();
}

export function formatOffset(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? "−" : "+";
  const abs = Math.abs(offsetMinutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
}

let zoneList: string[] | null = null;

/**
 * An IANA timezone that has `offsetMinutes` at `instant`. Whole-hour offsets
 * use the fixed `Etc/GMT±N` zones (whose sign is inverted by convention).
 */
export function timezoneForOffset(offsetMinutes: number, instant: Instant): string | null {
  if (offsetMinutes % 60 === 0 && Math.abs(offsetMinutes) <= 14 * 60) {
    const hours = -offsetMinutes / 60;
    const zone = hours === 0 ? "Etc/UTC" : `Etc/GMT${hours > 0 ? "+" : ""}${hours}`;
    if (offsetMinutesAt(zone, instant) === offsetMinutes) return zone;
  }
  zoneList ??= typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  return zoneList.find((zone) => offsetMinutesAt(zone, instant) === offsetMinutes) ?? null;
}

export { localDateOf };
