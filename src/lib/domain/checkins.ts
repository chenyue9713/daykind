// Check-in validation (PRD FR02, FR03). Pure functions so the same rules can
// run in server actions now and against database writes later.
import { isLocalDate } from "./dates";
import type {
  ActivityStatus,
  ActivityType,
  AnkleSide,
  Fatigue,
  Intensity,
  LocalDate,
  Restfulness,
} from "./types";

export type FieldErrors = Partial<Record<string, string>>;

export type Validation<T> = { ok: true; value: T } | { ok: false; errors: FieldErrors };

export interface SymptomInput {
  anklePain: number | null;
  side: AnkleSide | null;
  flareReported: boolean;
  newOrWorsening: boolean;
  swellingHeatRedness: boolean;
  weightBearingDifficulty: boolean;
  feverOrUnwell: boolean | null;
}

export interface MorningCheckIn {
  wakingDate: LocalDate;
  durationMinSeconds: number;
  durationMaxSeconds: number;
  approximate: boolean;
  totalInterruptions: number | null;
  babyInterruptions: number | null;
  restfulness: Restfulness;
  morningFatigue: Fatigue;
  note: string | null;
  symptom: SymptomInput | null;
}

export interface QuickActivityInput {
  type: ActivityType;
  durationMinutes: number;
  intensity: Intensity;
}

export interface EveningCheckIn {
  localDate: LocalDate;
  activityStatus: ActivityStatus;
  newActivities: QuickActivityInput[];
  /** Explicit confirmation that existing activities should be removed when marking none. */
  confirmRemoveExisting: boolean;
  eveningFatigue: Fatigue;
  recoveryDay: boolean;
  symptom: SymptomInput;
}

/** Raw form values, as strings, after FormData extraction. */
export type RawForm = Record<string, string | undefined>;

const MAX_NOTE_LENGTH = 500;
const MAX_SLEEP_SECONDS = 16 * 3600;

const restfulnessValues: Restfulness[] = ["well_rested", "somewhat_rested", "poorly_rested"];
const fatigueValues: Fatigue[] = ["energetic", "mildly_tired", "very_tired"];
const activityTypes: ActivityType[] = ["walking", "cycling", "resistance", "other"];
const intensities: Intensity[] = ["easy", "moderate", "hard", "unknown"];
const sides: AnkleSide[] = ["left", "right", "both"];

function oneOf<T extends string>(values: readonly T[], raw: string | undefined): T | null {
  return values.includes(raw as T) ? (raw as T) : null;
}

function nonNegativeInt(raw: string | undefined): number | null | "invalid" {
  if (raw === undefined || raw.trim() === "") return null;
  if (!/^\d+$/.test(raw.trim())) return "invalid";
  return Number(raw.trim());
}

function hoursMinutesToSeconds(hours: string | undefined, minutes: string | undefined): number | null | "invalid" {
  const h = nonNegativeInt(hours);
  const m = nonNegativeInt(minutes);
  if (h === "invalid" || m === "invalid") return "invalid";
  if (h === null && m === null) return null;
  if ((m ?? 0) > 59) return "invalid";
  return ((h ?? 0) * 60 + (m ?? 0)) * 60;
}

/** A value is unknown when its "unknown" box is checked; empty is a missing answer. */
function countOrUnknown(
  raw: RawForm,
  field: string,
  errors: FieldErrors,
  label: string,
): number | null {
  if (raw[`${field}Unknown`] === "on") return null;
  const value = nonNegativeInt(raw[field]);
  if (value === "invalid") errors[field] = `${label} must be a whole number of 0 or more.`;
  else if (value === null) errors[field] = `Enter ${label.toLowerCase()} or choose “Unknown”.`;
  return typeof value === "number" ? value : null;
}

export function parseSymptom(raw: RawForm, errors: FieldErrors, required: boolean): SymptomInput | null {
  const painUnknown = raw.anklePain === "unknown";
  const painRaw = painUnknown ? "" : (raw.anklePain?.trim() ?? "");
  const flags = {
    flareReported: raw.flareReported === "on",
    newOrWorsening: raw.newOrWorsening === "on",
    swellingHeatRedness: raw.swellingHeatRedness === "on",
    weightBearingDifficulty: raw.weightBearingDifficulty === "on",
  };
  const anyFlag = Object.values(flags).some(Boolean);

  if (!required && !painUnknown && painRaw === "" && !anyFlag) return null;

  let anklePain: number | null = null;
  if (!painUnknown) {
    const pain = nonNegativeInt(painRaw);
    if (pain === null) errors.anklePain = "Choose an ankle pain level from 0 to 10, or “Unknown”.";
    else if (pain === "invalid" || pain > 10) errors.anklePain = "Ankle pain must be a whole number from 0 to 10.";
    else anklePain = pain;
  }

  const fever = raw.feverOrUnwell;
  return {
    anklePain,
    side: oneOf(sides, raw.side),
    ...flags,
    feverOrUnwell: fever === "yes" ? true : fever === "no" ? false : null,
  };
}

