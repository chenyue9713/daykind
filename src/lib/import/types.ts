// Normalized parser output for workout files (PRD FR04). Parser adapters
// produce these shapes and nothing else, so the preview, duplicate review, and
// persistence mapping never depend on TCX or FIT details. Unknown is `null`.
import type { ActivityType, DurationBasis, Instant, LocalDate } from "@/lib/domain/types";

export type WorkoutFormat = "tcx" | "fit";

export type HeartRateBasis =
  /** Average from the device's own summary (FIT session, or TCX laps weighted by lap time). */
  | "device_summary"
  /** Calculated here from time-weighted samples. */
  | "time_weighted_samples"
  | "none";

export interface HeartRateSummary {
  avgBpm: number | null;
  maxBpm: number | null;
  basis: HeartRateBasis;
  /** Share of active time covered by valid heart-rate data, 0–1. Null when nothing was recorded. */
  coverage: number | null;
}

/** One session exactly as the file describes it, before DayKind interpretation. */
export interface ParsedSession {
  /** 0-based position within the file. */
  index: number;
  /** Raw sport name from the file, e.g. "Biking" (TCX) or "cycling" (FIT). */
  sport: string | null;
  subSport: string | null;
  startedAt: Instant | null;
  /**
   * True when the file's start time had no timezone designator. `startedAt`
   * then holds the wall-clock time written as if it were UTC.
   */
  startIsFloating: boolean;
  /** Offset from UTC that the device recorded for local time, in minutes. */
  utcOffsetMinutes: number | null;
  elapsedSeconds: number | null;
  elapsedSource: "device" | "derived" | null;
  /** Timer (moving/active) time; excludes pauses. */
  timerSeconds: number | null;
  distanceMeters: number | null;
  heartRate: HeartRateSummary;
  /** Stable identifier for this session from its source, without device serial numbers. */
  providerId: string | null;
  /** Problems that stop this session from being imported. */
  errors: string[];
  /** Values that were present but rejected as implausible, kept for display. */
  warnings: string[];
}

export interface ParsedFile {
  format: WorkoutFormat;
  decoderVersion: string;
  /** Manufacturer and model only, never a serial number. */
  deviceLabel: string | null;
  sessions: ParsedSession[];
  warnings: string[];
}

export type ImportErrorCode =
  | "empty"
  | "too_large"
  | "wrong_extension"
  | "archive"
  | "unsupported_content"
  | "corrupt"
  | "xml_dtd_forbidden"
  | "too_complex"
  | "timeout"
  | "no_sessions"
  | "not_an_activity"
  | "already_imported"
  | "changed_since_preview"
  | "invalid_decisions"
  | "conflict"
  | "not_persisted"
  | "storage_failed";

export interface ImportError {
  code: ImportErrorCode;
  /** Plain-language explanation with a next step. Never echoes file contents. */
  message: string;
}

export class ImportFailure extends Error {
  constructor(
    readonly code: ImportErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ImportFailure";
  }

  toImportError(): ImportError {
    return { code: this.code, message: this.message };
  }
}

export type ParseResult = { ok: true; file: ParsedFile } | { ok: false; error: ImportError };

// ---------- Preview (DayKind interpretation of a parsed session) ----------

export type DateConfidence =
  /** The device recorded local time and it agrees with the profile timezone. */
  | "device_offset_matches"
  /** The device's offset differs from the profile timezone but gives the same date. */
  | "device_offset_differs_same_date"
  /** The device's offset gives a different date than the profile timezone. Needs confirmation. */
  | "device_offset_differs"
  /** No offset in the file; the profile timezone was assumed. Needs confirmation. */
  | "assumed_profile_timezone"
  /** The file's times had no timezone at all; read as wall-clock time in the profile timezone. */
  | "floating_time";

/**
 * A timezone the user can confirm for a session. The contract requires
 * `localDate === localDateOf(startedAt, timezone)`, so a date correction is
 * always expressed as a timezone choice.
 */
