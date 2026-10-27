// One dispatcher run: record the reminders that have become due, claim what
// is eligible to send right now, send each claimed reminder, and record the
// result. Safe to run concurrently and repeatedly: planning is idempotent,
// claiming is exclusive, and each email carries its occurrence id as the
// provider idempotency key. Runs on the server only, started by the scheduler
// (see doc/reminders.md); it never depends on a browser being open.
import { dueSlots } from "@/lib/domain/reminders";
import type { EmailSender } from "./email";
import { reminderMessage } from "./messages";
import type { DispatchStore } from "./store";

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
  sender: EmailSender;
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

export async function runDispatch({ store, sender, appUrl, now, onlyId }: DispatchOptions): Promise<DispatchSummary> {
  const summary: DispatchSummary = { users: 0, planned: 0, claimed: 0, sent: 0, retrying: 0, failed: 0, stale: 0 };

  if (!onlyId) {
    const users = await store.listUsers();
    summary.users = users.length;
    const clock = now ?? new Date();
    const slots = users.flatMap((u) => dueSlots(u, clock).map((s) => ({ ...s, userId: u.userId })));
    summary.planned = await store.plan(slots);
  }

  const claimed = await store.claim({ now, onlyId });
  summary.claimed = claimed.length;

  for (const reminder of claimed) {
    const message = reminderMessage({ kind: reminder.kind, stage: reminder.stage, localDate: reminder.localDate, appUrl });
    let result;
    try {
      result = await sender.send({
        to: reminder.email,
        subject: message.subject,
        text: message.text,
        html: message.html,
        idempotencyKey: reminder.id,
      });
    } catch {
      result = { outcome: "transient" as const, code: "sender_error" };
    }
    const detail = result.outcome === "sent" ? result.messageId : result.code;
    const recorded = await store.record(reminder, result.outcome, detail, now);
    if (recorded === "sent") summary.sent++;
    else if (recorded === "retry") summary.retrying++;
    else if (recorded === "failed") summary.failed++;
    else summary.stale++;
    if (result.outcome !== "sent") log(`attempt ${reminder.attempt} not accepted (${result.code}); ${recorded}`);
  }

  log(
    `run done: ${summary.users} users, ${summary.planned} planned, ${summary.claimed} claimed, ${summary.sent} sent, ` +
      `${summary.retrying} retrying, ${summary.failed} failed, ${summary.stale} stale`,
  );
  return summary;
}
