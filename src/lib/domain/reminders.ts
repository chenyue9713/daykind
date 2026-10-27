// Check-in reminders (PRD FR07): settings, the daily schedule, and which
// reminders are due. Pure, so the dispatcher, Settings, and tests share it.
// Eligibility at send time (completion, quiet hours, lateness, timezone) is
// decided by the database in the same transaction that claims the send.
import type { FieldErrors, RawForm, Validation } from "./checkins";
import { addDays, localDateOf, zonedTimeToInstant } from "./dates";
import type { Instant, LocalDate } from "./types";

export type ReminderKind = "morning" | "evening";
export type ReminderStage = "initial" | "follow_up";

export interface ReminderSettings {
  /** The user turned email delivery on. Nothing is sent before this. */
  emailEnabled: boolean;
  emailEnabledAt: Instant | null;
  morningEnabled: boolean;
  eveningEnabled: boolean;
  followUpsEnabled: boolean;
  quietHoursEnabled: boolean;
  /** "HH:MM", local wall-clock time. The window may cross midnight. */
  quietStart: string;
  quietEnd: string;
  /** null until the settings are first saved. */
  revision: number | null;
}

export type ReminderSettingsInput = Omit<ReminderSettings, "emailEnabledAt" | "revision">;

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  emailEnabled: false,
  emailEnabledAt: null,
  morningEnabled: true,
  eveningEnabled: true,
  followUpsEnabled: true,
  quietHoursEnabled: true,
  quietStart: "22:30",
  quietEnd: "08:00",
  revision: null,
};

/** Local wall-clock times. A follow-up comes 60 minutes after its reminder. */
export const REMINDER_TIMES: Record<ReminderKind, Record<ReminderStage, string>> = {
  morning: { initial: "10:00", follow_up: "11:00" },
  evening: { initial: "21:00", follow_up: "22:00" },
};

/** A daily reminder more than this late is skipped (the due card remains). */
export const MAX_LATENESS_MS = 2 * 60 * 60 * 1000;

/**
 * How far back planning looks. Slots older than MAX_LATENESS_MS are still
 * recorded, so a missed reminder shows as "skipped" rather than vanishing.
 */
export const PLANNING_LOOKBACK_MS = 24 * 60 * 60 * 1000;

export interface ReminderSlot {
  kind: ReminderKind;
  stage: ReminderStage;
  /** The check-in date: the waking date for morning, the local date for evening. */
  localDate: LocalDate;
  timezone: string;
  scheduledAt: Instant;
}

/** The scheduled instant of one reminder: local wall-clock time, so DST keeps it at 10 AM. */
export function slotInstant(kind: ReminderKind, stage: ReminderStage, localDate: LocalDate, timezone: string): Instant {
  return zonedTimeToInstant(localDate, REMINDER_TIMES[kind][stage], timezone);
}

export interface PlanningUser {
  timezone: string;
  emailEnabledAt: Instant | null;
  morningEnabled: boolean;
  eveningEnabled: boolean;
  followUpsEnabled: boolean;
}

/**
 * Reminders that have become due for one user by `now`: scheduled at or
 * before `now`, not before delivery was turned on, and within the planning
 * lookback. Recording a slot is idempotent, so overlapping runs are harmless.
 */
