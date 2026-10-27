import { describe, expect, it } from "vitest";

import {
  DEFAULT_REMINDER_SETTINGS,
  dueSlots,
  followUpsInQuietHours,
  inQuietHours,
  describeDevice,
  occurrenceStatusText,
  slotInstant,
  validatePushSubscription,
  validateReminderSettings,
  type PlanningUser,
  type ReminderOccurrence,
} from "../reminders";

const user = (overrides: Partial<PlanningUser> = {}): PlanningUser => ({
  timezone: "America/Los_Angeles",
  deliveryEnabledAt: "2026-01-01T00:00:00Z",
  morningEnabled: true,
  eveningEnabled: true,
  followUpsEnabled: true,
  ...overrides,
});

const keys = (u: PlanningUser, now: string) =>
  dueSlots(u, new Date(now)).map((s) => `${s.localDate} ${s.kind} ${s.stage}`);

describe("slot times", () => {
  it("keeps the local wall-clock time across daylight saving changes", () => {
    // Los Angeles: PDT (UTC-7) before Nov 1, 2026; PST (UTC-8) after; PDT again from Mar 8, 2026.
    expect(slotInstant("morning", "initial", "2026-10-31", "America/Los_Angeles")).toBe("2026-10-31T17:00:00.000Z");
    expect(slotInstant("morning", "initial", "2026-11-01", "America/Los_Angeles")).toBe("2026-11-01T18:00:00.000Z");
    expect(slotInstant("evening", "follow_up", "2026-11-01", "America/Los_Angeles")).toBe("2026-11-02T06:00:00.000Z");
    expect(slotInstant("morning", "initial", "2026-03-07", "America/Los_Angeles")).toBe("2026-03-07T18:00:00.000Z");
    expect(slotInstant("morning", "initial", "2026-03-08", "America/Los_Angeles")).toBe("2026-03-08T17:00:00.000Z");
  });

  it("handles zones with other offsets and southern-hemisphere DST", () => {
    expect(slotInstant("morning", "initial", "2026-10-27", "Asia/Kolkata")).toBe("2026-10-27T04:30:00.000Z");
    // Sydney moved to AEDT (UTC+11) on Oct 4, 2026.
    expect(slotInstant("evening", "initial", "2026-10-27", "Australia/Sydney")).toBe("2026-10-27T10:00:00.000Z");
    expect(slotInstant("evening", "initial", "2026-10-03", "Australia/Sydney")).toBe("2026-10-03T11:00:00.000Z");
  });
});

describe("dueSlots", () => {
  it("includes only slots at or before now", () => {
    expect(keys(user({ deliveryEnabledAt: "2026-10-27T07:00:00Z" }), "2026-10-27T16:59:59Z")).toEqual([]);
    expect(keys(user({ deliveryEnabledAt: "2026-10-27T07:00:00Z" }), "2026-10-27T17:00:00Z")).toEqual(["2026-10-27 morning initial"]);
    expect(keys(user({ deliveryEnabledAt: "2026-10-27T07:00:00Z" }), "2026-10-28T05:00:00Z")).toEqual([
      "2026-10-27 morning initial",
      "2026-10-27 morning follow_up",
      "2026-10-27 evening initial",
      "2026-10-27 evening follow_up",
    ]);
  });

  it("includes yesterday's slots within the lookback, so late ones are recorded as skipped", () => {
    expect(keys(user(), "2026-10-27T17:30:00Z")).toEqual([
      "2026-10-26 morning follow_up",
      "2026-10-26 evening initial",
      "2026-10-26 evening follow_up",
      "2026-10-27 morning initial",
    ]);
  });

  it("plans nothing before delivery was turned on, or when it is off", () => {
    expect(keys(user({ deliveryEnabledAt: "2026-10-27T17:30:00Z" }), "2026-10-27T18:00:00Z")).toEqual(["2026-10-27 morning follow_up"]);
    expect(keys(user({ deliveryEnabledAt: null }), "2026-10-27T18:00:00Z")).toEqual([]);
  });

  it("leaves out disabled reminders and follow-ups", () => {
    const u = user({ deliveryEnabledAt: "2026-10-27T07:00:00Z", morningEnabled: false, followUpsEnabled: false });
    expect(keys(u, "2026-10-28T05:00:00Z")).toEqual(["2026-10-27 evening initial"]);
  });

  it("uses the check-in date in the user's timezone", () => {
    // 2026-10-27T01:00Z is still Oct 26 in Los Angeles but already Oct 27 in Tokyo.
    const tokyo = user({ timezone: "Asia/Tokyo", deliveryEnabledAt: "2026-10-26T15:00:00Z" });
    expect(dueSlots(tokyo, new Date("2026-10-27T01:00:00Z"))[0]).toMatchObject({
      localDate: "2026-10-27",
      kind: "morning",
      timezone: "Asia/Tokyo",
      scheduledAt: "2026-10-27T01:00:00.000Z",
    });
  });
});

