import { describe, expect, it } from "vitest";

import { goalSecondsOf } from "@/lib/domain/activity";
import { activity } from "@/lib/domain/__tests__/fixtures";
import type { ActivityType } from "@/lib/domain/types";
import { candidatesForType, parseDecisions } from "../decisions";
import { mapSport, normalizeSession } from "../normalize";
import { buildPreview, confirmImport, type ImportDeps } from "../service";
import type { ImportPreview, ParsedSession, SessionDecision } from "../types";
import { createFakeStore, type FakeStore } from "./fake-store";
import { loadFixture } from "./load-fixture";

const TZ = "America/Los_Angeles";
let requestCounter = 0;
const deps = (store: FakeStore): ImportDeps => ({
  store,
  profileTimezone: TZ,
  now: () => new Date("2026-10-20T17:00:00Z"),
  newRequestId: () => `00000000-0000-4000-8000-${String(++requestCounter).padStart(12, "0")}`,
});

async function preview(name: string, store: FakeStore): Promise<ImportPreview> {
  const result = await buildPreview(loadFixture(name), name, deps(store));
  if (!result.ok) throw new Error(`${name}: ${result.error.message}`);
  return result.preview;
}

type ImportDecision = Extract<SessionDecision, { action: "import" }>;

/** Accepts every readable session with its type (or suggestion) and the default timezone. */
function acceptAll(p: ImportPreview, overrides: Partial<ImportDecision> = {}): SessionDecision[] {
  return p.sessions
    .filter((s) => s.status !== "failed")
    .map((s) => {
      const type: ActivityType = overrides.type ?? s.type ?? s.typeSuggestion ?? "other";
      return {
        key: s.key,
        action: "import",
        type,
        timezone: s.timezoneCandidates[0].timezone,
        duplicate: null,
        reviewedCandidateIds: candidatesForType(s, type).map((c) => c.activityId),
        ...overrides,
      };
    });
}

const confirm = (name: string, p: ImportPreview, decisions: SessionDecision[], store: FakeStore) =>
  confirmImport(loadFixture(name), name, { requestId: p.requestId, expectedHash: p.fileHash, decisions }, deps(store));

function parsed(overrides: Partial<ParsedSession>): ParsedSession {
  return {
    index: 0,
    sport: "walking",
    subSport: "generic",
    startedAt: "2026-10-18T18:00:00.000Z",
    startIsFloating: false,
    utcOffsetMinutes: -420,
    elapsedSeconds: 1200,
    elapsedSource: "device",
    timerSeconds: 1100,
    distanceMeters: 1500,
    heartRate: { avgBpm: null, maxBpm: null, basis: "none", coverage: null },
    providerId: "fit:x",
    errors: [],
    warnings: [],
    ...overrides,
  };
}

const norm = (s: ParsedSession, format: "fit" | "tcx" = "fit") =>
  normalizeSession(s, { format, profileTimezone: TZ, now: new Date("2026-10-20T17:00:00Z") });

