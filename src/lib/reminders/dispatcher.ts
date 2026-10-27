// One dispatcher run: record the reminders that have become due, claim what
// is eligible to send right now, send each claimed reminder, and record the
// result. Safe to run concurrently and repeatedly: planning is idempotent,
// claiming is exclusive, and each send carries its occurrence id as the
// email idempotency key or the push topic. Runs on the server only, started
// by the scheduler (see doc/reminders.md); it never depends on a browser
// being open.
import { dueSlots, type ReminderChannel } from "@/lib/domain/reminders";
import type { EmailSender } from "./email";
import { reminderMessage, reminderPushPayload } from "./messages";
import type { PushResult, PushSender } from "./push";
import type { ClaimedReminder, DispatchStore } from "./store";

export interface DispatchSummary {
  users: number;
  planned: number;
  claimed: number;
  sent: number;
  retrying: number;
  failed: number;
  /** Results that could not be recorded because another run took the claim over. */
  stale: number;
}

export interface DispatchOptions {
  store: DispatchStore;
  /** Senders for the channels this server can use; reminders for a missing one are not claimed. */
  senders: { email?: EmailSender | null; push?: PushSender | null };
  appUrl: string;
  /** The current time; tests set it. Production leaves it unset so the database clock decides what is due. */
  now?: Date;
  /** Send only this occurrence (a test notification), without planning. */
  onlyId?: string;
}

/** Logs counts and codes only: never addresses, user ids, or content. */
function log(message: string) {
  console.info(`[daykind] reminders: ${message}`);
}

async function deliver(
  reminder: ClaimedReminder,
  senders: DispatchOptions["senders"],
  appUrl: string,
): Promise<PushResult> {
  const input = { kind: reminder.kind, stage: reminder.stage, localDate: reminder.localDate, appUrl };
  if (reminder.channel === "push") {
    if (!senders.push || !reminder.push) return { outcome: "permanent", code: "push_unavailable" };
    return senders.push.send(reminder.push, reminderPushPayload(input), reminder.id);
  }
  if (!senders.email || !reminder.email) return { outcome: "permanent", code: "email_unavailable" };
  const message = reminderMessage(input);
  return senders.email.send({
    to: reminder.email,
    subject: message.subject,
    text: message.text,
    html: message.html,
    idempotencyKey: reminder.id,
  });
}

export async function runDispatch({ store, senders, appUrl, now, onlyId }: DispatchOptions): Promise<DispatchSummary> {
  const summary: DispatchSummary = { users: 0, planned: 0, claimed: 0, sent: 0, retrying: 0, failed: 0, stale: 0 };

  if (!onlyId) {
    const users = await store.listUsers();
    summary.users = users.length;
    const clock = now ?? new Date();
    const slots = users.flatMap((u) => dueSlots(u, clock).map((s) => ({ ...s, userId: u.userId })));
    summary.planned = await store.plan(slots);
  }

  const channels = (["email", "push"] as ReminderChannel[]).filter((c) => senders[c]);
  const claimed = await store.claim({ channels, now, onlyId });
  summary.claimed = claimed.length;

  for (const reminder of claimed) {
    let result: PushResult;
    try {
      result = await deliver(reminder, senders, appUrl);
    } catch {
      result = { outcome: "transient", code: "sender_error" };
    }
    if (result.outcome === "gone" && reminder.push) {
      // The browser unsubscribed or its subscription expired: forget it so Settings asks to register again.
      await store.dropSubscription(reminder.push.subscriptionId);
    }
    const detail = result.outcome === "sent" ? result.messageId : result.code;
    const outcome = result.outcome === "gone" ? "permanent" : result.outcome;
    const recorded = await store.record(reminder, outcome, detail, now);
    if (recorded === "sent") summary.sent++;
    else if (recorded === "retry") summary.retrying++;
    else if (recorded === "failed") summary.failed++;
    else summary.stale++;
    if (result.outcome !== "sent") log(`${reminder.channel} attempt ${reminder.attempt} not accepted (${result.code}); ${recorded}`);
  }

  log(
    `run done: ${summary.users} users, ${summary.planned} planned, ${summary.claimed} claimed, ${summary.sent} sent, ` +
      `${summary.retrying} retrying, ${summary.failed} failed, ${summary.stale} stale`,
  );
  return summary;
}
