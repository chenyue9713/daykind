// Reminder dispatch against the real migrations in an in-process Postgres
// (PGlite), with a fake email sender and an injected clock. Covers disabled
// delivery, completion suppression, follow-ups, quiet hours, DST, timezone
// changes, lateness, retries, overlapping runs, test notifications, and
// ownership of reminder records.
import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import { preferencesPayload, reminderSettingsPayload } from "@/lib/data/supabase/mapping";
import { DEFAULT_REMINDER_SETTINGS, type ReminderSettingsInput } from "@/lib/domain/reminders";
import { createTestDb, type TestDb } from "@/lib/data/supabase/__tests__/pg-harness";
import { runDispatch } from "../dispatcher";
import type { EmailSender, OutgoingEmail, SendResult } from "../email";
import { createDispatchStore, type DispatchStore, type RpcCall } from "../store";

const KEY = "test-dispatch-key-0123456789abcdef-0123456789";
const APP = "https://daykind.example.test";
const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000b2";

let t: TestDb;
let store: DispatchStore;
let n = 0;
const uuid = () => `33333333-3333-4333-8333-${String(++n).padStart(12, "0")}`;

// Argument types of the reminder_* functions, so PGlite binds parameters exactly.
const ARG_TYPES: Record<string, string> = {
  p_key: "text",
  p_slots: "jsonb",
  p_now: "timestamptz",
  p_limit: "integer",
  p_only: "uuid",
  p_id: "uuid",
  p_claim: "uuid",
  p_outcome: "text",
  p_detail: "text",
};

/** Calls a dispatcher function the way the app does: as `anon`, with no session. */
function anonCall(db: TestDb): RpcCall {
  return (name, args) =>
    db.as(null, async () => {
      const keys = Object.keys(args);
      const list = keys.map((k, i) => `${k} => $${i + 1}::${ARG_TYPES[k]}`).join(", ");
      const params = keys.map((k) => (k === "p_slots" ? JSON.stringify(args[k]) : args[k]));
      const r = await db.db.query<{ result: unknown }>(`select public.${name}(${list}) as result`, params);
      return r.rows[0].result;
    });
}

/** Records every email and answers from a queue of results (default: accepted). */
class FakeSender implements EmailSender {
  sent: OutgoingEmail[] = [];
  queue: SendResult["outcome"][] = [];
  async send(email: OutgoingEmail): Promise<SendResult> {
    this.sent.push(email);
    const outcome = this.queue.shift() ?? "sent";
    if (outcome === "sent") return { outcome, messageId: `msg-${this.sent.length}` };
    return { outcome, code: outcome === "transient" ? "http_503" : "http_422_validation_error" };
  }
}

const at = (iso: string) => new Date(iso);
const dispatch = (sender: EmailSender, now: string, onlyId?: string) =>
  runDispatch({ store, sender, appUrl: APP, now: at(now), onlyId });

async function sql<T = Record<string, unknown>>(query: string, params: unknown[] = []) {
  return (await t.db.query<T>(query, params)).rows;
}

async function occurrences(user = A) {
  return sql<{ kind: string; stage: string; local_date: string; status: string; status_reason: string | null; attempts: number }>(
    `select kind, stage, to_char(local_date, 'YYYY-MM-DD') as local_date, status, status_reason, attempts
       from public.reminder_occurrences where user_id = $1 order by scheduled_at, stage`,
    [user],
  );
}

/**
 * A set-up user with a confirmed timezone and the given reminder settings.
 * Email has been on since `enabledAt`, by default the start of Tuesday,
 * October 27, 2026 in Los Angeles (00:00 PDT).
 */