describe("normalization (AC07)", () => {
  it("previews an ordinary FIT ride with local date, active-time basis, visible pause, and HR", async () => {
    const [s] = (await preview("ride-ordinary.fit", createFakeStore())).sessions;
    expect(s).toMatchObject({
      status: "ready",
      type: "cycling",
      sportLabel: "Cycling · Road",
      localDate: "2026-10-18",
      timezone: TZ,
      dateConfidence: "device_offset_matches",
      durationBasis: "active",
      goalSeconds: 3360,
      elapsedSeconds: 3480,
      pausedSeconds: 120,
      distanceMeters: 21500,
      requiredConfirmations: [],
    });
    expect(s.heartRate.avgBpm).toBe(128);
    expect(s.provenance.avgHeartRateBpm).toBe("device");
  });

  it("asks for the sport and timezone of a TCX walk, suggesting walking from its pace", async () => {
    const [s] = (await preview("walk-ordinary.tcx", createFakeStore())).sessions;
    expect(s.type).toBeNull();
    expect(s.typeSuggestion).toBe("walking");
    expect(s.dateConfidence).toBe("assumed_profile_timezone");
    expect(s.localDate).toBe("2026-10-18"); // 01:05 UTC Oct 19 is 6:05 PM Oct 18 in Los Angeles
    expect(s.requiredConfirmations).toEqual(["timezone", "sport"]);
    expect(s.status).toBe("needs_review");
  });

  it("maps strength training to resistance and treats a device distance of 0 as unknown", async () => {
    const [s] = (await preview("strength.fit", createFakeStore())).sessions;
    expect(s.type).toBe("resistance");
    expect(s.distanceMeters).toBeNull();
    expect(s.provenance.distanceMeters).toBe("device_zero_treated_as_unknown");
  });

  it("keeps missing heart rate unknown", async () => {
    const [s] = (await preview("walk-no-hr.fit", createFakeStore())).sessions;
    expect(s.heartRate.avgBpm).toBeNull();
    expect(s.provenance.avgHeartRateBpm).toBe("absent");
  });

  it("previews every session of multi-session files", async () => {
    const fit = await preview("multisport.fit", createFakeStore());
    expect(fit.sessions.map((s) => [s.type, s.goalSeconds])).toEqual([
      ["walking", 1200],
      ["cycling", 1800],
    ]);
    const tcx = await preview("multi-activity.tcx", createFakeStore());
    expect(tcx.sessions.map((s) => s.type)).toEqual(["cycling", null]);
  });

  it("offers the watch's timezone when it gives a different date (travel)", async () => {
    const [s] = (await preview("walk-travel-offset.fit", createFakeStore())).sessions;
    expect(s.dateConfidence).toBe("device_offset_differs");
    expect(s.timezoneCandidates.map((c) => [c.timezone, c.localDate])).toEqual([
      [TZ, "2026-10-18"],
      ["Etc/GMT-9", "2026-10-19"],
    ]);
    expect(s.requiredConfirmations).toContain("timezone");
  });

  it("reads floating TCX times as local time in the profile timezone and asks to confirm", async () => {
    const [s] = (await preview("floating-time.tcx", createFakeStore())).sessions;
    expect(s.dateConfidence).toBe("floating_time");
    expect(s.startedAt).toBe("2026-10-14T14:30:00.000Z"); // 7:30 AM PDT
    expect(s.requiredConfirmations).toContain("timezone");
  });

  it("falls back to elapsed time with a label when there is no timer time", () => {
    const s = norm(parsed({ timerSeconds: null }));
    expect(s.durationBasis).toBe("elapsed");
    expect(s.goalSeconds).toBe(1200);
    expect(s.pausedSeconds).toBeNull();
  });

  it("rejects a timer time longer than elapsed and falls back to elapsed", () => {
    const s = norm(parsed({ timerSeconds: 5000 }));
    expect(s.durationBasis).toBe("elapsed");
    expect(s.provenance.activeSeconds).toBe("rejected_implausible");
    expect(s.warnings[0]).toMatch(/elapsed time is used/);
  });

  it("fails impossible dates and sessions longer than 24 hours", () => {
    expect(norm(parsed({ startedAt: "2027-06-01T00:00:00.000Z" })).status).toBe("failed");
    expect(norm(parsed({ startedAt: "1995-06-01T00:00:00.000Z" })).status).toBe("failed");
    expect(norm(parsed({ elapsedSeconds: 90_000, timerSeconds: null })).status).toBe("failed");
  });

  it("drops an average heart rate above the maximum", () => {
    const s = norm(parsed({ heartRate: { avgBpm: 170, maxBpm: 150, basis: "device_summary", coverage: null } }));
    expect(s.heartRate.avgBpm).toBeNull();
    expect(s.heartRate.maxBpm).toBe(150);
  });

  it("maps sports conservatively", () => {
    expect(mapSport("fit", "fitness_equipment", "indoor_cycling", null, 600).type).toBe("cycling");
    expect(mapSport("fit", "running", "treadmill", 3000, 900).type).toBe("other");
    expect(mapSport("fit", "hiking", null, 5000, 3600)).toMatchObject({ type: null, suggestion: "walking" });
    expect(mapSport("fit", "training", "generic", null, 900).type).toBeNull();
    expect(mapSport("tcx", "Biking", null, null, 600).type).toBe("cycling");
    expect(mapSport("tcx", "Running", null, 3000, 900)).toMatchObject({ type: null, suggestion: null });
  });
});

