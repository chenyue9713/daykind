import { describe, expect, it } from "vitest";

import { validateEveningCheckIn, validateMorningCheckIn } from "../checkins";

const morningBase = {
  wakingDate: "2026-10-20",
  restfulness: "well_rested",
  morningFatigue: "energetic",
};

describe("morning check-in (AC01, AC02)", () => {
  it("stores a 7.5–8 hour estimate as 450–480 minutes with zero distinct from unknown", () => {
    const r = validateMorningCheckIn({
      ...morningBase,
      approximate: "on",
      sleepMinHours: "7",
      sleepMinMinutes: "30",
      sleepMaxHours: "8",
      sleepMaxMinutes: "0",
      totalInterruptions: "0",
      babyInterruptionsUnknown: "on",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.durationMinSeconds).toBe(450 * 60);
    expect(r.value.durationMaxSeconds).toBe(480 * 60);
    expect(r.value.totalInterruptions).toBe(0);
    expect(r.value.babyInterruptions).toBeNull();
  });

  it("does not subtract baby-care awakenings from actual sleep", () => {
    const r = validateMorningCheckIn({
      ...morningBase,
      sleepHours: "7",
      totalInterruptions: "3",
      babyInterruptions: "3",
    });
    expect(r.ok && r.value.durationMinSeconds).toBe(7 * 3600);
  });

  it("rejects more baby-care interruptions than total", () => {
    const r = validateMorningCheckIn({ ...morningBase, sleepHours: "7", totalInterruptions: "2", babyInterruptions: "3" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.babyInterruptions).toBeDefined();
  });

  it("requires interruption answers, but accepts unknown", () => {
    const r = validateMorningCheckIn({ ...morningBase, sleepHours: "7" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["babyInterruptions", "totalInterruptions"]);
  });
});

describe("evening check-in (AC03)", () => {
  const eveningBase = { localDate: "2026-10-20", eveningFatigue: "mildly_tired", anklePain: "0" };

  it("accepts a 15-minute walk with pain 0", () => {
    const r = validateEveningCheckIn(
      {
        ...eveningBase,
        activityStatus: "logged",
        activities: JSON.stringify([{ type: "walking", durationMinutes: 15, intensity: "easy" }]),
      },
      0,
    );
    expect(r.ok).toBe(true);
  });

  it("requires reconciliation when marking no activity over an existing walk", () => {
    const conflict = validateEveningCheckIn({ ...eveningBase, activityStatus: "confirmed_none" }, 1);
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) expect(conflict.errors.confirmRemoveExisting).toBeDefined();

    const confirmed = validateEveningCheckIn(
      { ...eveningBase, activityStatus: "confirmed_none", confirmRemoveExisting: "on" },
      1,
    );
    expect(confirmed.ok).toBe(true);
  });

  it("requires an ankle answer, accepting unknown", () => {
    const missing = validateEveningCheckIn({ localDate: "2026-10-20", eveningFatigue: "energetic", activityStatus: "unknown" }, 0);
    expect(missing.ok).toBe(false);
    const unknown = validateEveningCheckIn(
      { localDate: "2026-10-20", eveningFatigue: "energetic", activityStatus: "unknown", anklePain: "unknown" },
      0,
    );
    expect(unknown.ok).toBe(true);
  });
});