async function setUpUser(
  user: string,
  timezone: string,
  settings: Partial<ReminderSettingsInput> = {},
  enabledAt = "2026-10-27T07:00:00Z",
) {
  await t.createUser(user);
  await t.as(user, () => t.db.query("insert into public.profiles default values"));
  const prefs = await t.rpc(
    user,
    "save_preferences",
    preferencesPayload(
      {
        preferences: { timezone, distanceUnit: "mi", weightUnit: "lb", weightTrackingEnabled: false },
        acknowledgeGuidance: true,
        completeOnboarding: true,
      },
      { requestId: uuid(), expectedRevision: 1 },
    ),
  );
  expect(prefs.status).toBe("saved");
  const input: ReminderSettingsInput = { ...DEFAULT_REMINDER_SETTINGS, emailEnabled: true, ...settings };
  const saved = await t.rpc(user, "save_reminder_settings", reminderSettingsPayload(input, { requestId: uuid(), expectedRevision: null }));
  expect(saved.status).toBe("saved");
  if (input.emailEnabled) {
    await sql("update public.reminder_settings set email_enabled_at = $2 where user_id = $1", [user, enabledAt]);
  }
}

async function completeMorning(user: string, date: string, timezone = "America/Los_Angeles") {
  await sql(
    `insert into public.sleep_entries (user_id, waking_date, timezone, duration_min_seconds, duration_max_seconds, restfulness, morning_fatigue)
     values ($1, $2, $3, 25200, 25200, 'somewhat_rested', 'mildly_tired')`,
    [user, date, timezone],
  );
}

async function completeEvening(user: string, date: string, timezone = "America/Los_Angeles") {
  await sql(
    `insert into public.evening_entries (user_id, local_date, timezone, activity_status, evening_fatigue)
     values ($1, $2, $3, 'confirmed_none', 'mildly_tired')`,
    [user, date, timezone],
  );
}

beforeEach(async () => {
  t = await createTestDb();
  await sql("insert into daykind_private.dispatch_keys (key_hash) values ($1)", [
    createHash("sha256").update(KEY).digest("hex"),
  ]);
  store = createDispatchStore(anonCall(t), KEY);
}, 60_000);

// 2026-10-27 is a Tuesday; Los Angeles is on PDT (UTC-7) until 2026-11-01.
describe("delivery opt-in", () => {
  it("plans and sends nothing until the user turns email on", async () => {
    await setUpUser(A, "America/Los_Angeles", { emailEnabled: false });
    const sender = new FakeSender();
    const summary = await dispatch(sender, "2026-10-27T17:05:00Z");
    expect(summary).toMatchObject({ users: 0, planned: 0, claimed: 0, sent: 0 });
    expect(sender.sent).toEqual([]);
    expect(await occurrences()).toEqual([]);
  });

  it("does not send reminders scheduled before delivery was turned on", async () => {
    // Turned on at 10:30 AM: the 10 AM reminder is not sent, the 11 AM follow-up is.
    await setUpUser(A, "America/Los_Angeles", {}, "2026-10-27T17:30:00Z");
    const sender = new FakeSender();
    await dispatch(sender, "2026-10-27T17:35:00Z");
    expect(sender.sent).toHaveLength(0);
    await dispatch(sender, "2026-10-27T18:00:00Z");
    expect(sender.sent.map((e) => e.subject)).toEqual(["Reminder: your DayKind morning check-in is still open"]);
  });

  it("stops a pending reminder when delivery is turned off before it is claimed", async () => {
    await setUpUser(A, "America/Los_Angeles");
    await store.plan([
      { userId: A, kind: "morning", stage: "initial", localDate: "2026-10-27", timezone: "America/Los_Angeles", scheduledAt: "2026-10-27T17:00:00.000Z" },
    ]);
    await sql("update public.reminder_settings set email_enabled = false, email_enabled_at = null where user_id = $1", [A]);
    const sender = new FakeSender();
    await dispatch(sender, "2026-10-27T17:00:00Z");
    expect(sender.sent).toEqual([]);
    expect(await occurrences()).toMatchObject([{ status: "skipped", status_reason: "delivery_off" }]);
  });

  it("refuses dispatcher calls without the right key", async () => {
    const wrong = createDispatchStore(anonCall(t), "x".repeat(40));
    await expect(wrong.listUsers()).rejects.toThrow(/dispatch key not accepted/);
    await expect(wrong.claim({ now: at("2026-10-27T17:00:00Z") })).rejects.toThrow(/dispatch key not accepted/);
    await expect(createDispatchStore(anonCall(t), "").listUsers()).rejects.toThrow(/dispatch key not accepted/);
  });
});

