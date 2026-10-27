// Turns the manual activity form into an ActivityDraft (PRD FR03, FR05).
// Pure so date, timezone, and unit handling can be unit tested.
import { validateActivityDraft, type ActivityDraft } from "./activity";
import type { FieldErrors, RawForm, Validation } from "./checkins";
import { isLocalDate, zonedTimeToInstant } from "./dates";
import type { Activity, ActivityType, DistanceUnit, FieldProvenance, Intensity, LocalDate } from "./types";
import { metersFromDistance } from "./units";

export { distanceFromMeters, metersFromDistance } from "./units";

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const REPORTED: FieldProvenance = { source: "manual", kind: "reported" };

const activityTypes: readonly ActivityType[] = ["walking", "cycling", "resistance", "other"];
const intensities: readonly Intensity[] = ["easy", "moderate", "hard", "unknown"];

export interface ActivityFormContext {
  /** The activity being edited; null when adding one. */
  existing: Activity | null;
  /** Timezone for a new activity (the profile's). An edit keeps the activity's own. */
  timezone: string;
  today: LocalDate;
  distanceUnit: DistanceUnit;
}

/**
 * Manual activities accept every field. Activities from a device file keep
 * their measured date, time, duration, distance, and heart rate; only type,
 * effort, and note can be changed by hand.
 */
export function isMeasuredActivity(activity: Activity | null): boolean {
  return activity !== null && activity.source !== "manual" && activity.source !== "sample";
}

export function parseActivityForm(raw: RawForm, ctx: ActivityFormContext): Validation<ActivityDraft> {
  const errors: FieldErrors = {};
  const { existing } = ctx;
  const measured = isMeasuredActivity(existing);

  const type = activityTypes.find((t) => t === raw.type);
  if (!type) errors.type = "Choose an activity type.";
  const intensity = intensities.find((i) => i === raw.intensity) ?? "unknown";
  const note = raw.note?.trim() || null;

  const provenance = { ...(existing?.fieldProvenance ?? {}) };
  if (type && type !== existing?.type) provenance.type = REPORTED;
  if (intensity !== existing?.intensity) provenance.intensity = REPORTED;
  if (note !== (existing?.note ?? null)) provenance.note = REPORTED;

  if (measured) {
    if (Object.keys(errors).length > 0) return { ok: false, errors };
    const draft: ActivityDraft = { ...existing!, type: type!, intensity, note, fieldProvenance: provenance };
    return finish(draft, errors);
  }

  // The timezone captured at entry is kept on edit, so a later timezone
  // change never moves the activity to another day.
  const timezone = existing?.timezone ?? ctx.timezone;
  const localDate = raw.localDate ?? "";
  if (!isLocalDate(localDate)) errors.localDate = "Choose the date of the activity.";
  else if (localDate > ctx.today) errors.localDate = "The date can't be in the future.";

  const startTime = raw.startTime?.trim() ?? "";
  if (startTime !== "" && !TIME_PATTERN.test(startTime)) errors.startTime = "Use hours and minutes, like 07:30.";

  const minutesRaw = raw.durationMinutes?.trim() ?? "";
  const minutes = /^\d+$/.test(minutesRaw) ? Number(minutesRaw) : NaN;
  if (!Number.isInteger(minutes) || minutes <= 0 || minutes > 24 * 60) {
    errors.durationMinutes = "Enter the duration in whole minutes (1 to 1440).";
  }

  const distanceRaw = raw.distance?.trim() ?? "";
  let distanceMeters: number | null = null;
  if (distanceRaw !== "") {
    const value = Number(distanceRaw);
    if (!Number.isFinite(value) || value < 0) errors.distance = "Distance must be a number of 0 or more.";
    else distanceMeters = metersFromDistance(value, ctx.distanceUnit);
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const startedAt = startTime ? zonedTimeToInstant(localDate, startTime, timezone) : null;
  provenance.reportedSeconds = REPORTED;
  if (startedAt) provenance.startedAt = REPORTED;
  else delete provenance.startedAt;
  if (distanceMeters !== null) provenance.distanceMeters = REPORTED;
  else delete provenance.distanceMeters;

  return finish(
    {
      type: type!,
      startedAt,
      localDate,
      timezone,
      elapsedSeconds: null,
      activeSeconds: null,
      reportedSeconds: minutes * 60,
      durationBasis: "reported",
      distanceMeters,
      avgHeartRateBpm: null,
      maxHeartRateBpm: null,
      intensity,
      note,
      fieldProvenance: provenance,
    },
    errors,
  );
}

function finish(draft: ActivityDraft, errors: FieldErrors): Validation<ActivityDraft> {
  const draftErrors = validateActivityDraft(draft);
  // Report problems against the fields the form shows.
  if (draftErrors.reportedSeconds) errors.durationMinutes = draftErrors.reportedSeconds;
  if (draftErrors.note) errors.note = draftErrors.note;
  if (draftErrors.localDate) errors.localDate = draftErrors.localDate;
  if (draftErrors.distanceMeters) errors.distance = draftErrors.distanceMeters;
  const remaining = Object.entries(draftErrors).filter(
    ([field]) => !["reportedSeconds", "note", "localDate", "distanceMeters"].includes(field),
  );
  if (remaining.length > 0) errors.form = remaining[0][1];
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value: draft };
}
