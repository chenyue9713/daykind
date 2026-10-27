// Converts between database rows (snake_case, Postgres types) and domain
// types, and builds the jsonb payloads the write functions expect. Pure, so
// the same payloads are exercised by the database tests.
import type { ActivityDraft } from "@/lib/domain/activity";
import type { EveningCheckIn, MorningCheckIn, QuickActivityInput, SymptomInput } from "@/lib/domain/checkins";
import { zonedTimeToInstant } from "@/lib/domain/dates";
import type { TargetsInput } from "@/lib/domain/preferences";
import type { ReminderOccurrence, ReminderSettings, ReminderSettingsInput } from "@/lib/domain/reminders";
import type {
  Activity,
  ActivitySource,
  EveningEntry,
  GoalVersion,
  LocalDate,
  SleepEntry,
  SymptomEntry,
  UserProfile,
} from "@/lib/domain/types";
import type { ConfirmedImport, PreferencesWrite, TargetWriteMeta, WriteMeta } from "../repository";

type Row = Record<string, unknown>;

const str = (v: unknown) => v as string;
const strOrNull = (v: unknown) => (v === null || v === undefined ? null : String(v));
const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));
/** Postgres dates may arrive as "YYYY-MM-DD" strings (PostgREST) or Date objects (drivers). */
const date = (v: unknown): LocalDate => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const instant = (v: unknown) => new Date(v as string).toISOString();
const instantOrNull = (v: unknown) => (v === null || v === undefined ? null : instant(v));

function owned(row: Row) {
  return {
    id: str(row.id),
    userId: str(row.user_id),
    createdAt: instant(row.created_at),
    updatedAt: instant(row.updated_at),
    revision: Number(row.revision),
  };
}

export function toProfile(row: Row): UserProfile {
  return {
    userId: str(row.user_id),
    displayName: strOrNull(row.display_name) ?? "You",
    timezone: str(row.timezone),
    timezoneConfirmed: Boolean(row.timezone_confirmed),
    distanceUnit: row.distance_unit as UserProfile["distanceUnit"],
    weightUnit: row.weight_unit as UserProfile["weightUnit"],
    weightTrackingEnabled: Boolean(row.weight_tracking_enabled),
    guidanceLimitsAcknowledgedAt: instantOrNull(row.guidance_limits_acknowledged_at),
    onboardingCompletedAt: instantOrNull(row.onboarding_completed_at),
    revision: Number(row.revision),
  };
}

export function toGoalVersion(row: Row): GoalVersion {
  return {
    id: str(row.id),
    effectiveFrom: date(row.effective_from),
    walkingSecondsPerDay: Number(row.walking_seconds_per_day),
    resistanceSessionsPerWeek: Number(row.resistance_sessions_per_week),
    cyclingSecondsPerWeek: Number(row.cycling_seconds_per_week),
    revision: Number(row.revision),
  };
}

export function toSleepEntry(row: Row): SleepEntry {
  return {
    ...owned(row),
    source: "manual",
    wakingDate: date(row.waking_date),
    timezone: str(row.timezone),
    durationMinSeconds: numOrNull(row.duration_min_seconds),
    durationMaxSeconds: numOrNull(row.duration_max_seconds),
    approximate: Boolean(row.approximate),
    totalInterruptions: numOrNull(row.total_interruptions),
    babyInterruptions: numOrNull(row.baby_interruptions),
    restfulness: row.restfulness as SleepEntry["restfulness"],
    morningFatigue: row.morning_fatigue as SleepEntry["morningFatigue"],
    note: strOrNull(row.note),
    completionState: row.completion_state as SleepEntry["completionState"],
    symptomEntryId: strOrNull(row.symptom_entry_id),
  };
}

export function toEveningEntry(row: Row): EveningEntry {
  return {
    ...owned(row),
    source: "manual",
    localDate: date(row.local_date),
    activityStatus: row.activity_status as EveningEntry["activityStatus"],
    eveningFatigue: row.evening_fatigue as EveningEntry["eveningFatigue"],
    recoveryDay: Boolean(row.recovery_day),
    completionState: row.completion_state as EveningEntry["completionState"],
    symptomEntryId: strOrNull(row.symptom_entry_id),
  };
}

export function toSymptomEntry(row: Row): SymptomEntry {
  return {
    ...owned(row),
    source: "manual",
    observedAt: instant(row.observed_at),
    localDate: date(row.local_date),
    context: row.context as SymptomEntry["context"],
    anklePain: numOrNull(row.ankle_pain),
    side: row.side as SymptomEntry["side"],
    flareReported: Boolean(row.flare_reported),
    newOrWorsening: Boolean(row.new_or_worsening),
    swellingHeatRedness: Boolean(row.swelling_heat_redness),
    weightBearingDifficulty: Boolean(row.weight_bearing_difficulty),
    feverOrUnwell: row.fever_or_unwell === null || row.fever_or_unwell === undefined ? null : Boolean(row.fever_or_unwell),
  };
}