describe("saving a confirmed import", () => {
  it("saves a ride atomically with contract units, provenance, and a GPS-free summary", async () => {
    const store = createFakeStore();
    const p = await preview("ride-ordinary.fit", store);
    const outcome = await confirm("ride-ordinary.fit", p, acceptAll(p), store);
    expect(outcome.status).toBe("saved");
    const [saved] = store.activities;
    expect(saved).toMatchObject({
      type: "cycling",
      source: "fit",
      startedAt: "2026-10-18T22:40:00.000Z",
      localDate: "2026-10-18",
      timezone: TZ,
      elapsedSeconds: 3480,
      activeSeconds: 3360,
      durationBasis: "active",
      distanceMeters: 21500,
      avgHeartRateBpm: 128,
      maxHeartRateBpm: 161,
      intensity: "unknown",
      note: null,
    });
    expect(saved.fieldProvenance.activeSeconds).toEqual({ source: "fit", kind: "measured" });
    const summary = JSON.stringify(store.sources[0].importedSummary);
    expect(summary).not.toMatch(/lat|long|position|3456789012/i);
    expect(store.saveCalls[0].file).toEqual({ sha256: p.fileHash, kind: "fit", filenameSanitized: "ride-ordinary.fit" });
  });

  it("blocks an exact repeated upload, even under another name (AC08)", async () => {
    const store = createFakeStore();
    const p = await preview("ride-ordinary.fit", store);
    await confirm("ride-ordinary.fit", p, acceptAll(p), store);
    for (const name of ["ride-ordinary.fit", "copy of ride.fit"]) {
      const again = await buildPreview(loadFixture("ride-ordinary.fit"), name, deps(store));
      expect(again.ok ? null : again.error.code).toBe("already_imported");
    }
    expect(store.activities).toHaveLength(1);
  });

  it("never saves twice when a confirmation is retried after a lost response", async () => {
    const store = createFakeStore();
    const p = await preview("ride-ordinary.fit", store);
    expect((await confirm("ride-ordinary.fit", p, acceptAll(p), store)).status).toBe("saved");
    const retry = await confirm("ride-ordinary.fit", p, acceptAll(p), store);
    expect(retry.status === "error" && retry.error.code).toBe("already_imported");
    expect(store.activities).toHaveLength(1);
    expect(store.saveCalls.every((call) => call.requestId === p.requestId)).toBe(true);
  });

  it("uses the confirmed sport and the watch's timezone after travel", async () => {
    const store = createFakeStore();
    const p = await preview("walk-travel-offset.fit", store);
    const outcome = await confirm("walk-travel-offset.fit", p, acceptAll(p, { timezone: "Etc/GMT-9" }), store);
    expect(outcome.status).toBe("saved");
    expect(store.activities[0]).toMatchObject({ localDate: "2026-10-19", timezone: "Etc/GMT-9" });
  });

  it("records a user-chosen sport as reported, not measured", async () => {
    const store = createFakeStore();
    const p = await preview("walk-ordinary.tcx", store);
    await confirm("walk-ordinary.tcx", p, acceptAll(p, { type: "walking" }), store);
    expect(store.activities[0].fieldProvenance.type).toEqual({ source: "tcx", kind: "reported" });
  });

  it("imports only readable sessions and reports the failed one", async () => {
    const store = createFakeStore();
    const p = await preview("missing-start.tcx", store);
    expect(p.sessions.map((s) => s.status)).toEqual(["failed", "needs_review"]);
    const outcome = await confirm("missing-start.tcx", p, acceptAll(p), store);
    expect(outcome.status).toBe("saved");
    expect(store.activities).toHaveLength(1);
  });

  it("lets the user skip a session of a multi-session file", async () => {
    const store = createFakeStore();
    const p = await preview("multisport.fit", store);
    const decisions = acceptAll(p);
    decisions[0] = { key: decisions[0].key, action: "skip" };
    expect((await confirm("multisport.fit", p, decisions, store)).status).toBe("saved");
    expect(store.activities.map((a) => a.type)).toEqual(["cycling"]);
  });
});