export interface TimezoneCandidate {
  timezone: string;
  localDate: LocalDate;
  /** e.g. "6:12 PM in America/Los_Angeles (your timezone)". */
  label: string;
}

/** How each displayed value was obtained, for the preview and the stored summary. */
export type PreviewProvenance =
  | "device"
  | "derived"
  | "device_zero_treated_as_unknown"
  | "rejected_implausible"
  | "absent";

export interface SessionProvenance {
  elapsedSeconds: PreviewProvenance;
  activeSeconds: PreviewProvenance;
  distanceMeters: PreviewProvenance;
  avgHeartRateBpm: PreviewProvenance;
  maxHeartRateBpm: PreviewProvenance;
}

/** An existing activity that might be the same workout (contract `isSuspectedDuplicate`). */
export interface DuplicateCandidate {
  activityId: string;
  /** Revision seen at preview time; the save returns a conflict if it changed. */
  revision: number;
  source: string;
  type: ActivityType;
  startedAt: Instant | null;
  localDate: LocalDate;
  goalSeconds: number;
  durationBasis: DurationBasis;
  elapsedSeconds: number | null;
  activeSeconds: number | null;
  distanceMeters: number | null;
  avgHeartRateBpm: number | null;
  maxHeartRateBpm: number | null;
  note: string | null;
  intensity: string;
  /** Plain-language reasons, e.g. "Starts 1 min apart". */
  reasons: string[];
}

export type SessionStatus = "ready" | "needs_review" | "failed";

export type RequiredConfirmation = "sport" | "timezone" | "duplicate";

export interface SessionPreview {
  key: string;
  index: number;
  status: SessionStatus;
  /** Why the session cannot be imported. */
  errors: string[];
  warnings: string[];

  sportLabel: string;
  rawSport: string | null;
  rawSubSport: string | null;
  /** Null when the sport is ambiguous and the user must choose. */
  type: ActivityType | null;
  typeSuggestion: ActivityType | null;
  typeSuggestionReason: string | null;

  startedAt: Instant | null;
  /** Default timezone: the profile's. Candidates list the alternatives. */
  timezone: string;
  localDate: LocalDate | null;
  dateConfidence: DateConfidence | null;
  timezoneCandidates: TimezoneCandidate[];
  deviceUtcOffsetMinutes: number | null;

  elapsedSeconds: number | null;
  activeSeconds: number | null;
  goalSeconds: number | null;
  durationBasis: DurationBasis | null;
  pausedSeconds: number | null;

  distanceMeters: number | null;
  heartRate: HeartRateSummary;

  providerId: string | null;
  provenance: SessionProvenance;
  /** Candidates for every type the session could be; filter by the chosen type. */
  duplicates: DuplicateCandidate[];
  requiredConfirmations: RequiredConfirmation[];
}

export interface ImportPreview {
  /** Idempotency key for the confirmation; reused on retry. */
  requestId: string;
  fileHash: string;
  fileName: string | null;
  format: WorkoutFormat;
  deviceLabel: string | null;
  decoderVersion: string;
  profileTimezone: string;
  sessions: SessionPreview[];
  warnings: string[];
}

// ---------- Decisions sent back from the preview ----------

export type DuplicateResolution =
  | { resolution: "keep_both" }
  | { resolution: "link"; activityId: string; expectedRevision: number }
  | { resolution: "replace"; activityId: string; expectedRevision: number; keepNote: boolean };

export type SessionDecision =
  | { key: string; action: "skip" }
  | {
      key: string;
      action: "import";
      type: ActivityType;
      timezone: string;
      /** Required exactly when duplicate candidates of the chosen type exist. */
      duplicate: DuplicateResolution | null;
      /** Candidate ids the user was shown; a new candidate since then means review again. */
      reviewedCandidateIds: string[];
    };
