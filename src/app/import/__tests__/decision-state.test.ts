import { describe, expect, it } from "vitest";

import { normalizeSession } from "@/lib/import/normalize";
import type { DuplicateCandidate, SessionPreview } from "@/lib/import/types";
import { initialDecision, missingAnswers, parseDuplicateChoice, toSessionDecision } from "../decision-state";

const candidate: DuplicateCandidate = {
  activityId: "sample-activity-2026-10-20-08:20",
  revision: 3,
  source: "manual",
  type: "walking",
  startedAt: null,
  localDate: "2026-10-18",
  goalSeconds: 1500,
  durationBasis: "reported",
  elapsedSeconds: null,
  activeSeconds: null,
  distanceMeters: null,
  avgHeartRateBpm: null,
  maxHeartRateBpm: null,
  note: "with the baby",
  intensity: "easy",
  reasons: [],
};

function tcxWalk(duplicates: DuplicateCandidate[] = [candidate]): SessionPreview {
  const s = normalizeSession(
    {
      index: 0,
      sport: "Running",
      subSport: null,
      startedAt: "2026-10-19T01:05:00.000Z",
      startIsFloating: false,
      utcOffsetMinutes: null,
      elapsedSeconds: 1500,
      elapsedSource: "derived",
      timerSeconds: 1500,
      distanceMeters: 2000,
      heartRate: { avgBpm: null, maxBpm: null, basis: "none", coverage: null },
      providerId: "tcx:x",
      errors: [],
      warnings: [],
    },
    { format: "tcx", profileTimezone: "America/Los_Angeles", now: new Date("2026-10-20T00:00:00Z") },
  );
  return { ...s, duplicates };
}

describe("import decision state", () => {
  it("splits duplicate choices on the first colon only", () => {
    expect(parseDuplicateChoice("link:sample-activity-2026-10-20-08:20")).toEqual({ kind: "link", id: "sample-activity-2026-10-20-08:20" });
    expect(parseDuplicateChoice("keep_both")).toEqual({ kind: "keep_both", id: "" });
  });

  it("starts with nothing pre-answered for ambiguous sport and day", () => {
    const s = tcxWalk();
    const d = initialDecision(s);
    expect(d).toMatchObject({ include: true, type: "", timezone: "" });
    expect(missingAnswers(s, d)).toEqual(["choose the activity type", "confirm the day"]);
    expect(missingAnswers(s, { ...d, type: "walking", timezone: "America/Los_Angeles" })).toEqual(["decide about the possible duplicate"]);
    expect(missingAnswers(s, { ...d, type: "cycling", timezone: "America/Los_Angeles" })).toEqual([]);
  });

  it("builds link and replace decisions with the revision seen in the preview", () => {
    const s = tcxWalk();
    const base = { include: true, type: "walking" as const, timezone: "America/Los_Angeles", keepNote: false };
    expect(toSessionDecision(s, { ...base, duplicate: `link:${candidate.activityId}` })).toEqual({
      key: "0",
      action: "import",
      type: "walking",
      timezone: "America/Los_Angeles",
      duplicate: { resolution: "link", activityId: candidate.activityId, expectedRevision: 3 },
      reviewedCandidateIds: [candidate.activityId],
    });
    expect(toSessionDecision(s, { ...base, duplicate: `replace:${candidate.activityId}` })).toMatchObject({
      duplicate: { resolution: "replace", activityId: candidate.activityId, expectedRevision: 3, keepNote: false },
    });
    expect(toSessionDecision(s, { ...base, include: false, duplicate: "" })).toEqual({ key: "0", action: "skip" });
  });
});
