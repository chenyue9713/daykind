// The data-access boundary. Screens and server actions depend only on this
// interface, so a database-backed implementation can replace the sample one
// without touching UI code. Every implementation is scoped to one user.
// The activity part is a shared contract: see doc/activity-contract.md.
import type { ActivityDraft, DuplicateProbe } from "@/lib/domain/activity";
import type { EveningCheckIn, MorningCheckIn, SymptomInput } from "@/lib/domain/checkins";
import type { PreferencesInput, TargetsInput } from "@/lib/domain/preferences";
import type {
  PushDevice,
  PushSubscriptionInput,
  ReminderChannel,
  ReminderOccurrence,
  ReminderSettings,
  ReminderSettingsInput,
} from "@/lib/domain/reminders";
import type {
  Activity,
  ActivitySource,
  DateRange,
  EveningEntry,
  GoalVersion,
  Instant,
  LocalDate,
  SleepEntry,
  SymptomEntry,
  UserProfile,
  WeightEntry,
} from "@/lib/domain/types";

export type DataSourceKind = "sample" | "supabase";

/** Outcome of any write. Callers must show anything other than "saved" as unsaved. */
export type MutationResult<T> =
  | { status: "saved"; savedAt: Instant; record: T }
  /** Input was valid, but this data source does not persist writes. */
  | { status: "not_persisted"; reason: string }
  /** The record changed elsewhere (another device) or already exists; nothing was written. */
  | { status: "conflict"; reason: string }
  | { status: "not_found"; reason: string }
  | { status: "failed"; reason: string };

/** Kept for existing callers; every write now returns a MutationResult. */
export type SaveResult = MutationResult<unknown>;

/**
 * Identifies one logical write. `requestId` is a UUID created once per form
 * submission attempt and reused on retries, so a repeated submission returns
 * the original result instead of writing twice. `expectedRevision` is the
 * revision the user edited, or null to create; a mismatch is a conflict.
 */
export interface WriteMeta {
  requestId: string;
  expectedRevision: number | null;
  /** The record being edited, when known; lets an edit change its date. */
  id?: string | null;
}

export interface DeleteInput {
  id: string;
  expectedRevision: number;
}

/** A symptom observation recorded outside a check-in, or an edit of one. */
export interface SymptomWrite {
  localDate: LocalDate;
  observedAt: Instant;
  symptom: SymptomInput;
}

/**
 * Timezone, units, and weight tracking. Saving always confirms the timezone.
 * During first-use setup it also records the guidance acknowledgment and the
 * reviewed targets, all in one transaction.
 */
export interface PreferencesWrite {
  preferences: PreferencesInput;
  acknowledgeGuidance?: boolean;
  completeOnboarding?: boolean;
  /** Targets reviewed during setup; `meta` of the pending version they edit. */
  targets?: { values: TargetsInput; pendingId: string | null; expectedRevision: number | null } | null;
}

export interface PreferencesSaved {
  profile: UserProfile;
  /** Outcome of `targets`, when they were sent. */
  targets: TargetChange | null;
}

/**
 * A target change starts next Monday in the confirmed timezone. Editing the
 * pending version updates it in place; setting it back to the targets in
 * effect removes it. Versions already in effect are never changed.
 * - scheduled: `version` is the pending version.
 * - removed: the pending version was removed; nothing changes next Monday.
 * - unchanged: the values equal the targets in effect and nothing was pending.
 */
export interface TargetChange {
  outcome: "scheduled" | "removed" | "unchanged";
  version: GoalVersion | null;
}

/** `id` and `expectedRevision` name the pending version being edited, or are null when none was shown. */
export type TargetWriteMeta = WriteMeta;

export interface ActivityDetail {
  activity: Activity;
  sources: ActivitySource[];
}

export interface ImportedFileRecord {
  fileHash: string;
  fileKind: "tcx" | "fit";
  importedAt: Instant;
  /** Activities that still reference this file. */
  activityIds: string[];
}

/** Source metadata for one imported session. Values are already in canonical units. */
export interface ImportedSourceInput {
  sourceKind: "tcx" | "fit";
  providerId: string | null;
  importedSummary: Record<string, unknown> | null;
  decoderVersion: string;
}

/**
 * How the user resolved one session in the import preview.
 * - create: save as a new canonical activity ("keep both" when a match was shown).
 * - link: attach this source to an existing activity; measured fields come from
 *   the import, while the existing note and intensity are kept when set.
 * - replace: save the import as a new canonical activity and mark the existing
 *   one "linked" to it, so it no longer counts.
 */
export type ImportResolution =
  | { kind: "create" }
  | { kind: "link"; activityId: string; expectedRevision: number }
  | { kind: "replace"; activityId: string; expectedRevision: number };

export interface ImportedSession {
  draft: ActivityDraft;
  source: ImportedSourceInput;
  resolution: ImportResolution;
}

export interface ConfirmedImport {
  /** Idempotency key for the whole confirmation. */
  requestId: string;
  file: {
    /** Lowercase hex SHA-256 of the file bytes. */
    sha256: string;
    kind: "tcx" | "fit";
    /** Untrusted; sanitized display name or null. */
    filenameSanitized: string | null;
  };
  /** Only the sessions the user confirmed. Saved atomically: all or none. */
  sessions: ImportedSession[];
}