describe("duplicate review (AC08)", () => {
  // A quick-add walk from the evening check-in: no start time, 25 reported minutes, a note.
  const manualWalk = () =>
    activity({
      id: "manual-walk",
      type: "walking",
      localDate: "2026-10-18",
      startedAt: null,
      elapsedSeconds: null,
      reportedSeconds: 1500,
      durationBasis: "reported",
      intensity: "easy",
      note: "Stroller loop with the baby",
      fieldProvenance: { note: { source: "manual", kind: "reported" } },
    });

  it("presents a manual entry as a suspected duplicate and requires a decision", async () => {
    const store = createFakeStore([manualWalk()]);
    const p = await preview("walk-ordinary.tcx", store);
    const [s] = p.sessions;
    expect(candidatesForType(s, "walking").map((c) => c.activityId)).toEqual(["manual-walk"]);
    expect(candidatesForType(s, "cycling")).toEqual([]);
    expect(s.requiredConfirmations).toContain("duplicate");
    expect(s.duplicates[0].reasons).toContain("Entered manually");

    const outcome = await confirm("walk-ordinary.tcx", p, acceptAll(p, { type: "walking" }), store);
    expect(outcome.status).toBe("error");
    if (outcome.status === "error") expect(outcome.error.code).toBe("invalid_decisions");
    expect(store.saveCalls).toHaveLength(0);
  });

  it("links: keeps the manual note and effort, takes measured fields, counts once", async () => {
    const store = createFakeStore([manualWalk()]);
    const p = await preview("walk-ordinary.tcx", store);
    const outcome = await confirm(
      "walk-ordinary.tcx",
      p,
      acceptAll(p, { type: "walking", duplicate: { resolution: "link", activityId: "manual-walk", expectedRevision: 1 } }),
      store,
    );
    expect(outcome.status).toBe("saved");
    const canonical = store.activities.filter((a) => a.canonicalStatus === "canonical");
    expect(canonical).toHaveLength(1);
    expect(canonical[0]).toMatchObject({
      id: "manual-walk",
      note: "Stroller loop with the baby",
      intensity: "easy",
      startedAt: "2026-10-19T01:05:00.000Z",
      activeSeconds: 1500,
      durationBasis: "active",
      avgHeartRateBpm: 105,
      revision: 2,
    });
    expect(store.saveCalls[0].sessions[0].resolution).toEqual({ kind: "link", activityId: "manual-walk", expectedRevision: 1 });
  });

  it("replaces: the old record stops counting and its note can be kept", async () => {
    const store = createFakeStore([manualWalk()]);
    const p = await preview("walk-ordinary.tcx", store);
    await confirm(
      "walk-ordinary.tcx",
      p,
      acceptAll(p, { type: "walking", duplicate: { resolution: "replace", activityId: "manual-walk", expectedRevision: 1, keepNote: true } }),
      store,
    );
    const old = store.activities.find((a) => a.id === "manual-walk")!;
    const replacement = store.activities.find((a) => a.canonicalStatus === "canonical")!;
    expect(old).toMatchObject({ canonicalStatus: "linked", linkedActivityId: replacement.id });
    expect(replacement).toMatchObject({ note: "Stroller loop with the baby", intensity: "easy", source: "tcx" });
    expect(replacement.fieldProvenance.note).toEqual({ source: "manual", kind: "reported" });
  });

  it("replaces without keeping the note when asked", async () => {
    const store = createFakeStore([manualWalk()]);
    const p = await preview("walk-ordinary.tcx", store);
    await confirm(
      "walk-ordinary.tcx",
      p,
      acceptAll(p, { type: "walking", duplicate: { resolution: "replace", activityId: "manual-walk", expectedRevision: 1, keepNote: false } }),
      store,
    );
    expect(store.activities.find((a) => a.canonicalStatus === "canonical")!.note).toBeNull();
  });

  it("keeps both when the user says they are different workouts", async () => {
    const store = createFakeStore([manualWalk()]);
    const p = await preview("walk-ordinary.tcx", store);
    await confirm("walk-ordinary.tcx", p, acceptAll(p, { type: "walking", duplicate: { resolution: "keep_both" } }), store);
    const canonical = store.activities.filter((a) => a.canonicalStatus === "canonical");
    expect(canonical).toHaveLength(2);
    expect(canonical.reduce((sum, a) => sum + goalSecondsOf(a), 0)).toBe(3000);
  });

  it("matches an earlier import of the same workout from a different file (±2 min, ±10%)", async () => {
    const existing = activity({
      id: "earlier-ride",
      type: "cycling",
      localDate: "2026-10-18",
      startedAt: "2026-10-18T22:41:30.000Z",
      elapsedSeconds: 3500,
      activeSeconds: 3300,
      durationBasis: "active",
      source: "tcx",
    });
    const store = createFakeStore([existing]);
    const [s] = (await preview("ride-ordinary.fit", store)).sessions;
    expect(s.duplicates.map((c) => c.activityId)).toEqual(["earlier-ride"]);
    expect(s.duplicates[0].reasons).toEqual(["Starts 2 min apart", "Duration within 2%"]);
  });

  it("asks for review again when a new possible duplicate appears after the preview", async () => {
    const store = createFakeStore();
    const p = await preview("walk-ordinary.tcx", store);
    store.activities.push(manualWalk());
    const outcome = await confirm("walk-ordinary.tcx", p, acceptAll(p, { type: "walking", reviewedCandidateIds: [] }), store);
    expect(outcome.status).toBe("error");
    if (outcome.status !== "error") return;
    expect(outcome.error.code).toBe("changed_since_preview");
    expect(outcome.preview?.sessions[0].duplicates.map((c) => c.activityId)).toEqual(["manual-walk"]);
    expect(store.saveCalls).toHaveLength(0);
  });

  it("refuses to link when the target was edited since the preview", async () => {
    const store = createFakeStore([manualWalk()]);
    const p = await preview("walk-ordinary.tcx", store);
    store.activities[0].revision = 2;
    const outcome = await confirm(
      "walk-ordinary.tcx",
      p,
      acceptAll(p, { type: "walking", duplicate: { resolution: "link", activityId: "manual-walk", expectedRevision: 1 } }),
      store,
    );
    expect(outcome.status === "error" && outcome.error.code).toBe("changed_since_preview");
    expect(store.activities[0].note).toBe("Stroller loop with the baby");
    expect(store.saveCalls).toHaveLength(0);
  });

  it("rejects link targets that were not offered as matches", async () => {
    const store = createFakeStore([manualWalk(), activity({ id: "other", type: "walking", localDate: "2026-10-01" })]);
    const p = await preview("walk-ordinary.tcx", store);
    const outcome = await confirm(
      "walk-ordinary.tcx",
      p,
      acceptAll(p, { type: "walking", duplicate: { resolution: "link", activityId: "other", expectedRevision: 1 } }),
      store,
    );
    expect(outcome.status === "error" && outcome.error.code).toBe("invalid_decisions");
  });
});