export function validateMorningCheckIn(raw: RawForm): Validation<MorningCheckIn> {
  const errors: FieldErrors = {};

  const wakingDate = raw.wakingDate ?? "";
  if (!isLocalDate(wakingDate)) errors.wakingDate = "Choose the date you woke up.";

  const approximate = raw.approximate === "on";
  let min: number | null = null;
  let max: number | null = null;
  if (approximate) {
    const lo = hoursMinutesToSeconds(raw.sleepMinHours, raw.sleepMinMinutes);
    const hi = hoursMinutesToSeconds(raw.sleepMaxHours, raw.sleepMaxMinutes);
    if (lo === "invalid" || hi === "invalid") errors.sleep = "Use whole hours and 0–59 minutes.";
    else if (lo === null || hi === null) errors.sleep = "Enter both ends of your sleep estimate.";
    else if (lo > hi) errors.sleep = "The lower estimate must not be more than the upper estimate.";
    else [min, max] = [lo, hi];
  } else {
    const exact = hoursMinutesToSeconds(raw.sleepHours, raw.sleepMinutes);
    if (exact === "invalid") errors.sleep = "Use whole hours and 0–59 minutes.";
    else if (exact === null) errors.sleep = "Enter how long you actually slept.";
    else [min, max] = [exact, exact];
  }
  if (max !== null && max > MAX_SLEEP_SECONDS) errors.sleep = "That is more than 16 hours. Please check the value.";

  const totalInterruptions = countOrUnknown(raw, "totalInterruptions", errors, "Total interruptions");
  const babyInterruptions = countOrUnknown(raw, "babyInterruptions", errors, "Baby-care interruptions");
  if (totalInterruptions !== null && babyInterruptions !== null && babyInterruptions > totalInterruptions) {
    errors.babyInterruptions = "Baby-care interruptions cannot be more than total interruptions.";
  }

  const restfulness = oneOf(restfulnessValues, raw.restfulness);
  if (!restfulness) errors.restfulness = "Choose how rested you feel.";
  const morningFatigue = oneOf(fatigueValues, raw.morningFatigue);
  if (!morningFatigue) errors.morningFatigue = "Choose how tired you feel.";

  const note = raw.note?.trim() || null;
  if (note && note.length > MAX_NOTE_LENGTH) errors.note = `Keep the note under ${MAX_NOTE_LENGTH} characters.`;

  const symptom = parseSymptom(raw, errors, false);

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      wakingDate,
      durationMinSeconds: min!,
      durationMaxSeconds: max!,
      approximate,
      totalInterruptions,
      babyInterruptions,
      restfulness: restfulness!,
      morningFatigue: morningFatigue!,
      note,
      symptom,
    },
  };
}

function parseQuickActivities(json: string | undefined, errors: FieldErrors): QuickActivityInput[] {
  if (!json) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    errors.activities = "The added activities could not be read. Please add them again.";
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const result: QuickActivityInput[] = [];
  for (const item of parsed) {
    const type = oneOf(activityTypes, item?.type);
    const intensity = oneOf(intensities, item?.intensity) ?? "unknown";
    const minutes = Number(item?.durationMinutes);
    if (!type || !Number.isInteger(minutes) || minutes <= 0 || minutes > 24 * 60) {
      errors.activities = "Each added activity needs a type and a duration in whole minutes.";
      continue;
    }
    result.push({ type, durationMinutes: minutes, intensity });
  }
  return result;
}

export function validateEveningCheckIn(raw: RawForm, existingActivityCount: number): Validation<EveningCheckIn> {
  const errors: FieldErrors = {};

  const localDate = raw.localDate ?? "";
  if (!isLocalDate(localDate)) errors.localDate = "The check-in date is missing.";

  const newActivities = parseQuickActivities(raw.activities, errors);
  const activityStatus = oneOf<ActivityStatus>(["logged", "confirmed_none", "unknown"], raw.activityStatus);
  const confirmRemoveExisting = raw.confirmRemoveExisting === "on";
  const totalActivities = existingActivityCount + newActivities.length;

  if (!activityStatus) {
    errors.activityStatus = "Review today's activity: logged, none, or not sure.";
  } else if (activityStatus === "logged" && totalActivities === 0) {
    errors.activityStatus = "Add an activity, or choose “No activity today”.";
  } else if (activityStatus === "confirmed_none" && newActivities.length > 0) {
    errors.activityStatus = "You added an activity. Remove it or choose “I was active today”.";
  } else if (activityStatus === "confirmed_none" && existingActivityCount > 0 && !confirmRemoveExisting) {
    errors.confirmRemoveExisting =
      "Today already has recorded activity. Confirm that it should be removed, or choose “I was active today”.";
  }

  const eveningFatigue = oneOf(fatigueValues, raw.eveningFatigue);
  if (!eveningFatigue) errors.eveningFatigue = "Choose how tired you feel this evening.";

  const symptom = parseSymptom(raw, errors, true);

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      localDate,
      activityStatus: activityStatus!,
      newActivities,
      confirmRemoveExisting,
      eveningFatigue: eveningFatigue!,
      recoveryDay: raw.recoveryDay === "on",
      symptom: symptom!,
    },
  };
}