describe("daily reminders", () => {
  it("sends the 10 AM reminder once, however many runs see it", async () => {
    await setUpUser(A, "America/Los_Angeles");
    const sender = new FakeSender();
    await dispatch(sender, "2026-10-27T16:55:00Z"); // 9:55 AM
    expect(sender.sent).toHaveLength(0);
    await dispatch(sender, "2026-10-27T17:00:00Z"); // 10:00 AM
    await dispatch(sender, "2026-10-27T17:05:00Z");
    await dispatch(sender, "2026-10-27T17:10:00Z");
    expect(sender.sent).toHaveLength(1);
    const [email] = sender.sent;
    expect(email).toMatchObject({ to: `${A}@example.test`, subject: "Your DayKind morning check-in is ready" });
    expect(email.text).toContain(`${APP}/check-in/morning?date=2026-10-27`);
    expect(await occurrences()).toMatchObject([{ kind: "morning", stage: "initial", status: "sent", attempts: 1 }]);
  });

  it("suppresses the reminder and follow-up when the check-in is already complete", async () => {
    await setUpUser(A, "America/Los_Angeles");
    await completeMorning(A, "2026-10-27");
    const sender = new FakeSender();
    await dispatch(sender, "2026-10-27T17:00:00Z");
    await dispatch(sender, "2026-10-27T18:00:00Z");
    expect(sender.sent).toEqual([]);
    expect(await occurrences()).toMatchObject([
      { stage: "initial", status: "suppressed", status_reason: "completed" },
      { stage: "follow_up", status: "suppressed", status_reason: "completed" },
    ]);
  });

  it("suppresses the evening reminder when that day's evening check-in is complete", async () => {
    await setUpUser(A, "America/Los_Angeles", { morningEnabled: false });
    await completeEvening(A, "2026-10-26"); // a different day does not count
    await completeEvening(A, "2026-10-27");
    const sender = new FakeSender();
    await dispatch(sender, "2026-10-28T04:00:00Z");
    await dispatch(sender, "2026-10-28T05:00:00Z");
    expect(sender.sent).toEqual([]);
    expect((await occurrences()).map((o) => o.status)).toEqual(["suppressed", "suppressed"]);
  });

  it("does not let a draft suppress a reminder", async () => {
    await setUpUser(A, "America/Los_Angeles");
    await sql(
      `insert into public.sleep_entries (user_id, waking_date, timezone, completion_state) values ($1, '2026-10-27', 'America/Los_Angeles', 'draft')`,
      [A],
    );
    const sender = new FakeSender();
    await dispatch(sender, "2026-10-27T17:00:00Z");
    expect(sender.sent).toHaveLength(1);
  });

  it("sends one follow-up an hour later only while the check-in is incomplete", async () => {
    await setUpUser(A, "America/Los_Angeles");
    const sender = new FakeSender();
    await dispatch(sender, "2026-10-28T04:00:00Z"); // Oct 27, 9 PM
    await dispatch(sender, "2026-10-28T05:00:00Z"); // 10 PM
    await dispatch(sender, "2026-10-28T05:30:00Z");
    expect(sender.sent.map((e) => e.subject)).toEqual([
      "Your DayKind evening check-in is ready",
      "Reminder: your DayKind evening check-in is still open",
    ]);
  });

  it("cancels the pending follow-up when the check-in is completed on any device", async () => {
    await setUpUser(A, "America/Los_Angeles");
    const sender = new FakeSender();
    await dispatch(sender, "2026-10-27T17:00:00Z");
    await completeMorning(A, "2026-10-27"); // saved from the phone at 10:20 AM
    await dispatch(sender, "2026-10-27T18:00:00Z");
    expect(sender.sent).toHaveLength(1);
    expect((await occurrences())[1]).toMatchObject({ stage: "follow_up", status: "suppressed", status_reason: "completed" });
  });

  it("sends no follow-ups when they are turned off", async () => {
    await setUpUser(A, "America/Los_Angeles", { followUpsEnabled: false });
    const sender = new FakeSender();
    await dispatch(sender, "2026-10-27T17:00:00Z");
    await dispatch(sender, "2026-10-27T18:00:00Z");
    expect(sender.sent).toHaveLength(1);
    expect(await occurrences()).toHaveLength(1);
  });

  it("respects a reminder that is turned off", async () => {
    await setUpUser(A, "America/Los_Angeles", { morningEnabled: false });
    const sender = new FakeSender();
    await dispatch(sender, "2026-10-27T18:00:00Z");
    expect(sender.sent).toEqual([]);
  });
});

