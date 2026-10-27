// Message content, the Resend and Web Push clients, scheduler authorization,
// and configuration. No network: fetch and the push request are replaced.
import { createECDH, randomBytes } from "node:crypto";

import { describe, expect, it, vi } from "vitest";
import webpush from "web-push";

vi.mock("server-only", () => ({}));

import { isAuthorizedDispatch } from "../auth";
import { reminderEnv } from "../config";
import { createResendSender, type OutgoingEmail } from "../email";
import { reminderMessage, reminderPushPayload } from "../messages";
import { createWebPushSender } from "../push";

const APP = "https://daykind.example.test";

describe("reminderMessage", () => {
  it("links to the check-in for that date, behind sign-in, with no token", () => {
    const m = reminderMessage({ kind: "morning", stage: "initial", localDate: "2026-10-27", appUrl: APP });
    expect(m.subject).toBe("Your DayKind morning check-in is ready");
    expect(m.link).toBe(`${APP}/check-in/morning?date=2026-10-27`);
    expect(m.text).toContain(m.link);
    expect(m.text).toContain(`${APP}/settings#reminders-heading`);
    expect(m.link).not.toMatch(/token|code|auth/i);
  });

  it("uses generic wording without health details", () => {
    for (const kind of ["morning", "evening", "test"] as const) {
      for (const stage of ["initial", "follow_up"] as const) {
        const m = reminderMessage({ kind, stage, localDate: "2026-10-27", appUrl: APP });
        const all = `${m.subject}\n${m.text}\n${m.html}`.toLowerCase();
        for (const word of ["sleep", "pain", "ankle", "gout", "fatigue", "tired", "weight", "symptom", "hours"]) {
          expect(all).not.toContain(word);
        }
      }
    }
  });

  it("says a follow-up is the only one", () => {
    const m = reminderMessage({ kind: "evening", stage: "follow_up", localDate: "2026-10-27", appUrl: APP });
    expect(m.subject).toBe("Reminder: your DayKind evening check-in is still open");
    expect(m.text).toContain("This is the only follow-up.");
  });

  it("escapes HTML", () => {
    const m = reminderMessage({ kind: "test", stage: "initial", localDate: "2026-10-27", appUrl: 'https://x.test/"><script>' });
    expect(m.html).not.toContain("<script>");
  });
});