describe("quiet hours", () => {
  it("handles windows that cross midnight", () => {
    expect(inQuietHours("22:00", "22:30", "08:00")).toBe(false);
    expect(inQuietHours("22:30", "22:30", "08:00")).toBe(true);
    expect(inQuietHours("03:00", "22:30", "08:00")).toBe(true);
    expect(inQuietHours("08:00", "22:30", "08:00")).toBe(false);
  });

  it("handles windows within one day", () => {
    expect(inQuietHours("11:00", "10:45", "11:15")).toBe(true);
    expect(inQuietHours("11:15", "10:45", "11:15")).toBe(false);
  });

  it("names the follow-ups the window would skip", () => {
    expect(followUpsInQuietHours(DEFAULT_REMINDER_SETTINGS)).toEqual([]);
    expect(followUpsInQuietHours({ quietHoursEnabled: true, quietStart: "21:30", quietEnd: "11:30" })).toEqual(["morning", "evening"]);
    expect(followUpsInQuietHours({ quietHoursEnabled: false, quietStart: "21:30", quietEnd: "11:30" })).toEqual([]);
  });
});

describe("validateReminderSettings", () => {
  it("reads checkboxes and times", () => {
    const r = validateReminderSettings({
      deliveryEnabled: "on",
      channel: "push",
      eveningEnabled: "on",
      quietHoursEnabled: "on",
      quietStart: "22:30",
      quietEnd: "08:00",
    });
    expect(r).toEqual({
      ok: true,
      value: {
        deliveryEnabled: true,
        channel: "push",
        morningEnabled: false,
        eveningEnabled: true,
        followUpsEnabled: false,
        quietHoursEnabled: true,
        quietStart: "22:30",
        quietEnd: "08:00",
      },
    });
  });

  it("rejects malformed or equal times and an unknown channel", () => {
    expect(validateReminderSettings({ channel: "sms", quietStart: "25:00", quietEnd: "8:00" })).toMatchObject({
      ok: false,
      errors: { channel: expect.any(String), quietStart: expect.any(String), quietEnd: expect.any(String) },
    });
    expect(validateReminderSettings({ channel: "email", quietStart: "08:00", quietEnd: "08:00" })).toMatchObject({
      ok: false,
      errors: { quietEnd: "Quiet hours need different start and end times." },
    });
  });
});

describe("status text", () => {
  const base: ReminderOccurrence = {
    id: "x",
    kind: "morning",
    stage: "initial",
    channel: "email",
    localDate: "2026-10-27",
    timezone: "UTC",
    scheduledAt: "2026-10-27T10:00:00Z",
    status: "sent",
    statusReason: null,
    attempts: 1,
    sentAt: "2026-10-27T10:00:05Z",
  };

  it("never claims more than acceptance by the mail service", () => {
    expect(occurrenceStatusText(base)).toBe("Accepted by the mail service");
    expect(occurrenceStatusText({ ...base, status: "suppressed", statusReason: "completed" })).toBe(
      "Not sent: the check-in was already done",
    );
    expect(occurrenceStatusText({ ...base, status: "pending", attempts: 2 })).toBe("Retrying soon");
    expect(occurrenceStatusText({ ...base, channel: "push" })).toBe("Accepted by the push service");
  });
});

describe("browser subscriptions", () => {
  const json = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: "BNcR-_x", auth: "tBHI_tJ" } };

  it("accepts a PushSubscription's JSON and cleans the label", () => {
    expect(validatePushSubscription(json, "Chrome on <b>Android</b>")).toEqual({
      endpoint: json.endpoint,
      p256dh: "BNcR-_x",
      auth: "tBHI_tJ",
      deviceLabel: "Chrome on bAndroid/b",
    });
  });

  it("rejects anything else", () => {
    expect(validatePushSubscription(null, null)).toBeNull();
    expect(validatePushSubscription({ ...json, endpoint: "http://push.example.test/x" }, null)).toBeNull();
    expect(validatePushSubscription({ ...json, endpoint: "not a url" }, null)).toBeNull();
    expect(validatePushSubscription({ ...json, keys: { p256dh: "a b", auth: "x" } }, null)).toBeNull();
    expect(validatePushSubscription({ endpoint: json.endpoint }, null)).toBeNull();
  });

  it("names common browsers", () => {
    expect(describeDevice("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36")).toBe(
      "Chrome on Android",
    );
    expect(describeDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15")).toBe(
      "Safari on macOS",
    );
    expect(describeDevice("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0")).toBe("Edge on Windows");
    expect(describeDevice("")).toBe("Browser on this device");
  });
});
