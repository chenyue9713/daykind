// Onboarding and preferences (PRD FR01, FR05): timezone, units, optional
// weight tracking, and effective-dated weekly targets. Pure, so the same rules
// run in server actions and tests; the database enforces them again.
import type { FieldErrors, RawForm, Validation } from "./checkins";
import { addDays, weekStart } from "./dates";
import { DEFAULT_GOALS, goalsForWeek } from "./targets";
import type { DistanceUnit, GoalVersion, LocalDate, UserProfile, WeightUnit } from "./types";

export interface PreferencesInput {
  timezone: string;
  distanceUnit: DistanceUnit;
  weightUnit: WeightUnit;
  weightTrackingEnabled: boolean;
}

export interface TargetsInput {
  walkingSecondsPerDay: number;
  resistanceSessionsPerWeek: number;
  cyclingSecondsPerWeek: number;
}

/** Allowed target ranges, in the units the form uses. The database checks the same bounds. */
export const TARGET_LIMITS = {
  walkingMinutesPerDay: { min: 1, max: 240 },
  resistanceSessionsPerWeek: { min: 0, max: 14 },
  cyclingMinutesPerWeek: { min: 0, max: 1200 },
} as const;

// IANA names such as "America/Los_Angeles", "UTC", or "Etc/GMT+8". Raw
// offsets like "+05:00" are refused because they ignore daylight saving.
const TIMEZONE_PATTERN = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+){0,2}$/;

export function isValidTimezone(value: string): boolean {
  if (value.length > 64 || !TIMEZONE_PATTERN.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * The canonical spelling of a timezone (for example "Asia/Calcutta" becomes
 * "Asia/Kolkata" on runtimes that canonicalize), or null when it is not valid.
 */
export function canonicalTimezone(value: string | null | undefined): string | null {
  if (!value || !isValidTimezone(value)) return null;
  return new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions().timeZone;
}

/**
 * True when two names denote the same zone in this runtime. Engines spell
 * some zones differently (Asia/Kolkata or Asia/Calcutta), so a saved name and
 * a device's name are compared this way rather than as strings.
 */
export function sameTimezone(a: string, b: string): boolean {
  return a === b || (canonicalTimezone(a) !== null && canonicalTimezone(a) === canonicalTimezone(b));
}

/** Timezones offered in the picker; always includes `current` so a saved value stays selectable. */
export function timezoneOptions(current?: string): string[] {
  const zones = new Set(Intl.supportedValuesOf("timeZone"));
  zones.add("UTC");
  if (current) zones.add(current);
  return [...zones].sort();
}

/** The Monday after `today` (a Monday gives the following week's Monday). */
export function nextMonday(today: LocalDate): LocalDate {
  return addDays(weekStart(today), 7);
}

export function needsOnboarding(profile: UserProfile): boolean {
  return profile.onboardingCompletedAt === null;
}

export function sameTargets(a: TargetsInput, b: TargetsInput): boolean {
  return (
    a.walkingSecondsPerDay === b.walkingSecondsPerDay &&
    a.resistanceSessionsPerWeek === b.resistanceSessionsPerWeek &&
    a.cyclingSecondsPerWeek === b.cyclingSecondsPerWeek
  );
}

export interface TargetSchedule {
  /** Targets in effect this week. */
  current: GoalVersion;
  /** A saved change that starts on a later Monday, if any. */
  pending: GoalVersion | null;
  /** When a change saved today would start. */
  nextMonday: LocalDate;
}

export function targetSchedule(versions: GoalVersion[], today: LocalDate): TargetSchedule {
  const pending =
    versions.filter((g) => g.effectiveFrom > today).sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1))[0] ??
    null;
  return {
    current: goalsForWeek(versions, weekStart(today)) ?? DEFAULT_GOALS,
    pending,
    nextMonday: nextMonday(today),
  };
}

const checked = (value: string | undefined) => value === "on" || value === "true";

function wholeNumber(
  raw: string | undefined,
  name: string,
  { min, max }: { min: number; max: number },
  label: string,
  errors: FieldErrors,
): number {
  const text = raw?.trim() ?? "";
  const n = /^\d+$/.test(text) ? Number(text) : NaN;
  if (!Number.isInteger(n) || n < min || n > max) {
    errors[name] = `${label} must be a whole number from ${min} to ${max}.`;
  }
  return n;
}

export function validatePreferences(raw: RawForm): Validation<PreferencesInput> {
  const errors: FieldErrors = {};
  // Stored as chosen (not canonicalized) so it matches the device's spelling.
  const timezone = raw.timezone?.trim() ?? "";
  if (!isValidTimezone(timezone)) errors.timezone = "Choose a timezone from the list.";
  const distanceUnit = raw.distanceUnit === "km" || raw.distanceUnit === "mi" ? raw.distanceUnit : null;
  if (!distanceUnit) errors.distanceUnit = "Choose miles or kilometers.";
  const weightUnit = raw.weightUnit === "kg" || raw.weightUnit === "lb" ? raw.weightUnit : null;
  if (!weightUnit) errors.weightUnit = "Choose pounds or kilograms.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      timezone,
      distanceUnit: distanceUnit!,
      weightUnit: weightUnit!,
      weightTrackingEnabled: checked(raw.weightTracking),
    },
  };
}

export function validateTargets(raw: RawForm): Validation<TargetsInput> {
  const errors: FieldErrors = {};
  const walking = wholeNumber(raw.walkingMinutes, "walkingMinutes", TARGET_LIMITS.walkingMinutesPerDay, "Walking minutes", errors);
  const resistance = wholeNumber(
    raw.resistanceSessions,
    "resistanceSessions",
    TARGET_LIMITS.resistanceSessionsPerWeek,
    "Resistance sessions",
    errors,
  );
  const cycling = wholeNumber(raw.cyclingMinutes, "cyclingMinutes", TARGET_LIMITS.cyclingMinutesPerWeek, "Cycling minutes", errors);
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: { walkingSecondsPerDay: walking * 60, resistanceSessionsPerWeek: resistance, cyclingSecondsPerWeek: cycling * 60 },
  };
}

export interface OnboardingInput {
  preferences: PreferencesInput;
  targets: TargetsInput;
}

/** First-use setup: preferences, targets, and the required guidance acknowledgment. */
export function validateOnboarding(raw: RawForm): Validation<OnboardingInput> {
  const preferences = validatePreferences(raw);
  const targets = validateTargets(raw);
  const errors: FieldErrors = {
    ...(preferences.ok ? {} : preferences.errors),
    ...(targets.ok ? {} : targets.errors),
  };
  if (!checked(raw.acknowledgeGuidance)) {
    errors.acknowledgeGuidance = "Please confirm you've read how the guidance works.";
  }
  if (!preferences.ok || !targets.ok || Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { preferences: preferences.value, targets: targets.value } };
}