describe("quiet hours", () => {
  it("sends the 10 PM follow-up with the default 10:30 PM–8 AM quiet hours", async () => {
    await setUpUser(A, "America/Los_Angeles");
    const sender = new FakeSender();
    await dispatch(sender, "2026-10-28T05:00:00Z");
    expect(sender.sent.map((e) => e.subject)).toContain("Reminder: your DayKind evening check-in is still open");
  });

  it("skips a follow-up inside quiet hours instead of moving it, but not the 9 PM reminder", async () => {
    await setUpUser(A, "America/Los_Angeles", { morningEnabled: false, quietStart: "21:30", quietEnd: "07:00" });
    const sender = new FakeSender();
    await dispatch(sender, "2026-10-28T04:00:00Z"); // 9 PM
    await dispatch(sender, "2026-10-28T05:00:00Z"); // 10 PM
    await dispatch(sender, "2026-10-28T15:00:00Z"); // next morning, 8 AM
    expect(sender.sent.map((e) => e.subject)).toEqual(["Your DayKind evening check-in is ready"]);
    expect(await occurrences()).toMatchObject([
      { kind: "evening", stage: "initial", status: "sent" },
      { kind: "evening", stage: "follow_up", status: "skipped", status_reason: "quiet_hours" },
    ]);
  });

  it("applies quiet hours that do not cross midnight", async () => {
    await setUpUser(A, "America/Los_Angeles", { quietStart: "10:45", quietEnd: "11:15" });
    const sender = new FakeSender();
    await dispatch(sender, "2026-10-27T17:00:00Z");
    await dispatch(sender, "2026-10-27T18:00:00Z");
    expect(sender.sent).toHaveLength(1);
    expect((await occurrences())[1]).toMatchObject({ status: "skipped", status_reason: "quiet_hours" });
  });

  it("can be turned off", async () => {
    await setUpUser(A, "America/Los_Angeles", { quietHoursEnabled: false, quietStart: "21:30", quietEnd: "07:00" });
    const sender = new FakeSender();
    await dispatch(sender, "2026-10-28T05:00:00Z");
    expect(sender.sent.map((e) => e.subject)).toContain("Reminder: your DayKind evening check-in is still open");
  });
});

