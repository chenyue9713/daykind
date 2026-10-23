import { describe, expect, it } from "vitest";

import { localDateOf } from "../dates";
import {
  canonicalTimezone,
  isValidTimezone,
  nextMonday,
  sameTargets,
  sameTimezone,
  targetSchedule,
  timezoneOptions,
  validateOnboarding,
  validatePreferences,
  validateTargets,
} from "../preferences";
import { DEFAULT_GOALS, goalsForWeek } from "../targets";
import type { GoalVersion } from "../types";

const version = (effectiveFrom: string, walkingMinutes: number, id = effectiveFrom): GoalVersion => ({
  id,
  effectiveFrom,
  walkingSecondsPerDay: walkingMinutes * 60,
  resistanceSessionsPerWeek: 2,
  cyclingSecondsPerWeek: 3600,
  revision: 1,
});

describe("timezone validation", () => {
  it("accepts IANA names, UTC, and Etc offsets", () => {
    for (const tz of ["America/Los_Angeles", "Europe/London", "UTC", "Etc/GMT+8", "America/Argentina/Buenos_Aires"]) {
      expect(isValidTimezone(tz), tz).toBe(true);
    }
  });

  it("rejects unknown zones, raw offsets, and malformed input", () => {
    for (const tz of ["Mars/Olympus", "+05:00", "", "America/../etc", "America/Los Angeles", "x".repeat(65)]) {
      expect(isValidTimezone(tz), tz).toBe(false);
    }
  });

  it("canonicalizes a valid zone and returns null otherwise", () => {
    expect(canonicalTimezone("America/Los_Angeles")).toBe("America/Los_Angeles");
    expect(canonicalTimezone("Not/AZone")).toBeNull();
    expect(canonicalTimezone(undefined)).toBeNull();
  });

  it("compares zones by meaning, not spelling, and keeps the chosen spelling", () => {
    expect(sameTimezone("Asia/Kolkata", "Asia/Calcutta")).toBe(true);
    expect(sameTimezone("America/Los_Angeles", "America/New_York")).toBe(false);
    const r = validatePreferences({ timezone: "Asia/Calcutta", distanceUnit: "km", weightUnit: "kg" });
    expect(r.ok && r.value.timezone).toBe("Asia/Calcutta");
  });

  it("offers a sorted list that always contains the saved zone", () => {
    const options = timezoneOptions("Etc/GMT+8");
    expect(options).toContain("Etc/GMT+8");
    expect(options).toContain("America/Los_Angeles");
    expect([...options].sort()).toEqual(options);
  });
});

describe("next-Monday scheduling", () => {
  it("starts changes on the Monday after today", () => {
    expect(nextMonday("2026-10-21")).toBe("2026-10-26"); // Wednesday
    expect(nextMonday("2026-10-25")).toBe("2026-10-26"); // Sunday
    expect(nextMonday("2026-10-26")).toBe("2026-11-02"); // Monday: not this week
    expect(nextMonday("2026-12-31")).toBe("2027-01-04"); // across the year end
  });

  it("depends on the confirmed timezone's date", () => {
    const instant = "2026-10-26T05:30:00.000Z"; // Sunday 10:30 PM in Los Angeles, Monday 2:30 PM in Tokyo
    expect(nextMonday(localDateOf(instant, "America/Los_Angeles"))).toBe("2026-10-26");
    expect(nextMonday(localDateOf(instant, "Asia/Tokyo"))).toBe("2026-11-02");
  });

  it("keeps the targets in effect, the pending change, and past versions apart", () => {
    const versions = [
      { ...DEFAULT_GOALS, id: "baseline" },
      version("2026-10-19", 15),
      version("2026-10-26", 20),
    ];
    const midweek = targetSchedule(versions, "2026-10-22");
    expect(midweek.current.id).toBe("2026-10-19");
    expect(midweek.pending?.id).toBe("2026-10-26");
    expect(midweek.nextMonday).toBe("2026-10-26");

    const monday = targetSchedule(versions, "2026-10-26");
    expect(monday.current.id).toBe("2026-10-26");
    expect(monday.pending).toBeNull();

    // Earlier weeks keep the targets that applied then.
    expect(goalsForWeek(versions, "2026-10-12")?.id).toBe("baseline");
    expect(goalsForWeek(versions, "2026-10-19")?.walkingSecondsPerDay).toBe(900);
  });

  it("falls back to the defaults when nothing was saved", () => {
    expect(targetSchedule([], "2026-10-22")).toMatchObject({ current: DEFAULT_GOALS, pending: null });
  });
});

describe("preference validation", () => {
  it("parses timezone, units, and optional weight tracking", () => {
    expect(validatePreferences({ timezone: "Europe/Berlin", distanceUnit: "km", weightUnit: "kg", weightTracking: "on" })).toEqual({
      ok: true,
      value: { timezone: "Europe/Berlin", distanceUnit: "km", weightUnit: "kg", weightTrackingEnabled: true },
    });
    const skipped = validatePreferences({ timezone: "America/Los_Angeles", distanceUnit: "mi", weightUnit: "lb" });
    expect(skipped.ok && skipped.value.weightTrackingEnabled).toBe(false);
  });

  it("reports each invalid field", () => {
    const r = validatePreferences({ timezone: "Mars/Olympus", distanceUnit: "furlong", weightUnit: "stone" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["distanceUnit", "timezone", "weightUnit"]);
  });

  it("converts the default targets to stored units", () => {
    const r = validateTargets({ walkingMinutes: "10", resistanceSessions: "2", cyclingMinutes: "60" });
    expect(r).toEqual({ ok: true, value: { walkingSecondsPerDay: 600, resistanceSessionsPerWeek: 2, cyclingSecondsPerWeek: 3600 } });
    expect(r.ok && sameTargets(r.value, DEFAULT_GOALS)).toBe(true);
  });

  it("rejects targets outside the allowed ranges or not whole numbers", () => {
    const r = validateTargets({ walkingMinutes: "0", resistanceSessions: "1.5", cyclingMinutes: "1201" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["cyclingMinutes", "resistanceSessions", "walkingMinutes"]);
    expect(validateTargets({ walkingMinutes: "5", resistanceSessions: "0", cyclingMinutes: "0" }).ok).toBe(true);
  });

  it("requires the guidance acknowledgment to finish setup", () => {
    const raw = {
      timezone: "America/Los_Angeles",
      distanceUnit: "mi",
      weightUnit: "lb",
      walkingMinutes: "10",
      resistanceSessions: "2",
      cyclingMinutes: "60",
    };
    const missing = validateOnboarding(raw);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors.acknowledgeGuidance).toBeTruthy();
    expect(validateOnboarding({ ...raw, acknowledgeGuidance: "on" }).ok).toBe(true);
  });
});