export function toActivity(row: Row): Activity {
  return {
    ...owned(row),
    source: row.source as Activity["source"],
    type: row.type as Activity["type"],
    startedAt: instantOrNull(row.started_at),
    localDate: date(row.local_date),
    timezone: str(row.timezone),
    elapsedSeconds: numOrNull(row.elapsed_seconds),
    activeSeconds: numOrNull(row.active_seconds),
    reportedSeconds: numOrNull(row.reported_seconds),
    durationBasis: row.duration_basis as Activity["durationBasis"],
    distanceMeters: numOrNull(row.distance_meters),
    avgHeartRateBpm: numOrNull(row.avg_heart_rate_bpm),
    maxHeartRateBpm: numOrNull(row.max_heart_rate_bpm),
    intensity: row.intensity as Activity["intensity"],
    note: strOrNull(row.note),
    canonicalStatus: row.canonical_status as Activity["canonicalStatus"],
    linkedActivityId: strOrNull(row.linked_activity_id),
    fieldProvenance: (row.field_provenance ?? {}) as Activity["fieldProvenance"],
  };
}

export function toActivitySource(row: Row): ActivitySource {
  return {
    id: str(row.id),
    userId: str(row.user_id),
    activityId: str(row.activity_id),
    createdAt: instant(row.created_at),
    sourceKind: row.source_kind as ActivitySource["sourceKind"],
    providerId: strOrNull(row.provider_id),
    fileHash: strOrNull(row.file_hash),
    importedSummary: (row.imported_summary ?? null) as ActivitySource["importedSummary"],
    fieldProvenance: (row.field_provenance ?? {}) as ActivitySource["fieldProvenance"],
    decoderVersion: strOrNull(row.decoder_version),
  };
}

export function draftToRow(draft: ActivityDraft) {
  return {
    type: draft.type,
    started_at: draft.startedAt,
    local_date: draft.localDate,
    timezone: draft.timezone,
    elapsed_seconds: draft.elapsedSeconds,
    active_seconds: draft.activeSeconds,
    reported_seconds: draft.reportedSeconds,
    duration_basis: draft.durationBasis,
    distance_meters: draft.distanceMeters,
    avg_heart_rate_bpm: draft.avgHeartRateBpm,
    max_heart_rate_bpm: draft.maxHeartRateBpm,
    intensity: draft.intensity,
    note: draft.note,
    field_provenance: draft.fieldProvenance,
  };
}

const REPORTED = { source: "manual", kind: "reported" } as const;

/** A quick-add activity: the user's minutes are the reported duration; nothing is "measured". */
export function quickActivityDraft(item: QuickActivityInput, localDate: LocalDate, timezone: string): ActivityDraft {
  const startedAt = item.startTime ? zonedTimeToInstant(localDate, item.startTime, timezone) : null;
  return {
    type: item.type,
    startedAt,
    localDate,
    timezone,
    elapsedSeconds: null,
    activeSeconds: null,
    reportedSeconds: item.durationMinutes * 60,
    durationBasis: "reported",
    distanceMeters: null,
    avgHeartRateBpm: null,
    maxHeartRateBpm: null,
    intensity: item.intensity,
    note: null,
    fieldProvenance: {
      type: REPORTED,
      reportedSeconds: REPORTED,
      intensity: REPORTED,
      ...(startedAt ? { startedAt: REPORTED } : {}),
    },
  };
}

export function symptomPayload(s: SymptomInput) {
  return {
    ankle_pain: s.anklePain,
    side: s.side,
    flare_reported: s.flareReported,
    new_or_worsening: s.newOrWorsening,
    swelling_heat_redness: s.swellingHeatRedness,
    weight_bearing_difficulty: s.weightBearingDifficulty,
    fever_or_unwell: s.feverOrUnwell,
  };
}

function metaPayload(meta: WriteMeta, id: string | null) {
  return { request_id: meta.requestId, expected_revision: meta.expectedRevision, id: id ?? meta.id ?? null };
}

/** `id` identifies the entry being edited, so its waking date can be corrected. */
export function morningPayload(input: MorningCheckIn, meta: WriteMeta, timezone: string, id: string | null = null) {
  return {
    ...metaPayload(meta, id),
    waking_date: input.wakingDate,
    timezone,
    duration_min_seconds: input.durationMinSeconds,
    duration_max_seconds: input.durationMaxSeconds,
    approximate: input.approximate,
    total_interruptions: input.totalInterruptions,
    baby_interruptions: input.babyInterruptions,
    restfulness: input.restfulness,
    morning_fatigue: input.morningFatigue,
    note: input.note,
    symptom: input.symptom ? symptomPayload(input.symptom) : null,
  };
}