describe("daylight saving time", () => {
  it("keeps 10 AM local when the clocks fall back", async () => {
    await setUpUser(A, "America/Los_Angeles", { followUpsEnabled: false, eveningEnabled: false }, "2026-11-01T07:00:00Z");
    const sender = new FakeSender();
    // Sun Nov 1, 2026: 17:00Z is 9 AM PST, not yet due; 18:00Z is 10 AM PST.
    await dispatch(sender, "2026-11-01T17:00:00Z");
    expect(sender.sent).toHaveLength(0);
    await dispatch(sender, "2026-11-01T18:00:00Z");
    expect(sender.sent).toHaveLength(1);
    const [row] = await sql<{ local_time: string }>(
      `select to_char(scheduled_at at time zone 'America/Los_Angeles', 'HH24:MI') as local_time from public.reminder_occurrences`,
    );
    expect(row.local_time).toBe("10:00");
  });

  it("keeps 10 AM local when the clocks spring forward", async () => {
    await setUpUser(A, "America/Los_Angeles", { followUpsEnabled: false, eveningEnabled: false }, "2026-03-07T08:00:00Z");
    const sender = new FakeSender();
    // Sun Mar 8, 2026: 10 AM PDT is 17:00Z (it was 18:00Z the day before, in PST).
    await dispatch(sender, "2026-03-07T18:00:00Z");
    await dispatch(sender, "2026-03-08T16:55:00Z");
    expect(sender.sent).toHaveLength(1);
    await dispatch(sender, "2026-03-08T17:00:00Z");
    expect(sender.sent).toHaveLength(2);
    expect((await occurrences()).map((o) => o.local_date)).toEqual(["2026-03-07", "2026-03-08"]);
  });
});

describe("timezone changes", () => {
  it("does not repeat a reminder already sent for that date after moving west", async () => {
    await setUpUser(A, "America/New_York", { followUpsEnabled: false });
    const sender = new FakeSender();
    await dispatch(sender, "2026-10-27T14:00:00Z"); // 10 AM in New York
    expect(sender.sent).toHaveLength(1);
    await sql("update public.profiles set timezone = 'America/Los_Angeles' where user_id = $1", [A]);
    await dispatch(sender, "2026-10-27T17:00:00Z"); // 10 AM in Los Angeles, same date
    expect(sender.sent).toHaveLength(1);
  });

  it("replans an unsent reminder in the new timezone", async () => {
    await setUpUser(A, "America/Los_Angeles", { followUpsEnabled: false });
    await store.plan([
      { userId: A, kind: "morning", stage: "initial", localDate: "2026-10-27", timezone: "America/Los_Angeles", scheduledAt: "2026-10-27T17:00:00.000Z" },
    ]);
    await sql("update public.profiles set timezone = 'America/Denver' where user_id = $1", [A]);
    const sender = new FakeSender();
    // 10:00 AM Denver is 16:00Z. Claiming the stale row drops it; the next run plans it in Denver time.
    await dispatch(sender, "2026-10-27T17:00:00Z");
    await dispatch(sender, "2026-10-27T17:05:00Z");
    expect(sender.sent).toHaveLength(1);
    const rows = await sql<{ timezone: string; status: string }>("select timezone, status from public.reminder_occurrences");
    expect(rows).toEqual([{ timezone: "America/Denver", status: "sent" }]);
  });

  it("does not resend a reminder whose earlier attempt may have reached the provider", async () => {
    await setUpUser(A, "America/Los_Angeles", { followUpsEnabled: false });
    const sender = new FakeSender();
    sender.queue = ["transient"];
    await dispatch(sender, "2026-10-27T17:00:00Z");
    await sql("update public.profiles set timezone = 'America/Denver' where user_id = $1", [A]);
    await dispatch(sender, "2026-10-27T17:05:00Z");
    expect(sender.sent).toHaveLength(1);
    expect(await occurrences()).toMatchObject([{ status: "skipped", status_reason: "timezone_changed" }]);
  });

  it("sends nothing while the timezone is unconfirmed", async () => {
    await setUpUser(A, "America/Los_Angeles");
    await store.plan([
      { userId: A, kind: "morning", stage: "initial", localDate: "2026-10-27", timezone: "America/Los_Angeles", scheduledAt: "2026-10-27T17:00:00.000Z" },
    ]);
    // Not reachable through the app (setup requires a confirmed timezone); checked as a safeguard.
    await sql("update public.profiles set timezone_confirmed = false, onboarding_completed_at = null where user_id = $1", [A]);
    const sender = new FakeSender();
    await dispatch(sender, "2026-10-27T17:00:00Z");
    expect(sender.sent).toEqual([]);
    expect(await occurrences()).toMatchObject([{ status: "skipped", status_reason: "timezone_unconfirmed" }]);
  });
});

