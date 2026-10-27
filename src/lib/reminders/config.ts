import "server-only";

// Reminder delivery settings, read from the server environment only. None of
// these values reach the browser. See doc/reminders.md.

export interface ReminderEnv {
  /** Public base URL for links in notifications, e.g. https://daykind.example.com */
  appUrl: string;
  /** Authorizes the scheduler endpoint and the database dispatcher functions. */
  dispatchSecret: string;
  resendApiKey: string;
  /** Sender, e.g. "DayKind <reminders@example.com>" on a domain verified with Resend. */
  emailFrom: string;
}

const REQUIRED = {
  appUrl: "DAYKIND_APP_URL",
  dispatchSecret: "REMINDER_DISPATCH_SECRET",
  resendApiKey: "RESEND_API_KEY",
  emailFrom: "REMINDER_EMAIL_FROM",
} as const;

/** At least 32 characters, so the key cannot be guessed. The database checks the same. */
export const MIN_SECRET_LENGTH = 32;

export type ReminderEnvStatus =
  | { configured: true; env: ReminderEnv }
  | { configured: false; missing: string[] };

export function reminderEnv(source: Record<string, string | undefined> = process.env): ReminderEnvStatus {
  const missing: string[] = [];
  const values = {} as Record<keyof ReminderEnv, string>;
  for (const [key, name] of Object.entries(REQUIRED) as [keyof ReminderEnv, string][]) {
    const value = source[name]?.trim() ?? "";
    if (!value) missing.push(name);
    values[key] = value;
  }
  if (values.dispatchSecret && values.dispatchSecret.length < MIN_SECRET_LENGTH) {
    missing.push(`${REQUIRED.dispatchSecret} (at least ${MIN_SECRET_LENGTH} characters)`);
  }
  if (values.appUrl && !/^https?:\/\/[^/]+/.test(values.appUrl)) missing.push(`${REQUIRED.appUrl} (an http(s) URL)`);
  if (source.DAYKIND_DATA_SOURCE !== "supabase") missing.push("DAYKIND_DATA_SOURCE=supabase");
  if (missing.length > 0) return { configured: false, missing };
  return { configured: true, env: { ...values, appUrl: values.appUrl.replace(/\/+$/, "") } };
}