describe("failure handling (AC09)", () => {
  it.each([
    [{ status: "failed", reason: "db down" } as const, "storage_failed"],
    [new Error("socket hang up"), "storage_failed"],
    [{ status: "something_new", reason: "?" } as never, "storage_failed"],
    [{ status: "duplicate_file", reason: "x", importedAt: "2026-10-19T00:00:00Z" } as const, "already_imported"],
    [{ status: "invalid", reason: "x", sessionIndex: 0, errors: { timezone: "Bad zone." } } as const, "invalid_decisions"],
  ])("maps a store result to an actionable error with nothing written: %o", async (result, code) => {
    const store = createFakeStore();
    const p = await preview("ride-ordinary.fit", store);
    store.nextSave = result;
    const outcome = await confirm("ride-ordinary.fit", p, acceptAll(p), store);
    expect(outcome.status).toBe("error");
    if (outcome.status === "error") {
      expect(outcome.error.code).toBe(code);
      expect(outcome.error.message).toMatch(/nothing|already|rejected/i);
    }
    expect(store.activities).toHaveLength(0);
  });

  it("returns a fresh preview after a store conflict", async () => {
    const store = createFakeStore();
    const p = await preview("ride-ordinary.fit", store);
    store.nextSave = { status: "conflict", reason: "changed", activityId: "x" };
    const outcome = await confirm("ride-ordinary.fit", p, acceptAll(p), store);
    expect(outcome.status === "error" && outcome.error.code).toBe("conflict");
    expect(outcome.status === "error" && outcome.preview?.requestId).not.toBe(p.requestId);
  });

  it("passes through sample mode as not persisted", async () => {
    const store = createFakeStore();
    const p = await preview("ride-ordinary.fit", store);
    store.nextSave = { status: "not_persisted", reason: "Sample mode." };
    expect(await confirm("ride-ordinary.fit", p, acceptAll(p), store)).toEqual({ status: "not_persisted", message: "Sample mode." });
  });

  it("detects a different file sent with the confirmation", async () => {
    const store = createFakeStore();
    const p = await preview("ride-ordinary.fit", store);
    const outcome = await confirmImport(loadFixture("ride-paused.fit"), "ride.fit", { requestId: p.requestId, expectedHash: p.fileHash, decisions: acceptAll(p) }, deps(store));
    expect(outcome.status === "error" && outcome.error.code).toBe("changed_since_preview");
    expect(store.saveCalls).toHaveLength(0);
  });

  it("rejects tampered decisions", async () => {
    const store = createFakeStore();
    const p = await preview("ride-ordinary.fit", store);
    const cases: SessionDecision[][] = [
      [],
      acceptAll(p, { type: "walking" }),
      acceptAll(p, { timezone: "Europe/Paris" }),
      [...acceptAll(p), ...acceptAll(p)],
      [{ key: "9", action: "skip" }, ...acceptAll(p)],
      [{ key: "0", action: "skip" }],
    ];
    for (const decisions of cases) {
      const outcome = await confirm("ride-ordinary.fit", p, decisions, store);
      expect(outcome.status === "error" && outcome.error.code).toBe("invalid_decisions");
    }
    expect(store.saveCalls).toHaveLength(0);
  });

  it("refuses to import a failed session", async () => {
    const store = createFakeStore();
    const p = await preview("missing-start.tcx", store);
    const decisions: SessionDecision[] = [
      { key: "0", action: "import", type: "cycling", timezone: TZ, duplicate: null, reviewedCandidateIds: [] },
      ...acceptAll(p),
    ];
    expect((await confirm("missing-start.tcx", p, decisions, store)).status).toBe("error");
  });

  it("parses only well-formed decision JSON", () => {
    expect(parseDecisions("nope")).toBeNull();
    expect(parseDecisions([{ key: "0", action: "delete" }])).toBeNull();
    expect(parseDecisions([{ key: "0", action: "import", type: "swimming", timezone: TZ, reviewedCandidateIds: [] }])).toBeNull();
    expect(parseDecisions([{ key: "0", action: "import", type: "walking", timezone: TZ, reviewedCandidateIds: [], duplicate: { resolution: "merge" } }])).toBeNull();
    expect(
      parseDecisions([
        { key: "0", action: "import", type: "walking", timezone: TZ, reviewedCandidateIds: ["a"], duplicate: { resolution: "replace", activityId: "a", expectedRevision: 3, keepNote: true } },
      ]),
    ).toEqual([
      { key: "0", action: "import", type: "walking", timezone: TZ, reviewedCandidateIds: ["a"], duplicate: { resolution: "replace", activityId: "a", expectedRevision: 3, keepNote: true } },
    ]);
  });
});
