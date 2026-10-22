import { describe, expect, it } from "vitest";

import { goalSecondsOf, isSuspectedDuplicate, measuredDurationBasis, validateActivityDraft, type ActivityDraft } from "../activity";
import { activity } from "./fixtures";

const draft = (overrides: Partial<ActivityDraft> = {}): ActivityDraft => ({
  type: "cycling",
  startedAt: "2026-10-19T01:40:00.000Z",
  localDate: "2026-10-18",
  timezone: "America/Los_Angeles",
  elapsedSeconds: 3480,
  activeSeconds: 3360,
  reportedSeconds: null,
  durationBasis: "active",
  distanceMeters: 21500,
  avgHeartRateBpm: null,
  maxHeartRateBpm: null,
  intensity: "unknown",
  note: null,
  fieldProvenance: {},
  ...overrides,
});

describe("goal duration basis", () => {
  it("uses timer time when measured, elapsed as fallback, and reported for manual entries", () => {
    expect(measuredDurationBasis(1500)).toBe("active");
    expect(measuredDurationBasis(null)).toBe("elapsed");
    expect(goalSecondsOf({ durationBasis: "active", activeSeconds: 1500, elapsedSeconds: 1800, reportedSeconds: null })).toBe(1500);
    expect(goalSecondsOf({ durationBasis: "elapsed", activeSeconds: null, elapsedSeconds: 1800, reportedSeconds: null })).toBe(1800);
    expect(goalSecondsOf({ durationBasis: "reported", activeSeconds: null, elapsedSeconds: null, reportedSeconds: 900 })).toBe(900);
  });
});

describe("validateActivityDraft", () => {
  it("accepts a cross-midnight ride on its local start date", () => {
    expect(validateActivityDraft(draft({ startedAt: "2026-10-19T06:50:00.000Z", localDate: "2026-10-18" }))).toEqual({});
  });

  it("rejects a local date that is not the start's local date", () => {
    expect(validateActivityDraft(draft({ localDate: "2026-10-19" })).localDate).toBeDefined();
  });

  it("requires the field named by the duration basis", () => {
    expect(validateActivityDraft(draft({ activeSeconds: null })).activeSeconds).toBeDefined();
  });

  it("never accepts invented or impossible values", () => {
    expect(validateActivityDraft(draft({ activeSeconds: 4000 })).activeSeconds).toBeDefined();
    expect(validateActivityDraft(draft({ avgHeartRateBpm: 300 })).avgHeartRateBpm).toBeDefined();
    expect(validateActivityDraft(draft({ avgHeartRateBpm: 150, maxHeartRateBpm: 140 })).avgHeartRateBpm).toBeDefined();
    expect(validateActivityDraft(draft({ timezone: "Not/AZone" })).timezone).toBeDefined();
  });

  it("accepts fixed-offset Etc zones", () => {
    expect(validateActivityDraft(draft({ timezone: "Etc/GMT+8", startedAt: "2026-10-19T07:30:00.000Z" }))).toEqual({});
  });
});

describe("isSuspectedDuplicate (AC08)", () => {
  const existing = activity({
    type: "cycling",
    localDate: "2026-10-18",
    startedAt: "2026-10-19T01:40:00.000Z",
    elapsedSeconds: 3600,
  });

  it("matches the same type within ±2 minutes and ±10 percent", () => {
    const probe = { type: "cycling" as const, startedAt: "2026-10-19T01:41:59.000Z", localDate: "2026-10-18", goalSeconds: 3300 };
    expect(isSuspectedDuplicate(probe, existing)).toBe(true);
  });

  it("does not match outside the window, a different type, or a linked record", () => {
    const base = { type: "cycling" as const, startedAt: "2026-10-19T01:40:00.000Z", localDate: "2026-10-18", goalSeconds: 3600 };
    expect(isSuspectedDuplicate({ ...base, startedAt: "2026-10-19T01:42:01.000Z" }, existing)).toBe(false);
    expect(isSuspectedDuplicate({ ...base, goalSeconds: 3200 }, existing)).toBe(false);
    expect(isSuspectedDuplicate({ ...base, type: "walking" }, existing)).toBe(false);
    expect(isSuspectedDuplicate(base, { ...existing, canonicalStatus: "linked" })).toBe(false);
  });

  it("matches a manual entry without a start time on the same local date", () => {
    const manual = { ...existing, startedAt: null };
    const probe = { type: "cycling" as const, startedAt: "2026-10-19T01:40:00.000Z", localDate: "2026-10-18", goalSeconds: 3600 };
    expect(isSuspectedDuplicate(probe, manual)).toBe(true);
    expect(isSuspectedDuplicate({ ...probe, localDate: "2026-10-19" }, manual)).toBe(false);
  });
});
