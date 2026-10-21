import { describe, expect, it } from "vitest";

import { eveningPayload, morningPayload, toActivity, toSleepEntry } from "../mapping";

describe("row mapping", () => {
  it("keeps unknown (null) distinct from zero", () => {
    const sleep = toSleepEntry({
      id: "s1",
      user_id: "u1",
      created_at: "2026-10-20T17:00:00Z",
      updated_at: "2026-10-20T17:05:00Z",
      revision: 2,
      waking_date: "2026-10-20",
      timezone: "America/Los_Angeles",
      duration_min_seconds: 27000,
      duration_max_seconds: 28800,
      approximate: true,
      total_interruptions: 0,
      baby_interruptions: null,
      restfulness: "well_rested",
      morning_fatigue: "energetic",
      note: null,
      completion_state: "complete",
      symptom_entry_id: null,
    });
    expect(sleep.totalInterruptions).toBe(0);
    expect(sleep.babyInterruptions).toBeNull();
    expect(sleep.updatedAt).toBe("2026-10-20T17:05:00.000Z");
    expect(sleep.revision).toBe(2);
  });

  it("reads numeric distance strings and Date-typed dates", () => {
    const a = toActivity({
      id: "a1",
      user_id: "u1",
      created_at: "2026-10-20T17:00:00Z",
      updated_at: "2026-10-20T17:00:00Z",
      revision: 1,
      source: "fit",
      type: "cycling",
      started_at: "2026-10-19T01:40:00+00:00",
      local_date: new Date("2026-10-18T00:00:00Z"),
      timezone: "America/Los_Angeles",
      elapsed_seconds: 3480,
      active_seconds: 3360,
      reported_seconds: null,
      duration_basis: "active",
      distance_meters: "21500.00",
      avg_heart_rate_bpm: null,
      max_heart_rate_bpm: null,
      intensity: "unknown",
      note: null,
      canonical_status: "canonical",
      linked_activity_id: null,
      field_provenance: {},
    });
    expect(a.localDate).toBe("2026-10-18");
    expect(a.distanceMeters).toBe(21500);
    expect(a.avgHeartRateBpm).toBeNull();
  });
});

describe("write payloads", () => {
  it("sends the request id, expected revision, and edited id", () => {
    const p = morningPayload(
      {
        wakingDate: "2026-10-20",
        durationMinSeconds: 25200,
        durationMaxSeconds: 25200,
        approximate: false,
        totalInterruptions: null,
        babyInterruptions: null,
        restfulness: "somewhat_rested",
        morningFatigue: "mildly_tired",
        note: null,
        symptom: null,
      },
      { requestId: "r1", expectedRevision: 3, id: "s1" },
      "America/Los_Angeles",
    );
    expect(p).toMatchObject({ request_id: "r1", expected_revision: 3, id: "s1", total_interruptions: null, symptom: null });
  });

  it("only sends activities to remove when “no activity” was explicitly confirmed", () => {
    const base = {
      localDate: "2026-10-20",
      newActivities: [],
      seenActivityIds: ["a1"],
      eveningFatigue: "mildly_tired" as const,
      recoveryDay: false,
      symptom: {
        anklePain: null,
        side: null,
        flareReported: false,
        newOrWorsening: false,
        swellingHeatRedness: false,
        weightBearingDifficulty: false,
        feverOrUnwell: null,
      },
    };
    const meta = { requestId: "r", expectedRevision: null };
    expect(eveningPayload({ ...base, activityStatus: "confirmed_none", confirmRemoveExisting: true }, meta, "UTC").remove_activity_ids).toEqual(["a1"]);
    expect(eveningPayload({ ...base, activityStatus: "confirmed_none", confirmRemoveExisting: false }, meta, "UTC").remove_activity_ids).toEqual([]);
    expect(eveningPayload({ ...base, activityStatus: "logged", confirmRemoveExisting: true }, meta, "UTC").remove_activity_ids).toEqual([]);
  });
});
