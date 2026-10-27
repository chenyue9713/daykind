// Message content, the Resend client, scheduler authorization, and
// configuration. No network: fetch is replaced.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { isAuthorizedDispatch } from "../auth";
import { reminderEnv } from "../config";
import { createResendSender, type OutgoingEmail } from "../email";
import { reminderMessage } from "../messages";

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
  const complete = {
    DAYKIND_DATA_SOURCE: "supabase",
    DAYKIND_APP_URL: "https://daykind.example.test/",
    REMINDER_DISPATCH_SECRET: "k".repeat(43),
    RESEND_API_KEY: "re_x",
    REMINDER_EMAIL_FROM: "DayKind <r@example.test>",
  };

  it("is configured only with every value present", () => {
    expect(reminderEnv(complete)).toEqual({
      configured: true,
      env: {
        appUrl: "https://daykind.example.test",
        dispatchSecret: "k".repeat(43),
        resendApiKey: "re_x",
        emailFrom: "DayKind <r@example.test>",
      },
    });
    expect(reminderEnv({ ...complete, RESEND_API_KEY: "" })).toEqual({ configured: false, missing: ["RESEND_API_KEY"] });
  });

  it("refuses a short secret, a bad URL, and sample mode", () => {
    const r = reminderEnv({ ...complete, REMINDER_DISPATCH_SECRET: "short", DAYKIND_APP_URL: "daykind", DAYKIND_DATA_SOURCE: "sample" });
    expect(r.configured).toBe(false);
    expect(!r.configured && r.missing).toEqual([
      "REMINDER_DISPATCH_SECRET (at least 32 characters)",
      "DAYKIND_APP_URL (an http(s) URL)",
      "DAYKIND_DATA_SOURCE=supabase",
    ]);
  });
});