export function eveningPayload(input: EveningCheckIn, meta: WriteMeta, timezone: string, id: string | null = null) {
  return {
    ...metaPayload(meta, id),
    local_date: input.localDate,
    timezone,
    activity_status: input.activityStatus,
    evening_fatigue: input.eveningFatigue,
    recovery_day: input.recoveryDay,
    symptom: symptomPayload(input.symptom),
    new_activities: input.newActivities.map((item) => ({
      request_id: item.requestId,
      draft: draftToRow(quickActivityDraft(item, input.localDate, timezone)),
    })),
    remove_activity_ids:
      input.activityStatus === "confirmed_none" && input.confirmRemoveExisting ? input.seenActivityIds : [],
  };
}

export function importPayload(input: ConfirmedImport) {
  return {
    request_id: input.requestId,
    file: {
      sha256: input.file.sha256.toLowerCase(),
      kind: input.file.kind,
      filename_sanitized: input.file.filenameSanitized,
    },
    sessions: input.sessions.map((s) => ({
      draft: draftToRow(s.draft),
      source: {
        source_kind: s.source.sourceKind,
        provider_id: s.source.providerId,
        imported_summary: s.source.importedSummary,
        decoder_version: s.source.decoderVersion,
      },
      resolution:
        s.resolution.kind === "create"
          ? { kind: "create" }
          : {
              kind: s.resolution.kind,
              activity_id: s.resolution.activityId,
              expected_revision: s.resolution.expectedRevision,
            },
    })),
  };
}

function targetValues(t: TargetsInput) {
  return {
    walking_seconds_per_day: t.walkingSecondsPerDay,
    resistance_sessions_per_week: t.resistanceSessionsPerWeek,
    cycling_seconds_per_week: t.cyclingSecondsPerWeek,
  };
}

/** `meta.id`/`expectedRevision` name the pending version being edited, if any. */
export function targetsPayload(input: TargetsInput, meta: TargetWriteMeta) {
  return {
    request_id: meta.requestId,
    pending_id: meta.id ?? null,
    expected_revision: meta.id ? meta.expectedRevision : null,
    ...targetValues(input),
  };
}

/** `meta.expectedRevision` is the profile revision the form was showing. */
export function preferencesPayload(input: PreferencesWrite, meta: WriteMeta) {
  const { preferences: p, targets } = input;
  return {
    request_id: meta.requestId,
    expected_revision: meta.expectedRevision,
    timezone: p.timezone,
    distance_unit: p.distanceUnit,
    weight_unit: p.weightUnit,
    weight_tracking_enabled: p.weightTrackingEnabled,
    acknowledge_guidance: input.acknowledgeGuidance ?? false,
    complete_onboarding: input.completeOnboarding ?? false,
    targets: targets
      ? {
          pending_id: targets.pendingId,
          expected_revision: targets.pendingId ? targets.expectedRevision : null,
          ...targetValues(targets.values),
        }
      : null,
  };
}

/** Postgres `time` arrives as "HH:MM:SS"; the app uses "HH:MM". */
const hhmm = (v: unknown) => String(v).slice(0, 5);

export function toReminderSettings(row: Row): ReminderSettings {
  return {
    emailEnabled: Boolean(row.email_enabled),
    emailEnabledAt: instantOrNull(row.email_enabled_at),
    morningEnabled: Boolean(row.morning_enabled),
    eveningEnabled: Boolean(row.evening_enabled),
    followUpsEnabled: Boolean(row.follow_ups_enabled),
    quietHoursEnabled: Boolean(row.quiet_hours_enabled),
    quietStart: hhmm(row.quiet_start),
    quietEnd: hhmm(row.quiet_end),
    revision: Number(row.revision),
  };
}

/** `meta.expectedRevision` is the settings revision shown, or null before the first save. */
export function reminderSettingsPayload(input: ReminderSettingsInput, meta: WriteMeta) {
  return {
    request_id: meta.requestId,
    expected_revision: meta.expectedRevision,
    email_enabled: input.emailEnabled,
    morning_enabled: input.morningEnabled,
    evening_enabled: input.eveningEnabled,
    follow_ups_enabled: input.followUpsEnabled,
    quiet_hours_enabled: input.quietHoursEnabled,
    quiet_start: input.quietStart,
    quiet_end: input.quietEnd,
  };
}

export function toReminderOccurrence(row: Row): ReminderOccurrence {
  return {
    id: str(row.id),
    kind: row.kind as ReminderOccurrence["kind"],
    stage: row.stage as ReminderOccurrence["stage"],
    localDate: date(row.local_date),
    timezone: str(row.timezone),
    scheduledAt: instant(row.scheduled_at),
    status: row.status as ReminderOccurrence["status"],
    statusReason: (row.status_reason ?? null) as ReminderOccurrence["statusReason"],
    attempts: Number(row.attempts),
    sentAt: instantOrNull(row.sent_at),
  };
}