describe("lateness", () => {
  it("skips a reminder more than two hours late but still sends a follow-up that is not", async () => {
    await setUpUser(A, "America/Los_Angeles");
    const sender = new FakeSender();
    // The scheduler was down until 12:30 PM.
    await dispatch(sender, "2026-10-27T19:30:00Z");
    expect(sender.sent.map((e) => e.subject)).toEqual(["Reminder: your DayKind morning check-in is still open"]);
    expect(await occurrences()).toMatchObject([
      { kind: "morning", stage: "initial", status: "skipped", status_reason: "too_late" },
      { kind: "morning", stage: "follow_up", status: "sent" },
    ]);
  });
});

describe("retries", () => {
  it("retries a transient failure with the same idempotency key and sends once", async () => {
    await setUpUser(A, "America/Los_Angeles", { followUpsEnabled: false });
    const sender = new FakeSender();
    sender.queue = ["transient"];
    await dispatch(sender, "2026-10-27T17:00:00Z");
    expect(await occurrences()).toMatchObject([{ status: "pending", attempts: 1 }]);
    await dispatch(sender, "2026-10-27T17:01:00Z"); // backoff not over
    expect(sender.sent).toHaveLength(1);
    await dispatch(sender, "2026-10-27T17:02:00Z");
    expect(sender.sent).toHaveLength(2);
    expect(new Set(sender.sent.map((e) => e.idempotencyKey)).size).toBe(1);
    expect(await occurrences()).toMatchObject([{ status: "sent", attempts: 2 }]);
  });

  it("gives up after three retries", async () => {
    await setUpUser(A, "America/Los_Angeles", { followUpsEnabled: false });
    const sender = new FakeSender();
    sender.queue = ["transient", "transient", "transient", "transient", "transient"];
    for (const time of ["17:00", "17:02", "17:07", "17:17", "17:30", "18:00"]) {
      await dispatch(sender, `2026-10-27T${time}:00Z`);
    }
    expect(sender.sent).toHaveLength(4);
    expect(await occurrences()).toMatchObject([{ status: "failed", status_reason: "retries_exhausted", attempts: 4 }]);
  });

  it("does not retry past the two-hour window", async () => {
    await setUpUser(A, "America/Los_Angeles", { followUpsEnabled: false });
    const sender = new FakeSender();
    sender.queue = ["transient"];
    await dispatch(sender, "2026-10-27T18:59:00Z"); // 11:59 AM: a retry 2 minutes later would be over two hours late
    expect(await occurrences()).toMatchObject([{ status: "failed", status_reason: "too_late", attempts: 1 }]);
  });

  it("does not retry a permanent failure", async () => {
    await setUpUser(A, "America/Los_Angeles", { followUpsEnabled: false });
    const sender = new FakeSender();
    sender.queue = ["permanent"];
    await dispatch(sender, "2026-10-27T17:00:00Z");
    await dispatch(sender, "2026-10-27T17:30:00Z");
    expect(sender.sent).toHaveLength(1);
    expect(await occurrences()).toMatchObject([{ status: "failed", status_reason: "provider_rejected" }]);
  });

  it("treats a thrown sender error as transient", async () => {
    await setUpUser(A, "America/Los_Angeles", { followUpsEnabled: false });
    let calls = 0;
    const flaky: EmailSender = {
      async send() {
        calls++;
        if (calls === 1) throw new Error("socket hang up");
        return { outcome: "sent", messageId: "ok" };
      },
    };
    await dispatch(flaky, "2026-10-27T17:00:00Z");
    await dispatch(flaky, "2026-10-27T17:02:00Z");
    expect(calls).toBe(2);
    expect(await occurrences()).toMatchObject([{ status: "sent" }]);
  });
});

