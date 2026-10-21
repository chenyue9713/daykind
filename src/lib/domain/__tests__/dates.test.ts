import { describe, expect, it } from "vitest";

import { addDays, localDateOf, previousWeekRange, weekStart, zonedTimeToInstant } from "../dates";

describe("civil dates", () => {
  it("starts weeks on Monday", () => {
    expect(weekStart("2026-10-20")).toBe("2026-10-19"); // Tuesday → Monday
    expect(weekStart("2026-10-25")).toBe("2026-10-19"); // Sunday stays in the same week
    expect(weekStart("2026-10-26")).toBe("2026-10-26");
  });

  it("returns the last completed Monday–Sunday week", () => {
    expect(previousWeekRange("2026-10-26")).toEqual({ start: "2026-10-19", end: "2026-10-25" });
    expect(previousWeekRange("2026-10-25")).toEqual({ start: "2026-10-12", end: "2026-10-18" });
  });

  it("does not drift across the November DST change", () => {
    expect(addDays("2026-10-31", 2)).toBe("2026-11-02");
    const tz = "America/Los_Angeles";
    // 10 AM local before and after the fall-back transition on 2026-11-01.
    expect(zonedTimeToInstant("2026-10-31", "10:00", tz)).toBe("2026-10-31T17:00:00.000Z");
    expect(zonedTimeToInstant("2026-11-02", "10:00", tz)).toBe("2026-11-02T18:00:00.000Z");
  });

  it("assigns an instant to its local date", () => {
    // 11:30 PM Sunday in Los Angeles is already Monday in UTC.
    expect(localDateOf("2026-10-26T06:30:00.000Z", "America/Los_Angeles")).toBe("2026-10-25");
  });
});
