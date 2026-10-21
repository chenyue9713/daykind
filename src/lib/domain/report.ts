// Monday weekly report aggregation (PRD FR08, FR09).
// Missing data stays missing: nothing is converted to zero sleep or "no activity".
import { addDays, datesInRange, inRange } from "./dates";
import { computeWeeklyProgress, type WeeklyProgress } from "./targets";
import type {
  DateRange,
  EveningEntry,
  Fatigue,
  GoalVersion,
  Activity,
  Restfulness,
  SleepEntry,
  SymptomEntry,
  WeightEntry,
} from "./types";

export const REPORT_RULE_VERSION = "draft-2026-10-20.1";

export type TargetStatus = "achieved" | "not_yet" | "incomplete";

export interface WeeklyReport {
  ruleVersion: string;
  range: DateRange;
  coverage: {
    morningComplete: number;
    eveningComplete: number;
    knownActivityDays: number;
    days: number;
  };
  sleep: {
    sampleCount: number;
    /** Midpoint average of valid entries, in seconds. Null when there are no entries. */
    averageSeconds: number | null;
    includesEstimates: boolean;
    babyInterruptionsTotal: number | null;
    babyInterruptionsKnownNights: number;
  };
  restfulness: Record<Restfulness, number>;
  morningFatigue: Record<Fatigue, number>;
  eveningFatigue: Record<Fatigue, number>;
  progress: WeeklyProgress;
  targetStatus: { walking: TargetStatus; resistance: TargetStatus; cycling: TargetStatus };
  symptoms: {
    daysWithPain: number;
    daysWithKnownPain: number;
    maxPain: number | null;
    flagDays: number;
  };
  weight: {
    sampleCount: number;
    meanKg: number | null;
    previousWeekSampleCount: number;
    previousWeekMeanKg: number | null;
  };
  focusSuggestion: string;
}

function emptyCounts<T extends string>(keys: readonly T[]): Record<T, number> {
  return Object.fromEntries(keys.map((k) => [k, 0])) as Record<T, number>;
}

function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

function status(achieved: boolean, unknownDays: number): TargetStatus {
  if (achieved) return "achieved";
  return unknownDays > 0 ? "incomplete" : "not_yet";
}

export interface ReportInput {
  range: DateRange;
  goals: GoalVersion;
  sleep: SleepEntry[];
  evening: EveningEntry[];
  activities: Activity[];
  symptoms: SymptomEntry[];
  weights: WeightEntry[];
}

export function buildWeeklyReport(input: ReportInput): WeeklyReport {
  const { range, goals } = input;
  const days = datesInRange(range);
  const sleep = input.sleep.filter((s) => inRange(s.wakingDate, range) && s.completionState === "complete");
  const evening = input.evening.filter((e) => inRange(e.localDate, range));
  const symptoms = input.symptoms.filter((s) => inRange(s.localDate, range));

  const validSleep = sleep.filter((s) => s.durationMinSeconds !== null && s.durationMaxSeconds !== null);
  const babyKnown = sleep.filter((s) => s.babyInterruptions !== null);

  const restfulness = emptyCounts<Restfulness>(["well_rested", "somewhat_rested", "poorly_rested"]);
  const morningFatigue = emptyCounts<Fatigue>(["energetic", "mildly_tired", "very_tired"]);
  const eveningFatigue = emptyCounts<Fatigue>(["energetic", "mildly_tired", "very_tired"]);
  for (const s of sleep) {
    if (s.restfulness) restfulness[s.restfulness]++;
    if (s.morningFatigue) morningFatigue[s.morningFatigue]++;
  }
  for (const e of evening) if (e.eveningFatigue) eveningFatigue[e.eveningFatigue]++;

  const progress = computeWeeklyProgress(range, goals, input.activities, evening);
  const unknown = progress.unknownActivityDays;

  const painByDay = days.map((d) => {
    const known = symptoms.filter((s) => s.localDate === d && s.anklePain !== null).map((s) => s.anklePain!);
    return known.length ? Math.max(...known) : null;
  });
  const knownPain = painByDay.filter((p): p is number => p !== null);
  const flagDays = days.filter((d) =>
    symptoms.some(
      (s) =>
        s.localDate === d &&
        (s.flareReported || s.newOrWorsening || s.swellingHeatRedness || s.weightBearingDifficulty),
    ),
  ).length;

  const prevRange = { start: addDays(range.start, -7), end: addDays(range.end, -7) };
  const weights = input.weights.filter((w) => inRange(w.localDate, range)).map((w) => w.weightKg);
  const prevWeights = input.weights.filter((w) => inRange(w.localDate, prevRange)).map((w) => w.weightKg);

  const report: Omit<WeeklyReport, "focusSuggestion"> = {
    ruleVersion: REPORT_RULE_VERSION,
    range,
    coverage: {
      morningComplete: sleep.length,
      eveningComplete: evening.filter((e) => e.completionState === "complete").length,
      knownActivityDays: days.length - unknown,
      days: days.length,
    },
    sleep: {
      sampleCount: validSleep.length,
      averageSeconds: mean(validSleep.map((s) => (s.durationMinSeconds! + s.durationMaxSeconds!) / 2)),
      includesEstimates: validSleep.some((s) => s.approximate || s.durationMinSeconds !== s.durationMaxSeconds),
      babyInterruptionsTotal: babyKnown.length ? babyKnown.reduce((n, s) => n + s.babyInterruptions!, 0) : null,
      babyInterruptionsKnownNights: babyKnown.length,
    },
    restfulness,
    morningFatigue,
    eveningFatigue,
    progress,
    targetStatus: {
      walking: status(progress.walkingQualifiedDays >= days.length, unknown),
      resistance: status(progress.resistanceSessions >= goals.resistanceSessionsPerWeek, unknown),
      cycling: status(progress.cyclingSeconds >= goals.cyclingSecondsPerWeek, unknown),
    },
    symptoms: {
      daysWithPain: knownPain.filter((p) => p > 0).length,
      daysWithKnownPain: knownPain.length,
      maxPain: knownPain.length ? Math.max(...knownPain) : null,
      flagDays,
    },
    weight: {
      sampleCount: weights.length,
      meanKg: mean(weights),
      previousWeekSampleCount: prevWeights.length,
      previousWeekMeanKg: mean(prevWeights),
    },
  };

  return { ...report, focusSuggestion: suggestFocus(report) };
}

/** One conservative, non-escalating focus for the coming week. */
function suggestFocus(r: Omit<WeeklyReport, "focusSuggestion">): string {
  if (r.coverage.morningComplete + r.coverage.eveningComplete === 0) {
    return "Try logging one morning check-in this week. Any entry helps the next report.";
  }
  if (r.symptoms.flagDays > 0 || r.symptoms.daysWithPain >= 3) {
    return "Ankle symptoms showed up on several days. Consider checking in with a healthcare professional and keeping activity comfortable.";
  }
  if (r.coverage.knownActivityDays < r.coverage.days) {
    return "Several days have no activity review. Marking “no activity” on quiet days makes the report more accurate.";
  }
  if (r.progress.walkingQualifiedDays < r.coverage.days) {
    return "Aim for a short walk on one more day than last week, if it feels comfortable.";
  }
  return "Keep the same manageable routine; no increase is needed.";
}
