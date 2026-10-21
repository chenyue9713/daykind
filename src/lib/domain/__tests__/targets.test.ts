import { describe, expect, it } from "vitest";

import { computeWeeklyProgress } from "../targets";
import { activity, evening, goals } from "./fixtures";

const week = { start: "2026-10-12", end: "2026-10-18" };

describe("weekly targets (AC04–AC06)", () => {
  it("accumulates two five-minute walks into a qualifying day", () => {
    const p = computeWeeklyProgress(week, goals, [
      activity({ type: "walking", localDate: "2026-10-13", elapsedSeconds: 300 }),
      activity({ type: "walking", localDate: "2026-10-13", elapsedSeconds: 300 }),
    ], []);
    expect(p.walkingDays[1]).toMatchObject({ seconds: 600, qualified: true });
  });

  it("counts a 70-minute Sunday walk for Sunday only", () => {
    const p = computeWeeklyProgress(week, goals, [
      activity({ type: "walking", localDate: "2026-10-18", elapsedSeconds: 4200 }),
    ], []);
    expect(p.walkingQualifiedDays).toBe(1);
    expect(p.walkingDays[6].qualified).toBe(true);
  });

  it("does not round 599 seconds into completion", () => {
    const p = computeWeeklyProgress(week, goals, [
      activity({ type: "walking", localDate: "2026-10-14", elapsedSeconds: 599 }),
    ], []);
    expect(p.walkingDays[2].qualified).toBe(false);
  });

  it("meets resistance and cycling targets, excluding paused time", () => {
    const p = computeWeeklyProgress(week, goals, [
      activity({ type: "resistance", localDate: "2026-10-13" }),
      activity({ type: "resistance", localDate: "2026-10-16" }),
      activity({ type: "cycling", localDate: "2026-10-14", elapsedSeconds: 1800, activeSeconds: 1500 }),
      activity({ type: "cycling", localDate: "2026-10-17", elapsedSeconds: 2400, activeSeconds: 2100 }),
    ], []);
    expect(p.resistanceSessions).toBe(2);
    expect(p.cyclingSeconds).toBe(3600);
  });

  it("keeps a Sunday ride out of the following week", () => {
    const ride = activity({ type: "cycling", localDate: "2026-10-18", elapsedSeconds: 56 * 60 });
    expect(computeWeeklyProgress(week, goals, [ride], []).cyclingSeconds).toBe(56 * 60);
    const next = { start: "2026-10-19", end: "2026-10-25" };
    expect(computeWeeklyProgress(next, goals, [ride], []).cyclingSeconds).toBe(0);
  });

  it("ignores non-canonical activities", () => {
    const p = computeWeeklyProgress(week, goals, [
      activity({ type: "cycling", localDate: "2026-10-14", elapsedSeconds: 1800, canonicalStatus: "linked" }),
      activity({ type: "cycling", localDate: "2026-10-14", elapsedSeconds: 1800, canonicalStatus: "deleted" }),
    ], []);
    expect(p.cyclingSeconds).toBe(0);
  });

  it("distinguishes confirmed no-activity days from unknown days", () => {
    const p = computeWeeklyProgress(week, goals, [], [
      evening({ localDate: "2026-10-12", activityStatus: "confirmed_none" }),
    ]);
    expect(p.walkingDays[0].unknown).toBe(false);
    expect(p.unknownActivityDays).toBe(6);
  });
});
