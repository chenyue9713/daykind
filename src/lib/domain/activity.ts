// Canonical activity rules shared by manual entry and workout import
// (PRD FR03, FR04, FR05). Pure functions; see doc/activity-contract.md.
import { isLocalDate, localDateOf } from "./dates";
import type { FieldErrors } from "./checkins";
import type {
  Activity,
  ActivityType,
  DurationBasis,
  FieldProvenanceMap,
  Instant,
  Intensity,
  LocalDate,
} from "./types";

/** Proposed duplicate window (PRD FR04): start within ±2 minutes… */
export const DUPLICATE_START_TOLERANCE_SECONDS = 120;
/** …and goal duration within ±10 percent. */
export const DUPLICATE_DURATION_TOLERANCE = 0.1;

export const MAX_ACTIVITY_SECONDS = 24 * 3600;
export const MAX_NOTE_LENGTH = 500;

const activityTypes: readonly ActivityType[] = ["walking", "cycling", "resistance", "other"];
const intensities: readonly Intensity[] = ["easy", "moderate", "hard", "unknown"];
const bases: readonly DurationBasis[] = ["active", "elapsed", "reported"];

/** The writable part of an activity. Units: seconds, meters, beats per minute. */
export interface ActivityDraft {
  type: ActivityType;
  startedAt: Instant | null;
  /** Must equal the local date of `startedAt` in `timezone` when a start is known. */
  localDate: LocalDate;
  timezone: string;
  elapsedSeconds: number | null;
  activeSeconds: number | null;
  reportedSeconds: number | null;
  durationBasis: DurationBasis;
  distanceMeters: number | null;
  avgHeartRateBpm: number | null;
  maxHeartRateBpm: number | null;
  intensity: Intensity;
  note: string | null;
  fieldProvenance: FieldProvenanceMap;
}

type DurationFields = Pick<Activity, "durationBasis" | "activeSeconds" | "elapsedSeconds" | "reportedSeconds">;

/** Seconds that count toward goals, compared raw before any display rounding. */
export function goalSecondsOf(activity: DurationFields): number {
  const value =
    activity.durationBasis === "active"
      ? activity.activeSeconds
      : activity.durationBasis === "elapsed"
        ? activity.elapsedSeconds
        : activity.reportedSeconds;
  return value ?? 0;
}

/**
 * Picks the goal basis for measured data: timer/active time when present,
 * otherwise elapsed time (which screens label as a fallback).
 */
export function measuredDurationBasis(activeSeconds: number | null): DurationBasis {
  return activeSeconds !== null ? "active" : "elapsed";
}

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value.length > 0;
  } catch {
    return false;
  }
}

function checkSeconds(errors: FieldErrors, field: string, value: number | null, label: string) {
  if (value === null) return;
  if (!Number.isInteger(value) || value < 0 || value > MAX_ACTIVITY_SECONDS) {
    errors[field] = `${label} must be whole seconds between 0 and 24 hours.`;
  }
}

function checkHeartRate(errors: FieldErrors, field: string, value: number | null) {
  if (value === null) return;
  if (!Number.isInteger(value) || value < 25 || value > 250) errors[field] = "Heart rate must be 25–250 bpm.";
}

/** Server-side checks every activity write must pass, manual or imported. Empty means valid. */
export function validateActivityDraft(draft: ActivityDraft): FieldErrors {
  const errors: FieldErrors = {};
  if (!activityTypes.includes(draft.type)) errors.type = "Choose an activity type.";
  if (!intensities.includes(draft.intensity)) errors.intensity = "Choose an effort level or “Not sure”.";
  if (!isTimeZone(draft.timezone)) errors.timezone = "The activity timezone is not a valid IANA timezone.";
  if (!isLocalDate(draft.localDate)) errors.localDate = "Choose the date of the activity.";
  if (draft.startedAt !== null) {
    if (Number.isNaN(Date.parse(draft.startedAt))) errors.startedAt = "The start time is not valid.";
    else if (!errors.timezone && !errors.localDate && localDateOf(draft.startedAt, draft.timezone) !== draft.localDate) {
      errors.localDate = "The activity date must be the local date it started.";
    }
  }

  checkSeconds(errors, "elapsedSeconds", draft.elapsedSeconds, "Elapsed time");
  checkSeconds(errors, "activeSeconds", draft.activeSeconds, "Active time");
  checkSeconds(errors, "reportedSeconds", draft.reportedSeconds, "Duration");
  if (!bases.includes(draft.durationBasis)) errors.durationBasis = "Unknown duration basis.";
  else {
    const field = `${draft.durationBasis}Seconds` as const;
    const value = draft[field];
    if (value === null || value <= 0) errors[field] ??= "Enter how long the activity lasted.";
  }
  if (draft.activeSeconds !== null && draft.elapsedSeconds !== null && draft.activeSeconds > draft.elapsedSeconds) {
    errors.activeSeconds = "Active time cannot be longer than elapsed time.";
  }

  if (draft.distanceMeters !== null && !(Number.isFinite(draft.distanceMeters) && draft.distanceMeters >= 0 && draft.distanceMeters <= 1_000_000)) {
    errors.distanceMeters = "Distance must be between 0 and 1,000 km.";
  }
  checkHeartRate(errors, "avgHeartRateBpm", draft.avgHeartRateBpm);
  checkHeartRate(errors, "maxHeartRateBpm", draft.maxHeartRateBpm);
  if (draft.avgHeartRateBpm !== null && draft.maxHeartRateBpm !== null && draft.avgHeartRateBpm > draft.maxHeartRateBpm) {
    errors.avgHeartRateBpm = "Average heart rate cannot be above maximum heart rate.";
  }
  if (draft.note !== null && draft.note.length > MAX_NOTE_LENGTH) errors.note = `Keep the note under ${MAX_NOTE_LENGTH} characters.`;
  return errors;
}

/** What an incoming activity looks like for duplicate matching. */
export interface DuplicateProbe {
  type: ActivityType;
  startedAt: Instant | null;
  localDate: LocalDate;
  goalSeconds: number;
}

/**
 * Suspected duplicate (PRD FR04): same type, start within ±2 minutes, and goal
 * duration within ±10 percent. A record without a start time can only match on
 * the same local date. This flags a review; it never merges silently.
 */
export function isSuspectedDuplicate(probe: DuplicateProbe, existing: Activity): boolean {
  if (existing.canonicalStatus !== "canonical" || existing.type !== probe.type) return false;

  if (probe.startedAt !== null && existing.startedAt !== null) {
    const deltaSeconds = Math.abs(Date.parse(probe.startedAt) - Date.parse(existing.startedAt)) / 1000;
    if (deltaSeconds > DUPLICATE_START_TOLERANCE_SECONDS) return false;
  } else if (probe.localDate !== existing.localDate) {
    return false;
  }

  const existingSeconds = goalSecondsOf(existing);
  const larger = Math.max(existingSeconds, probe.goalSeconds);
  return larger === 0 || Math.abs(existingSeconds - probe.goalSeconds) <= larger * DUPLICATE_DURATION_TOLERANCE;
}
