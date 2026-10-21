import { describe, expect, it } from "vitest";

import { distanceFromMeters, metersFromDistance, parseActivityForm } from "../activity-form";
import { activity } from "./fixtures";

const ctx = { existing: null, timezone: "America/Los_Angeles", today: "2026-11-02", distanceUnit: "mi" as const };

describe("manual activity form", () => {
  it("stores reported minutes and a start instant in the profile timezone", () => {
    const r = parseActivityForm(
      { type: "walking", localDate: "2026-11-02", startTime: "10:00", durationMinutes: "15", intensity: "easy", distance: "1" },
      ctx,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // After the fall-back DST change, 10 AM in Los Angeles is 18:00 UTC.
    expect(r.value.startedAt).toBe("2026-11-02T18:00:00.000Z");
    expect(r.value).toMatchObject({
      localDate: "2026-11-02",
      timezone: "America/Los_Angeles",
      reportedSeconds: 900,
      durationBasis: "reported",
      elapsedSeconds: null,
      activeSeconds: null,
      distanceMeters: 1609.34,
    });
    expect(r.value.fieldProvenance.reportedSeconds).toEqual({ source: "manual", kind: "reported" });
  });

  it("keeps an unknown start time as null", () => {
    const r = parseActivityForm({ type: "resistance", localDate: "2026-11-01", durationMinutes: "20" }, ctx);
    expect(r.ok && r.value.startedAt).toBeNull();
    expect(r.ok && r.value.intensity).toBe("unknown");
  });

  it("rejects future dates and missing durations", () => {
    const r = parseActivityForm({ type: "walking", localDate: "2026-11-03", durationMinutes: "" }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["durationMinutes", "localDate"]);
  });

  it("keeps an edited activity in the timezone it was entered in", () => {
    const existing = activity({ type: "walking", localDate: "2026-10-30", timezone: "America/New_York", source: "manual" });
    const r = parseActivityForm(
      { type: "walking", localDate: "2026-10-30", startTime: "07:00", durationMinutes: "12" },
      { ...ctx, existing },
    );
    expect(r.ok && r.value.timezone).toBe("America/New_York");
    expect(r.ok && r.value.startedAt).toBe("2026-10-30T11:00:00.000Z");
  });

  it("only lets type, effort, and note change on an imported activity", () => {
    const existing = activity({
      type: "cycling",
      localDate: "2026-10-18",
      source: "fit",
      activeSeconds: 3360,
      elapsedSeconds: 3480,
      avgHeartRateBpm: 128,
    });
    const r = parseActivityForm(
      { type: "cycling", intensity: "moderate", note: "windy", localDate: "2026-10-01", durationMinutes: "5" },
      { ...ctx, existing },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({ localDate: "2026-10-18", activeSeconds: 3360, avgHeartRateBpm: 128, intensity: "moderate", note: "windy" });
    expect(r.value.fieldProvenance.note).toEqual({ source: "manual", kind: "reported" });
  });

  it("converts distance units both ways", () => {
    expect(metersFromDistance(5, "km")).toBe(5000);
    expect(distanceFromMeters(1609.344, "mi")).toBeCloseTo(1);
  });
});