export function dueSlots(user: PlanningUser, now: Date): ReminderSlot[] {
  if (!user.emailEnabledAt) return [];
  const enabledAt = new Date(user.emailEnabledAt).getTime();
  const nowMs = now.getTime();
  const today = localDateOf(now, user.timezone);
  const kinds = (["morning", "evening"] as const).filter((k) => (k === "morning" ? user.morningEnabled : user.eveningEnabled));
  const stages: ReminderStage[] = user.followUpsEnabled ? ["initial", "follow_up"] : ["initial"];

  const slots: ReminderSlot[] = [];
  for (const localDate of [addDays(today, -1), today]) {
    for (const kind of kinds) {
      for (const stage of stages) {
        const scheduledAt = slotInstant(kind, stage, localDate, user.timezone);
        const at = new Date(scheduledAt).getTime();
        if (at <= nowMs && at >= enabledAt && nowMs - at <= PLANNING_LOOKBACK_MS) {
          slots.push({ kind, stage, localDate, timezone: user.timezone, scheduledAt });
        }
      }
    }
  }
  return slots;
}

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function minutesOfDay(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** True when `time` falls in [start, end), a window that may cross midnight. Mirrors daykind_private.in_quiet_hours. */
export function inQuietHours(time: string, start: string, end: string): boolean {
  const t = minutesOfDay(time);
  const s = minutesOfDay(start);
  const e = minutesOfDay(end);
  return s < e ? t >= s && t < e : t >= s || t < e;
}

/** Follow-ups that the quiet hours would skip, for a hint in Settings. */
export function followUpsInQuietHours(settings: Pick<ReminderSettings, "quietHoursEnabled" | "quietStart" | "quietEnd">): ReminderKind[] {
  if (!settings.quietHoursEnabled) return [];
  return (["morning", "evening"] as const).filter((k) =>
    inQuietHours(REMINDER_TIMES[k].follow_up, settings.quietStart, settings.quietEnd),
  );
}

const checked = (value: string | undefined) => value === "on" || value === "true";

export function validateReminderSettings(raw: RawForm): Validation<ReminderSettingsInput> {
  const errors: FieldErrors = {};
  const quietHoursEnabled = checked(raw.quietHoursEnabled);
  const quietStart = raw.quietStart?.trim() ?? "";
  const quietEnd = raw.quietEnd?.trim() ?? "";
  if (!TIME_PATTERN.test(quietStart)) errors.quietStart = "Enter a start time, for example 22:30.";
  if (!TIME_PATTERN.test(quietEnd)) errors.quietEnd = "Enter an end time, for example 08:00.";
  if (!errors.quietStart && !errors.quietEnd && quietStart === quietEnd) {
    errors.quietEnd = "Quiet hours need different start and end times.";
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      emailEnabled: checked(raw.emailEnabled),
      morningEnabled: checked(raw.morningEnabled),
      eveningEnabled: checked(raw.eveningEnabled),
      followUpsEnabled: checked(raw.followUpsEnabled),
      quietHoursEnabled,
      quietStart,
      quietEnd,
    },
  };
}

// --- Delivery status ---

export type OccurrenceStatus = "pending" | "sending" | "sent" | "suppressed" | "skipped" | "failed";

export type OccurrenceReason =
  | "completed"
  | "delivery_off"
  | "reminder_off"
  | "follow_ups_off"
  | "quiet_hours"
  | "too_late"
  | "timezone_changed"
  | "timezone_unconfirmed"
  | "no_address"
  | "retries_exhausted"
  | "provider_rejected";

export interface ReminderOccurrence {
  id: string;
  kind: ReminderKind | "test";
  stage: ReminderStage;
  localDate: LocalDate;
  timezone: string;
  scheduledAt: Instant;
  status: OccurrenceStatus;
  statusReason: OccurrenceReason | null;
  attempts: number;
  sentAt: Instant | null;
}

export const occurrenceLabel = (o: Pick<ReminderOccurrence, "kind" | "stage">): string =>
  o.kind === "test"
    ? "Test notification"
    : `${o.kind === "morning" ? "Morning" : "Evening"} ${o.stage === "initial" ? "reminder" : "follow-up"}`;

const reasonText: Record<OccurrenceReason, string> = {
  completed: "Not sent: the check-in was already done",
  delivery_off: "Not sent: email reminders were off",
  reminder_off: "Not sent: this reminder was turned off",
  follow_ups_off: "Not sent: follow-ups were off",
  quiet_hours: "Not sent: quiet hours",
  too_late: "Not sent: more than two hours late",
  timezone_changed: "Not sent: your timezone changed",
  timezone_unconfirmed: "Not sent: timezone not confirmed",
  no_address: "Failed: no email address on the account",
  retries_exhausted: "Failed after retries",
  provider_rejected: "Failed: the mail service refused it",
};

/** "Delivered" here means accepted by the mail service, never "read". */
export function occurrenceStatusText(o: ReminderOccurrence): string {
  switch (o.status) {
    case "sent":
      return "Accepted by the mail service";
    case "pending":
      return o.attempts > 0 ? "Retrying soon" : "Waiting to send";
    case "sending":
      return "Sending";
    default:
      return o.statusReason ? reasonText[o.statusReason] : o.status === "failed" ? "Failed" : "Not sent";
  }
}
