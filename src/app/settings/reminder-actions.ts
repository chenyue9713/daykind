"use server";

import { refresh } from "next/cache";
import { unstable_rethrow } from "next/navigation";

import { getSetUpRepository } from "@/lib/data";
import { formatTime } from "@/lib/domain/dates";
import { validateReminderSettings } from "@/lib/domain/reminders";
import { fromResult, invalid, staleForm, toRaw, writeMeta, type CheckInFormState } from "@/lib/forms/server-form";
import { dispatchReminders, reminderEnv } from "@/lib/reminders/server";

const failed = (message: string): CheckInFormState => ({ status: "failed", message, errors: {} });

const NOT_CONFIGURED =
  "Email delivery isn't set up on this server yet, so nothing can be sent. The setup steps are in doc/reminders.md.";

/** Settings: reminder delivery, which reminders, follow-ups, and quiet hours. */
export async function saveReminderSettings(_prev: CheckInFormState, formData: FormData): Promise<CheckInFormState> {
  const raw = toRaw(formData);
  const meta = writeMeta(raw);
  if (!meta) return staleForm;
  const parsed = validateReminderSettings(raw);
  if (!parsed.ok) return invalid(parsed.errors);
  try {
    const repo = await getSetUpRepository();
    const state = fromResult(await repo.saveReminderSettings(parsed.value, meta));
    if (state.status !== "saved") return state;
    if (!parsed.value.emailEnabled) {
      return { ...state, message: "Saved. Email reminders are off; due check-ins still show on Today." };
    }
    return {
      ...state,
      message: reminderEnv().configured
        ? "Saved. Email reminders are on from now; earlier reminders today are not sent."
        : `Saved, but ${NOT_CONFIGURED.charAt(0).toLowerCase()}${NOT_CONFIGURED.slice(1)}`,
    };
  } catch (error) {
    unstable_rethrow(error);
    return failed("Not saved: the server could not save your reminder settings. Your choices are still here — try again.");
  }
}

/**
 * Sends one test email now, through the same queue, claim, and provider path
 * as real reminders, so its status shows under "Recent notifications".
 */
export async function sendTestReminder(_prev: CheckInFormState, formData: FormData): Promise<CheckInFormState> {
  const meta = writeMeta(toRaw(formData));
  if (!meta) return staleForm;
  try {
    const repo = await getSetUpRepository();
    if (repo.isSample) {
      return { status: "not_persisted", message: "Sample mode: test notifications are not sent.", errors: {} };
    }
    const env = reminderEnv();
    if (!env.configured) return failed(NOT_CONFIGURED);

    const requested = await repo.requestTestReminder(meta);
    if (requested.status !== "saved") return fromResult(requested);
    const summary = await dispatchReminders(env.env, { onlyId: requested.record.id });
    refresh();
    const timezone = (await repo.getProfile()).timezone;
    if (summary.sent > 0) {
      return {
        status: "saved",
        message: `Accepted by the mail service at ${formatTime(new Date().toISOString(), timezone)}. Look for “DayKind test notification” (check spam too). Accepted doesn't guarantee it reaches your inbox.`,
        errors: {},
      };
    }
    if (summary.retrying > 0) {
      return failed("The mail service didn't accept it yet. DayKind will retry for up to 15 minutes; the status below shows the result.");
    }
    if (summary.claimed === 0) {
      return { status: "saved", message: "This test was already handled. See its status below.", errors: {} };
    }
    return failed("The mail service refused the test email. Check the sender address and API key on the server (doc/reminders.md).");
  } catch (error) {
    unstable_rethrow(error);
    return failed("The test could not be sent because the server had a problem. Try again in a minute.");
  }
}
