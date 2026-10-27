import "server-only";

// Reminder delivery settings, read from the server environment only. Of these,
// only the VAPID public key reaches the browser (it has to, to subscribe).
// See doc/reminders.md.
import type { ReminderChannel } from "@/lib/domain/reminders";

export interface EmailEnv {
  resendApiKey: string;
  /** Sender, e.g. "DayKind <reminders@example.com>" on a domain verified with Resend. */
  emailFrom: string;
}

export interface PushEnv {
  vapidPublicKey: string;
  vapidPrivateKey: string;
  /** Contact for push services, "mailto:you@example.com" or an https URL. */
  vapidSubject: string;
}

export interface ReminderEnv {
  /** Public base URL for links in notifications, e.g. https://daykind.example.com */
  appUrl: string;
  /** Authorizes the scheduler endpoint and the database dispatcher functions. */
  dispatchSecret: string;
  email: EmailEnv | null;
  push: PushEnv | null;
}

/** At least 32 characters, so the key cannot be guessed. The database checks the same. */
export const MIN_SECRET_LENGTH = 32;

export type ReminderEnvStatus =
  | { configured: true; env: ReminderEnv; channels: ReminderChannel[] }
  | { configured: false; missing: string[]; channels: ReminderChannel[] };

type Source = Record<string, string | undefined>;

/** The named variables, or null with what is missing. All or none must be set. */
function group<K extends string>(source: Source, names: Record<K, string>): { values: Record<K, string> | null; missing: string[] } {
  const values = {} as Record<K, string>;
  const missing: string[] = [];
  for (const [key, name] of Object.entries(names) as [K, string][]) {
    const value = source[name]?.trim() ?? "";
    if (!value) missing.push(name);
    values[key] = value;
  }
  return { values: missing.length === 0 ? values : null, missing };
}

/**
 * Reminders are configured when the core values and at least one channel are
 * complete. A partly set channel counts as missing, so it is reported.
 */
export function reminderEnv(source: Source = process.env): ReminderEnvStatus {
  const missing: string[] = [];
  const core = group(source, { appUrl: "DAYKIND_APP_URL", dispatchSecret: "REMINDER_DISPATCH_SECRET" });
  missing.push(...core.missing);
  if (core.values && core.values.dispatchSecret.length < MIN_SECRET_LENGTH) {
    missing.push(`REMINDER_DISPATCH_SECRET (at least ${MIN_SECRET_LENGTH} characters)`);
  }
  if (core.values && !/^https?:\/\/[^/]+/.test(core.values.appUrl)) missing.push("DAYKIND_APP_URL (an http(s) URL)");
  if (source.DAYKIND_DATA_SOURCE !== "supabase") missing.push("DAYKIND_DATA_SOURCE=supabase");

  const email = group(source, { resendApiKey: "RESEND_API_KEY", emailFrom: "REMINDER_EMAIL_FROM" });
  const push = group(source, { vapidPublicKey: "VAPID_PUBLIC_KEY", vapidPrivateKey: "VAPID_PRIVATE_KEY", vapidSubject: "VAPID_SUBJECT" });
  if (push.values && !/^(mailto:|https:\/\/)/.test(push.values.vapidSubject)) {
    push.values = null;
    push.missing = ["VAPID_SUBJECT (mailto: or https: URL)"];
  }
  const partly = (g: { values: unknown; missing: string[] }, size: number) => g.values === null && g.missing.length < size;
  if (partly(email, 2)) missing.push(...email.missing);
  if (partly(push, 3)) missing.push(...push.missing);
  if (!email.values && !push.values) missing.push("RESEND_API_KEY and REMINDER_EMAIL_FROM, or the VAPID_* keys");

  if (missing.length > 0) return { configured: false, missing: [...new Set(missing)], channels: [] };
  const channels: ReminderChannel[] = [];
  if (email.values) channels.push("email");
  if (push.values) channels.push("push");
  return {
    configured: true,
    channels,
    env: {
      appUrl: core.values!.appUrl.replace(/\/+$/, ""),
      dispatchSecret: core.values!.dispatchSecret,
      email: email.values,
      push: push.values,
    },
  };
}