describe("createResendSender", () => {
  const email: OutgoingEmail = { to: "me@example.test", subject: "S", text: "T", html: "<p>T</p>", idempotencyKey: "occ-1" };

  function senderReturning(response: Response | Error) {
    const fetchImpl = vi.fn(async () => {
      if (response instanceof Error) throw response;
      return response;
    });
    return { fetchImpl, sender: createResendSender({ apiKey: "re_test", from: "DayKind <r@example.test>", fetchImpl }) };
  }

  it("sends with the API key and the occurrence id as idempotency key", async () => {
    const { fetchImpl, sender } = senderReturning(Response.json({ id: "abc" }));
    expect(await sender.send(email)).toEqual({ outcome: "sent", messageId: "abc" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers).toMatchObject({ Authorization: "Bearer re_test", "Idempotency-Key": "occ-1" });
    expect(JSON.parse(String(init.body))).toEqual({
      from: "DayKind <r@example.test>",
      to: ["me@example.test"],
      subject: "S",
      text: "T",
      html: "<p>T</p>",
    });
  });

  it("classifies failures", async () => {
    const cases: [Response | Error, string, string][] = [
      [Response.json({ name: "rate_limit_exceeded" }, { status: 429 }), "transient", "http_429_rate_limit_exceeded"],
      [new Response("oops", { status: 502 }), "transient", "http_502"],
      [Response.json({ name: "concurrent_idempotent_requests" }, { status: 409 }), "transient", "http_409_concurrent_idempotent_requests"],
      [Response.json({ name: "invalid_idempotent_request" }, { status: 409 }), "permanent", "http_409_invalid_idempotent_request"],
      [Response.json({ name: "validation_error" }, { status: 422 }), "permanent", "http_422_validation_error"],
      [Response.json({ name: "invalid_api_key" }, { status: 403 }), "permanent", "http_403_invalid_api_key"],
      [new TypeError("fetch failed"), "transient", "network"],
      [Object.assign(new Error("timed out"), { name: "TimeoutError" }), "transient", "timeout"],
    ];
    for (const [response, outcome, code] of cases) {
      expect(await senderReturning(response).sender.send(email)).toEqual({ outcome, code });
    }
  });
});

describe("isAuthorizedDispatch", () => {
  const secret = "s".repeat(40);
  it("accepts only the exact bearer secret", () => {
    expect(isAuthorizedDispatch(`Bearer ${secret}`, secret)).toBe(true);
    expect(isAuthorizedDispatch(`Bearer ${secret}x`, secret)).toBe(false);
    expect(isAuthorizedDispatch(secret, secret)).toBe(false);
    expect(isAuthorizedDispatch(null, secret)).toBe(false);
    expect(isAuthorizedDispatch("Bearer ", "")).toBe(false);
  });
});

describe("reminderEnv", () => {
  const core = {
    DAYKIND_DATA_SOURCE: "supabase",
    DAYKIND_APP_URL: "https://daykind.example.test/",
    REMINDER_DISPATCH_SECRET: "k".repeat(43),
  };
  const email = { RESEND_API_KEY: "re_x", REMINDER_EMAIL_FROM: "DayKind <r@example.test>" };
  const push = { VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv", VAPID_SUBJECT: "mailto:me@example.test" };

  it("enables each fully configured channel", () => {
    expect(reminderEnv({ ...core, ...email })).toEqual({
      configured: true,
      channels: ["email"],
      env: {
        appUrl: "https://daykind.example.test",
        dispatchSecret: "k".repeat(43),
        email: { resendApiKey: "re_x", emailFrom: "DayKind <r@example.test>" },
        push: null,
      },
    });
    expect(reminderEnv({ ...core, ...push })).toMatchObject({ configured: true, channels: ["push"] });
    expect(reminderEnv({ ...core, ...email, ...push })).toMatchObject({ configured: true, channels: ["email", "push"] });
  });

  it("reports a channel that is only partly set, and no channel at all", () => {
    expect(reminderEnv({ ...core, ...email, VAPID_PUBLIC_KEY: "pub" })).toMatchObject({
      configured: false,
      missing: ["VAPID_PRIVATE_KEY", "VAPID_SUBJECT"],
    });
    expect(reminderEnv({ ...core, ...push, VAPID_SUBJECT: "me@example.test" })).toMatchObject({
      configured: false,
      missing: ["VAPID_SUBJECT (mailto: or https: URL)", "RESEND_API_KEY and REMINDER_EMAIL_FROM, or the VAPID_* keys"],
    });
    expect(reminderEnv(core)).toMatchObject({ configured: false, channels: [] });
  });

  it("refuses a short secret, a bad URL, and sample mode", () => {
    const r = reminderEnv({ ...core, ...email, REMINDER_DISPATCH_SECRET: "short", DAYKIND_APP_URL: "daykind", DAYKIND_DATA_SOURCE: "sample" });
    expect(r.configured).toBe(false);
    expect(!r.configured && r.missing).toEqual([
      "REMINDER_DISPATCH_SECRET (at least 32 characters)",
      "DAYKIND_APP_URL (an http(s) URL)",
      "DAYKIND_DATA_SOURCE=supabase",
    ]);
  });
});

describe("reminderPushPayload", () => {
  it("is generic, same-site, and replaces the day's earlier notification", () => {
    const first = reminderPushPayload({ kind: "evening", stage: "initial", localDate: "2026-10-27", appUrl: APP });
    const followUp = reminderPushPayload({ kind: "evening", stage: "follow_up", localDate: "2026-10-27", appUrl: APP });
    expect(first).toEqual({
      title: "DayKind: evening check-in is ready",
      body: "For Tue, Oct 27. Tap to open it in DayKind.",
      url: `${APP}/check-in/evening?date=2026-10-27`,
      tag: "daykind-evening-2026-10-27",
    });
    expect(followUp.title).toBe("DayKind: evening check-in is still open");
    expect(followUp.tag).toBe(first.tag);
    for (const word of ["sleep", "pain", "ankle", "fatigue", "weight", "symptom"]) {
      expect(JSON.stringify([first, followUp]).toLowerCase()).not.toContain(word);
    }
  });
});

describe("createWebPushSender", () => {
  const vapid = webpush.generateVAPIDKeys();
  // A real P-256 browser key pair, so web-push can encrypt the payload.
  const browser = createECDH("prime256v1");
  browser.generateKeys();
  const target = {
    endpoint: "https://push.example.test/send/abc",
    p256dh: browser.getPublicKey().toString("base64url"),
    auth: randomBytes(16).toString("base64url"),
  };
  const payload = { title: "DayKind test notification", body: "b", url: `${APP}/`, tag: "daykind-test" };
  const id = "6f1c2a8e-1b2c-4d3e-8f90-1234567890ab";

  it("builds an encrypted, VAPID-signed request with TTL, urgency, and the occurrence topic", async () => {
    let captured: { options?: webpush.RequestOptions } = {};
    const sendNotification = vi.fn(async (sub: webpush.PushSubscription, body?: string | Buffer | null, options?: webpush.RequestOptions) => {
      captured = { options };
      const details = webpush.generateRequestDetails(sub, body as string, options);
      expect(details.endpoint).toBe(target.endpoint);
      expect(details.headers).toMatchObject({
        TTL: 7200,
        Urgency: "normal",
        Topic: "6f1c2a8e1b2c4d3e8f901234567890ab",
        "Content-Encoding": "aes128gcm",
      });
      expect(String(details.headers.Authorization)).toMatch(/^vapid t=.+, k=/);
      // The body is ciphertext: the title must not appear in it.
      expect(Buffer.from(details.body as Buffer).toString("latin1")).not.toContain("DayKind");
      return { statusCode: 201, body: "", headers: {} };
    });
    const sender = createWebPushSender({
      publicKey: vapid.publicKey,
      privateKey: vapid.privateKey,
      subject: "mailto:me@example.test",
      sendNotification,
    });
    expect(await sender.send(target, payload, id)).toEqual({ outcome: "sent", messageId: "push_201" });
    expect(captured.options?.timeout).toBe(10_000);
  });

  it("classifies push service responses", async () => {
    const cases: [unknown, string, string][] = [
      [{ statusCode: 410 }, "gone", "http_410"],
      [{ statusCode: 404 }, "gone", "http_404"],
      [{ statusCode: 429 }, "transient", "http_429"],
      [{ statusCode: 503 }, "transient", "http_503"],
      [{ statusCode: 403 }, "permanent", "http_403"],
      [{ statusCode: 413 }, "permanent", "http_413"],
      [new Error("ECONNRESET"), "transient", "network"],
    ];
    for (const [error, outcome, code] of cases) {
      const sender = createWebPushSender({
        publicKey: vapid.publicKey,
        privateKey: vapid.privateKey,
        subject: "mailto:me@example.test",
        sendNotification: async () => {
          throw error;
        },
      });
      expect(await sender.send(target, payload, id)).toEqual({ outcome, code });
    }
  });
});
