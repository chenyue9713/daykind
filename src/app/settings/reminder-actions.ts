"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";

import { getSetUpRepository } from "@/lib/data";
import { UUID_PATTERN } from "@/lib/domain/checkins";
import { formatTime } from "@/lib/domain/dates";
import { describeDevice, validatePushSubscription, validateReminderSettings, type ReminderChannel } from "@/lib/domain/reminders";
import { fromResult, invalid, staleForm, toRaw, writeMeta, type CheckInFormState } from "@/lib/forms/server-form";
import { dispatchReminders, reminderEnv } from "@/lib/reminders/server";

const failed = (message: string): CheckInFormState => ({ status: "failed", message, errors: {} });

const channelName: Record<ReminderChannel, string> = { email: "Email", push: "Browser notification" };

const notConfigured = (channel: ReminderChannel) =>
  `${channelName[channel]} delivery isn't set up on this server yet, so nothing can be sent that way. The setup steps are in doc/reminders.md.`;

/** Settings: reminder delivery, channel, which reminders, follow-ups, and quiet hours. */
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
    const { deliveryEnabled, channel } = parsed.value;
    if (!deliveryEnabled) {
      return { ...state, message: "Saved. Reminders are off; due check-ins still show on Today." };
    }
    if (!reminderEnv().channels.includes(channel)) return { ...state, message: `Saved, but ${notConfigured(channel)}` };
    if (channel === "push" && !(await repo.getPushDevice())) {
      return { ...state, message: "Saved. No browser is registered yet: turn on notifications for this browser below." };
    }
    return { ...state, message: "Saved. Reminders are on from now; earlier reminders today are not sent." };
  } catch (error) {
    unstable_rethrow(error);
    return failed("Not saved: the server could not save your reminder settings. Your choices are still here — try again.");
  }
}

/**
 * Sends one test notification now on the chosen channel, through the same
 * queue, claim, and provider path as real reminders, so its status shows
 * under "Recent notifications".
 */
export async function sendTestReminder(_prev: CheckInFormState, formData: FormData): Promise<CheckInFormState> {
  const raw = toRaw(formData);
  const meta = writeMeta(raw);
  if (!meta) return staleForm;
  const channel: ReminderChannel = raw.channel === "push" ? "push" : "email";
  try {
    const repo = await getSetUpRepository();
    if (repo.isSample) {
      return { status: "not_persisted", message: "Sample mode: test notifications are not sent.", errors: {} };
    }
    const env = reminderEnv();
    if (!env.configured || !env.channels.includes(channel)) return failed(notConfigured(channel));

    const requested = await repo.requestTestReminder(channel, meta);
    if (requested.status !== "saved") return fromResult(requested);
    const summary = await dispatchReminders(env.env, { onlyId: requested.record.id });
    refresh();
    const timezone = (await repo.getProfile()).timezone;
    const service = channel === "push" ? "push service" : "mail service";
    if (summary.sent > 0) {
      const look =
        channel === "push"
          ? "It should appear on the registered browser within a few seconds."
          : "Look for “DayKind test notification” (check spam too).";
      return {
        status: "saved",
        message: `Accepted by the ${service} at ${formatTime(new Date().toISOString(), timezone)}. ${look} Accepted doesn't guarantee it is shown.`,
        errors: {},
      };
    }
    if (summary.retrying > 0) {
      return failed(`The ${service} didn't accept it yet. DayKind will retry for up to 15 minutes; the status below shows the result.`);
    }
    if (summary.claimed === 0) {
      return { status: "saved", message: "This test was handled already, or could not be sent. See its status below.", errors: {} };
    }
    return failed(
      channel === "push"
        ? "The push service refused it. If this browser was unregistered, turn notifications on again below."
        : "The mail service refused the test email. Check the sender address and API key on the server (doc/reminders.md).",
    );
  } catch (error) {
    unstable_rethrow(error);
    return failed("The test could not be sent because the server had a problem. Try again in a minute.");
  }
}

export interface PushRegistrationResult {
  ok: boolean;
  message: string;
}

/**
 * Stores this browser's push subscription, replacing any other registered
 * browser. Called by the browser after it subscribed; `subscription` is
 * PushSubscription.toJSON() and is validated here.
 */
export async function registerPushDevice(subscription: unknown, requestId: string): Promise<PushRegistrationResult> {
  if (!UUID_PATTERN.test(requestId)) return { ok: false, message: "This page is out of date. Reload and try again." };
  const label = describeDevice((await headers()).get("user-agent") ?? "");
  const input = validatePushSubscription(subscription, label);
  if (!input) return { ok: false, message: "This browser returned a subscription DayKind cannot use." };
  try {
    const repo = await getSetUpRepository();
    const result = await repo.savePushDevice(input, { requestId, expectedRevision: null });
    if (result.status === "not_persisted") return { ok: false, message: result.reason };
    if (result.status !== "saved") return { ok: false, message: `Not saved: ${result.reason}` };
    refresh();
    return { ok: true, message: `Saved. ${label} now receives DayKind notifications; any other browser no longer does.` };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: "The server could not save this browser. Try again." };
  }
}

/** Unregisters the browser with this endpoint (this browser, after it unsubscribed). */
export async function unregisterPushDevice(endpoint: string): Promise<PushRegistrationResult> {
  if (typeof endpoint !== "string" || endpoint.length > 1000) return { ok: false, message: "Nothing to remove." };
  try {
    const repo = await getSetUpRepository();
    const result = await repo.removePushDevice(endpoint);
    if (result.status !== "saved") return { ok: false, message: "reason" in result ? result.reason : "Not saved." };
    refresh();
    return { ok: true, message: "This browser no longer receives DayKind notifications." };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: "The server could not update this. Try again." };
  }
}