describe("concurrent runs", () => {
  it("sends each reminder once when runs overlap", async () => {
    await setUpUser(A, "America/Los_Angeles");
    await setUpUser(B, "America/Los_Angeles");
    const sender = new FakeSender();
    const summaries = await Promise.all([
      dispatch(sender, "2026-10-27T17:00:00Z"),
      dispatch(sender, "2026-10-27T17:00:00Z"),
      dispatch(sender, "2026-10-27T17:00:00Z"),
    ]);
    expect(sender.sent.map((e) => e.to).sort()).toEqual([`${A}@example.test`, `${B}@example.test`]);
    expect(summaries.reduce((sum, s) => sum + s.sent, 0)).toBe(2);
  });

  it("lets a later run take over an expired claim, which the first run can no longer record", async () => {
    await setUpUser(A, "America/Los_Angeles", { followUpsEnabled: false });
    await store.plan([
      { userId: A, kind: "morning", stage: "initial", localDate: "2026-10-27", timezone: "America/Los_Angeles", scheduledAt: "2026-10-27T17:00:00.000Z" },
    ]);
    const [first] = await store.claim({ now: at("2026-10-27T17:00:00Z") });
    expect(first).toBeDefined();
    // Within the five-minute lease nobody else can claim it.
    expect(await store.claim({ now: at("2026-10-27T17:04:00Z") })).toEqual([]);
    const [second] = await store.claim({ now: at("2026-10-27T17:06:00Z") });
    expect(second.id).toBe(first.id); // same occurrence, so the same provider idempotency key
    expect(await store.record(first, "sent", "late", at("2026-10-27T17:06:30Z"))).toBe("stale");
    expect(await store.record(second, "sent", "msg", at("2026-10-27T17:06:30Z"))).toBe("sent");
    expect(await occurrences()).toMatchObject([{ status: "sent", attempts: 2 }]);
  });
});

describe("test notifications", () => {
  it("sends a requested test even when reminders are off, once per request", async () => {
    await setUpUser(A, "America/Los_Angeles", { emailEnabled: false });
    const request = uuid();
    const r = await t.rpc(A, "request_test_reminder", { request_id: request });
    expect(r.status).toBe("saved");
    const id = String((r.record as { id: string }).id);
    const sender = new FakeSender();
    const nowIso = new Date().toISOString();
    await dispatch(sender, nowIso, id);
    expect(sender.sent.map((e) => e.subject)).toEqual(["DayKind test notification"]);
    // A retried request returns the same test and does not send again.
    const again = await t.rpc(A, "request_test_reminder", { request_id: request });
    expect((again.record as { id: string }).id).toBe(id);
    await dispatch(sender, nowIso, id);
    expect(sender.sent).toHaveLength(1);
  });

  it("limits tests to five an hour", async () => {
    await setUpUser(A, "America/Los_Angeles", { emailEnabled: false });
    for (let i = 0; i < 5; i++) expect((await t.rpc(A, "request_test_reminder", { request_id: uuid() })).status).toBe("saved");
    expect((await t.rpc(A, "request_test_reminder", { request_id: uuid() })).status).toBe("rate_limited");
  });
});

