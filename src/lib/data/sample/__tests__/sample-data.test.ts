import { describe, expect, it } from "vitest";

import { buildSampleDataset } from "../sample-data";

describe("sample dataset", () => {
  const data = buildSampleDataset("sample-user", "America/Los_Angeles", "2026-10-20");

  it("labels every record as sample data", () => {
    const records = [...data.sleep, ...data.evening, ...data.symptoms, ...data.activities, ...data.weights];
    expect(records.length).toBeGreaterThan(0);
    expect(records.every((r) => r.source === "sample")).toBe(true);
  });

  it("respects the data model invariants", () => {
    for (const s of data.sleep) {
      if (s.totalInterruptions !== null && s.babyInterruptions !== null) {
        expect(s.babyInterruptions).toBeLessThanOrEqual(s.totalInterruptions);
      }
      expect(s.durationMinSeconds!).toBeLessThanOrEqual(s.durationMaxSeconds!);
    }
    expect(new Set(data.sleep.map((s) => s.wakingDate)).size).toBe(data.sleep.length);
    expect(new Set(data.evening.map((e) => e.localDate)).size).toBe(data.evening.length);
  });

  it("leaves today's evening check-in due", () => {
    expect(data.evening.some((e) => e.localDate === "2026-10-20")).toBe(false);
    expect(data.sleep.some((s) => s.wakingDate === "2026-10-20")).toBe(true);
  });
});