export type ImportSaveResult =
  | { status: "saved"; savedAt: Instant; activityIds: string[] }
  /** This exact file was already imported and still has activities. Nothing was written. */
  | { status: "duplicate_file"; reason: string; importedAt: Instant }
  /** A linked or replaced activity changed or disappeared since the preview. Nothing was written. */
  | { status: "conflict"; reason: string; activityId: string }
  | { status: "invalid"; reason: string; sessionIndex: number; errors: Record<string, string | undefined> }
  | { status: "not_persisted"; reason: string }
  | { status: "failed"; reason: string };

/**
 * Activity persistence. The workout-import feature uses only this part of the
 * repository (plus getProfile/getToday for timezone and dates).
 */
export interface ActivityStore {
  /** Activities whose local date falls in the range, including linked ones. */
  listActivities(range: DateRange): Promise<Activity[]>;
  getActivity(id: string): Promise<ActivityDetail | null>;

  /** Canonical activities that look like the probe (see isSuspectedDuplicate). */
  findDuplicateCandidates(probe: DuplicateProbe): Promise<Activity[]>;
  /** Non-null when this exact file was already imported and still has activities. */
  findImportedFile(sha256: string): Promise<ImportedFileRecord | null>;
  /** Saves confirmed sessions in one transaction, honoring each resolution. */
  saveConfirmedImport(input: ConfirmedImport): Promise<ImportSaveResult>;

  /** A manual activity. */
  createActivity(draft: ActivityDraft, meta: WriteMeta): Promise<MutationResult<Activity>>;
  updateActivity(id: string, draft: ActivityDraft, meta: WriteMeta): Promise<MutationResult<Activity>>;
  /** Removes the activity and its sources; an import file with no remaining activities can be imported again. */
  deleteActivity(input: DeleteInput): Promise<MutationResult<null>>;
}

export interface DayKindRepository extends ActivityStore {
  readonly kind: DataSourceKind;
  /** True when every record comes from labeled sample data. */
  readonly isSample: boolean;

  getProfile(): Promise<UserProfile>;
  /** Every target version, oldest first, starting with the one that covers the earliest weeks. */
  getGoalVersions(): Promise<GoalVersion[]>;
  savePreferences(input: PreferencesWrite, meta: WriteMeta): Promise<MutationResult<PreferencesSaved>>;
  saveTargets(input: TargetsInput, meta: TargetWriteMeta): Promise<MutationResult<TargetChange>>;
  /** The civil date "today" in the user's timezone. */
  getToday(): Promise<LocalDate>;

  listSleepEntries(range: DateRange): Promise<SleepEntry[]>;
  listEveningEntries(range: DateRange): Promise<EveningEntry[]>;
  listSymptomEntries(range: DateRange): Promise<SymptomEntry[]>;
  listWeightEntries(range: DateRange): Promise<WeightEntry[]>;

  /** One sleep entry per waking date: creates it, or edits it when meta.expectedRevision is set. */
  saveMorningCheckIn(input: MorningCheckIn, meta: WriteMeta): Promise<MutationResult<SleepEntry>>;
  /** One evening entry per local date, with its new activities and symptom observation, in one transaction. */
  saveEveningCheckIn(input: EveningCheckIn, meta: WriteMeta): Promise<MutationResult<EveningEntry>>;
  deleteSleepEntry(input: DeleteInput): Promise<MutationResult<null>>;
  /** Deletes the evening review only; its activities exist independently. */
  deleteEveningEntry(input: DeleteInput): Promise<MutationResult<null>>;

  getSymptomEntry(id: string): Promise<SymptomEntry | null>;
  saveSymptomEntry(id: string | null, input: SymptomWrite, meta: WriteMeta): Promise<MutationResult<SymptomEntry>>;
  deleteSymptomEntry(input: DeleteInput): Promise<MutationResult<null>>;

  /** The saved reminder settings, or the defaults (revision null) before the first save. */
  getReminderSettings(): Promise<ReminderSettings>;
  /** meta.expectedRevision is the revision shown, or null when nothing was saved yet. */
  saveReminderSettings(input: ReminderSettingsInput, meta: WriteMeta): Promise<MutationResult<ReminderSettings>>;
  /** The most recent reminder occurrences, newest first, for delivery status. */
  listReminderOccurrences(limit: number): Promise<ReminderOccurrence[]>;
  /**
   * Records a test notification on `channel` for the dispatcher to send now.
   * Limited to five per hour ("conflict" with a reason when over the limit).
   */
  requestTestReminder(channel: ReminderChannel, meta: WriteMeta): Promise<MutationResult<ReminderOccurrence>>;
  /** The browser registered for push notifications, if any. */
  getPushDevice(): Promise<PushDevice | null>;
  /** Registers this browser for push, replacing any other browser (one device per user). */
  savePushDevice(input: PushSubscriptionInput, meta: WriteMeta): Promise<MutationResult<PushDevice>>;
  /** Unregisters the browser with this endpoint; nothing happens if another browser is registered now. */
  removePushDevice(endpoint: string): Promise<MutationResult<null>>;
}