describe("ownership", () => {
  it("lets each user read only their own reminder records and write none directly", async () => {
    await setUpUser(A, "America/Los_Angeles");
    await setUpUser(B, "America/Los_Angeles", { emailEnabled: false });
    await dispatch(new FakeSender(), "2026-10-27T17:00:00Z");

    const seenByA = await t.as(A, async () => (await t.db.query("select id from public.reminder_occurrences")).rows);
    const seenByB = await t.as(B, async () => (await t.db.query("select id from public.reminder_occurrences")).rows);
    expect(seenByA).toHaveLength(1);
    expect(seenByB).toHaveLength(0);
    await expect(t.as(null, () => t.db.query("select * from public.reminder_occurrences"))).rejects.toThrow(/permission denied/);
    await expect(t.as(A, () => t.db.query("update public.reminder_occurrences set status = 'pending'"))).rejects.toThrow(/permission denied/);
    await expect(
      t.as(A, () =>
        t.db.query(
          `insert into public.reminder_occurrences (user_id, kind, local_date, stage, timezone, scheduled_at, next_attempt_at)
           values ($1, 'morning', '2026-10-28', 'initial', 'UTC', now(), now())`,
          [A],
        ),
      ),
    ).rejects.toThrow(/permission denied/);

    const settingsSeenByB = await t.as(B, async () => (await t.db.query("select user_id from public.reminder_settings")).rows);
    expect(settingsSeenByB).toEqual([{ user_id: B }]);
    // B cannot change A's settings: the update matches no visible row.
    await t.as(B, () => t.db.query("update public.reminder_settings set email_enabled = false, email_enabled_at = null where user_id = $1", [A]));
    expect((await sql("select email_enabled from public.reminder_settings where user_id = $1", [A]))[0]).toEqual({ email_enabled: true });
  });

  it("keeps the dispatch keys and dispatcher internals out of reach of signed-in users", async () => {
    await setUpUser(A, "America/Los_Angeles");
    await expect(t.as(A, () => t.db.query("select * from daykind_private.dispatch_keys"))).rejects.toThrow(/permission denied/);
    await expect(t.as(A, () => t.db.query("select public.reminder_dispatch_users('not-the-key-but-long-enough-0123456789')"))).rejects.toThrow(
      /dispatch key not accepted/,
    );
  });

  it("rejects stale or duplicate settings saves", async () => {
    await setUpUser(A, "America/Los_Angeles");
    const input = { ...DEFAULT_REMINDER_SETTINGS, emailEnabled: true };
    const stale = await t.rpc(A, "save_reminder_settings", reminderSettingsPayload(input, { requestId: uuid(), expectedRevision: null }));
    expect(stale.status).toBe("conflict");
    const request = uuid();
    const [{ revision }] = await sql<{ revision: number }>("select revision from public.reminder_settings where user_id = $1", [A]);
    const first = await t.rpc(A, "save_reminder_settings", reminderSettingsPayload({ ...input, quietStart: "23:00" }, { requestId: request, expectedRevision: revision }));
    const retry = await t.rpc(A, "save_reminder_settings", reminderSettingsPayload({ ...input, quietStart: "23:00" }, { requestId: request, expectedRevision: revision }));
    expect(first.status).toBe("saved");
    expect(retry).toEqual(first);
    const bad = await t.rpc(A, "save_reminder_settings", reminderSettingsPayload({ ...input, quietStart: "08:00", quietEnd: "08:00" }, { requestId: uuid(), expectedRevision: revision + 1 }));
    expect(bad.status).toBe("invalid");
  });

  it("keeps email_enabled_at when delivery stays on and resets it when turned off and on again", async () => {
    await setUpUser(A, "America/Los_Angeles");
    const read = async () => (await sql<{ revision: number; email_enabled_at: Date | null }>("select revision, email_enabled_at from public.reminder_settings where user_id = $1", [A]))[0];
    const base = { ...DEFAULT_REMINDER_SETTINGS };
    let row = await read();
    await t.rpc(A, "save_reminder_settings", reminderSettingsPayload({ ...base, emailEnabled: true, quietEnd: "07:30" }, { requestId: uuid(), expectedRevision: row.revision }));
    const kept = await read();
    expect(kept.email_enabled_at?.toISOString()).toBe("2026-10-27T07:00:00.000Z");
    await t.rpc(A, "save_reminder_settings", reminderSettingsPayload({ ...base, emailEnabled: false }, { requestId: uuid(), expectedRevision: kept.revision }));
    row = await read();
    expect(row.email_enabled_at).toBeNull();
    const before = Date.now();
    await t.rpc(A, "save_reminder_settings", reminderSettingsPayload({ ...base, emailEnabled: true }, { requestId: uuid(), expectedRevision: row.revision }));
    expect((await read()).email_enabled_at!.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });
});
