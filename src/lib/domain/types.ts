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
/**
 * Which duration counts toward goals: timer/active time, elapsed time as a
 * labeled fallback, or the duration the user reported for a manual entry.
 */
export type DurationBasis = "active" | "elapsed" | "reported";
/**
 * `canonical` counts toward goals. `linked` was merged into or replaced by
 * `linkedActivityId` and is kept for history only. `deleted` is reserved for
 * sample data; stored activities are removed on deletion.
 */
export type CanonicalStatus = "canonical" | "linked" | "deleted";

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
  /** Set once first-use setup is finished; null until then. */
  onboardingCompletedAt: Instant | null;
  /** Incremented on every save; a stale revision is a conflict. */
  revision: number;
}

/** Weekly targets in effect from a Monday until the next version starts. */
export interface GoalVersion {
  id: string;
  /** A Monday in the user's timezone. */
  effectiveFrom: LocalDate;
  walkingSecondsPerDay: number;
  resistanceSessionsPerWeek: number;
  cyclingSecondsPerWeek: number;
  revision: number;
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
  /** The ankle observation recorded with this check-in, if any. */
  symptomEntryId?: string | null;
}

export interface EveningEntry extends OwnedRecord {
  localDate: LocalDate;
  activityStatus: ActivityStatus;
  eveningFatigue: Fatigue | null;
  /** Marked intentionally as a recovery day; does not change goal denominators. */
  recoveryDay: boolean;
  completionState: CompletionState;
  /** The ankle observation recorded with this check-in. */
  symptomEntryId?: string | null;
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
  /** Start instant; null when a manual entry has no start time. */
  startedAt: Instant | null;
  /** Local start date in `timezone`, frozen at entry or import (cross-midnight uses the start). */
  localDate: LocalDate;
  /** IANA timezone captured when the activity was entered or imported. */
  timezone: string;
  /** Measured wall-clock duration, including pauses. */
  elapsedSeconds: number | null;
  /** Measured timer/moving duration, excluding pauses. */
  activeSeconds: number | null;
  /** Duration the user typed for a manual entry. */
  reportedSeconds: number | null;
  /** The duration that counts toward goals; that field is never null. */
  durationBasis: DurationBasis;
  distanceMeters: number | null;
  avgHeartRateBpm: number | null;
  maxHeartRateBpm: number | null;
  intensity: Intensity;
  note: string | null;
  canonicalStatus: CanonicalStatus;
  /** Set when `canonicalStatus` is "linked": the activity that now counts instead. */
  linkedActivityId: string | null;
  /** Which kind of source supplied each field, so screens can show measured versus reported. */
  fieldProvenance: FieldProvenanceMap;
}

/** Activity fields whose origin is tracked. */
export type ActivityField =
  | "type"
  | "startedAt"
  | "elapsedSeconds"
  | "activeSeconds"
  | "reportedSeconds"
  | "distanceMeters"
  | "avgHeartRateBpm"
  | "maxHeartRateBpm"
  | "intensity"
  | "note";

/**
 * `measured` came from a device file, `reported` was typed by the user,
 * `derived` was calculated (e.g. time-weighted heart rate from samples).
 */
export type ProvenanceKind = "measured" | "reported" | "derived";

export interface FieldProvenance {
  source: DataSource;
  kind: ProvenanceKind;
}

export type FieldProvenanceMap = Partial<Record<ActivityField, FieldProvenance>>;

/** Where an activity's data came from. Several sources may link to one activity. */
export interface ActivitySource {
  id: string;
  userId: string;
  activityId: string;
  createdAt: Instant;
  sourceKind: DataSource;
  /** Identifier inside the source (e.g. a FIT/TCX activity id); unique per user and source kind. */
  providerId: string | null;
  /** Lowercase hex SHA-256 of the imported file; null for manual sources. */
  fileHash: string | null;
  /** Permitted summary values extracted from the file, in canonical units. No GPS or raw streams. */
  importedSummary: Record<string, unknown> | null;
  fieldProvenance: FieldProvenanceMap;
  decoderVersion: string | null;
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
