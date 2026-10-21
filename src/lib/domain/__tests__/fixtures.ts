import type { Activity, EveningEntry, GoalVersion, SleepEntry, SymptomEntry } from "../types";

const base = {
  userId: "test-user",
  createdAt: "2026-10-19T17:00:00.000Z",
  updatedAt: "2026-10-19T17:00:00.000Z",
  revision: 1,
  source: "manual" as const,
};

export const goals: GoalVersion = {
  id: "goals",
  effectiveFrom: "2026-01-05",
  walkingSecondsPerDay: 600,
  resistanceSessionsPerWeek: 2,
  cyclingSecondsPerWeek: 3600,
};

let n = 0;

export function activity(overrides: Partial<Activity> & Pick<Activity, "type" | "localDate">): Activity {
  const activeSeconds = overrides.activeSeconds ?? null;
  return {
    ...base,
    id: `a${n++}`,
    startedAt: `${overrides.localDate}T18:00:00.000Z`,
    timezone: "America/Los_Angeles",
    elapsedSeconds: 600,
    activeSeconds,
    reportedSeconds: null,
    durationBasis: activeSeconds !== null ? "active" : "elapsed",
    distanceMeters: null,
    avgHeartRateBpm: null,
    maxHeartRateBpm: null,
    intensity: "easy",
    note: null,
    canonicalStatus: "canonical",
    linkedActivityId: null,
    fieldProvenance: {},
    ...overrides,
  };
}

export function sleep(overrides: Partial<SleepEntry> = {}): SleepEntry {
  return {
    ...base,
    id: `s${n++}`,
    wakingDate: "2026-10-20",
    timezone: "America/Los_Angeles",
    durationMinSeconds: 7.5 * 3600,
    durationMaxSeconds: 7.5 * 3600,
    approximate: false,
    totalInterruptions: 0,
    babyInterruptions: 0,
    restfulness: "well_rested",
    morningFatigue: "energetic",
    note: null,
    completionState: "complete",
    ...overrides,
  };
}

export function symptom(overrides: Partial<SymptomEntry> = {}): SymptomEntry {
  return {
    ...base,
    id: `y${n++}`,
    observedAt: "2026-10-20T17:05:00.000Z",
    localDate: "2026-10-20",
    context: "morning",
    anklePain: 0,
    side: null,
    flareReported: false,
    newOrWorsening: false,
    swellingHeatRedness: false,
    weightBearingDifficulty: false,
    feverOrUnwell: null,
    ...overrides,
  };
}

export function evening(overrides: Partial<EveningEntry> & Pick<EveningEntry, "localDate">): EveningEntry {
  return {
    ...base,
    id: `e${n++}`,
    activityStatus: "logged",
    eveningFatigue: "mildly_tired",
    recoveryDay: false,
    completionState: "complete",
    ...overrides,
  };
}
