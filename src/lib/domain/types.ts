// Domain types mirroring the PRD data model (Section 7).
// Unknown values are `null`; explicit "none" states use enumerations.

/** A civil calendar date in the user's timezone, formatted YYYY-MM-DD. */
export type LocalDate = string;

/** A UTC instant as an ISO 8601 string. */
export type Instant = string;

export type DataSource = "sample" | "manual" | "tcx" | "fit";

export type CompletionState = "draft" | "complete";

export type Restfulness = "well_rested" | "somewhat_rested" | "poorly_rested";
export type Fatigue = "energetic" | "mildly_tired" | "very_tired";

export type ActivityType = "walking" | "cycling" | "resistance" | "other";
export type Intensity = "easy" | "moderate" | "hard" | "unknown";
export type DurationBasis = "active" | "elapsed";

/** Evening review of whether activity happened today. */
export type ActivityStatus = "logged" | "confirmed_none" | "unknown";

export type AnkleSide = "left" | "right" | "both";
export type SymptomContext = "morning" | "evening" | "standalone";

export type DistanceUnit = "km" | "mi";
export type WeightUnit = "kg" | "lb";

interface OwnedRecord {
  id: string;
  userId: string;
  createdAt: Instant;
  updatedAt: Instant;
  revision: number;
  /** Where the record came from. Sample records are never real user data. */
  source: DataSource;
}

export interface UserProfile {
  userId: string;
  displayName: string;
  timezone: string;
  timezoneConfirmed: boolean;
  distanceUnit: DistanceUnit;
  weightUnit: WeightUnit;
  weightTrackingEnabled: boolean;
  guidanceLimitsAcknowledgedAt: Instant | null;
}

export interface GoalVersion {
  id: string;
  effectiveFrom: LocalDate;
  walkingSecondsPerDay: number;
  resistanceSessionsPerWeek: number;
  cyclingSecondsPerWeek: number;
}

export interface SleepEntry extends OwnedRecord {
  wakingDate: LocalDate;
  timezone: string;
  /** Actual sleep, excluding awake baby-care time. Equal to max for point estimates. */
  durationMinSeconds: number | null;
  durationMaxSeconds: number | null;
  approximate: boolean;
  totalInterruptions: number | null;
  babyInterruptions: number | null;
  restfulness: Restfulness | null;
  morningFatigue: Fatigue | null;
  note: string | null;
  completionState: CompletionState;
}

export interface EveningEntry extends OwnedRecord {
  localDate: LocalDate;
  activityStatus: ActivityStatus;
  eveningFatigue: Fatigue | null;
  /** Marked intentionally as a recovery day; does not change goal denominators. */
  recoveryDay: boolean;
  completionState: CompletionState;
}

export interface SymptomEntry extends OwnedRecord {
  observedAt: Instant;
  localDate: LocalDate;
  context: SymptomContext;
  /** 0–10, or null when unknown. */
  anklePain: number | null;
  side: AnkleSide | null;
  flareReported: boolean;
  newOrWorsening: boolean;
  swellingHeatRedness: boolean;
  weightBearingDifficulty: boolean;
  /** Null when not asked. */
  feverOrUnwell: boolean | null;
}

export interface Activity extends OwnedRecord {
  type: ActivityType;
  startedAt: Instant;
  localDate: LocalDate;
  timezone: string;
  elapsedSeconds: number;
  activeSeconds: number | null;
  distanceMeters: number | null;
  avgHeartRateBpm: number | null;
  maxHeartRateBpm: number | null;
  intensity: Intensity;
  note: string | null;
  canonicalStatus: "canonical" | "linked" | "deleted";
}

export interface WeightEntry extends OwnedRecord {
  measuredAt: Instant;
  localDate: LocalDate;
  weightKg: number;
  enteredUnit: WeightUnit;
}

export interface DateRange {
  /** Inclusive. */
  start: LocalDate;
  /** Inclusive. */
  end: LocalDate;
}
