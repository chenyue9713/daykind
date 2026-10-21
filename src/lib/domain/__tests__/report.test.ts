import { describe, expect, it } from "vitest";

import { buildWeeklyReport } from "../report";
import { activity, evening, goals, sleep } from "./fixtures";

const range = { start: "2026-10-12", end: "2026-10-18" };

describe("weekly report (AC13)", () => {
  it("reports sleep n=3 and leaves unreviewed days unknown", () => {
    const report = buildWeeklyReport({
      range,
      goals,
      sleep: [
        sleep({ wakingDate: "2026-10-12" }),
        sleep({ wakingDate: "2026-10-13" }),
        sleep({ wakingDate: "2026-10-14" }),
      ],
      evening: ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"].map((d) =>
        evening({ localDate: d, activityStatus: "confirmed_none" }),
      ),
      activities: [],
      symptoms: [],
      weights: [],
    });
    expect(report.sleep.sampleCount).toBe(3);
    expect(report.coverage.morningComplete).toBe(3);
    expect(report.coverage.knownActivityDays).toBe(5);
    expect(report.progress.unknownActivityDays).toBe(2);
    expect(report.targetStatus.walking).toBe("incomplete");
  });

  it("keeps an achieved target achieved despite unrelated missing days", () => {
    const report = buildWeeklyReport({
      range,
      goals,
      sleep: [],
      evening: [],
      activities: [
        activity({ type: "resistance", localDate: "2026-10-13" }),
        activity({ type: "resistance", localDate: "2026-10-15" }),
      ],
      symptoms: [],
      weights: [],
    });
    expect(report.targetStatus.resistance).toBe("achieved");
    expect(report.targetStatus.cycling).toBe("incomplete");
  });

  it("produces an honest empty report for a zero-data week", () => {
    const report = buildWeeklyReport({ range, goals, sleep: [], evening: [], activities: [], symptoms: [], weights: [] });
    expect(report.sleep.averageSeconds).toBeNull();
    expect(report.coverage.knownActivityDays).toBe(0);
    expect(report.focusSuggestion).toMatch(/logging one morning check-in/);
  });

  it("marks averages that include ranges as estimates", () => {
    const report = buildWeeklyReport({
      range,
      goals,
      sleep: [sleep({ wakingDate: "2026-10-12", durationMinSeconds: 450 * 60, durationMaxSeconds: 480 * 60, approximate: true })],
      evening: [],
      activities: [],
      symptoms: [],
      weights: [],
    });
    expect(report.sleep.averageSeconds).toBe(465 * 60);
    expect(report.sleep.includesEstimates).toBe(true);
  });
});
