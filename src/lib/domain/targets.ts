// Weekly target math (PRD FR05). Raw seconds are compared to thresholds
// before any rounding for display.
import { goalSecondsOf } from "./activity";
import { datesInRange, inRange } from "./dates";
import type { Activity, DateRange, DurationBasis, EveningEntry, GoalVersion, LocalDate } from "./types";

export function countsTowardGoals(activity: Activity): boolean {
  return activity.canonicalStatus === "canonical";
}

/**
 * The duration that counts toward goals and its basis: timer/active time when
 * measured, elapsed time as a labeled fallback, or the user's reported minutes.
 */
export function goalSeconds(activity: Activity): { seconds: number; basis: DurationBasis } {
  return { seconds: goalSecondsOf(activity), basis: activity.durationBasis };
}

export interface WalkingDay {
  date: LocalDate;
  seconds: number;
  qualified: boolean;
  /** No walking recorded and the day's activity status was never reviewed. */
  unknown: boolean;
}

export interface WeeklyProgress {
  range: DateRange;
  goals: GoalVersion;
  walkingDays: WalkingDay[];
  walkingQualifiedDays: number;
  resistanceSessions: number;
  cyclingSeconds: number;
  recoveryDays: LocalDate[];
  /** Days with neither logged activity nor a reviewed activity status. */
  unknownActivityDays: number;
}

export function computeWeeklyProgress(
  range: DateRange,
  goals: GoalVersion,
  activities: Activity[],
  eveningEntries: EveningEntry[],
  today?: LocalDate,
): WeeklyProgress {
  const counted = activities.filter((a) => countsTowardGoals(a) && inRange(a.localDate, range));
  const eveningByDate = new Map(eveningEntries.map((e) => [e.localDate, e]));
  const days = datesInRange(range);

  const walkingDays = days.map((date): WalkingDay => {
    const seconds = counted
      .filter((a) => a.type === "walking" && a.localDate === date)
      .reduce((sum, a) => sum + goalSeconds(a).seconds, 0);
    const hasAnyActivity = counted.some((a) => a.localDate === date);
    const status = eveningByDate.get(date)?.activityStatus ?? "unknown";
    const isFuture = today !== undefined && date > today;
    return {
      date,
      seconds,
      qualified: seconds >= goals.walkingSecondsPerDay,
      unknown: !isFuture && !hasAnyActivity && status === "unknown",
    };
  });

  return {
    range,
    goals,
    walkingDays,
    walkingQualifiedDays: walkingDays.filter((d) => d.qualified).length,
    resistanceSessions: counted.filter((a) => a.type === "resistance").length,
    cyclingSeconds: counted
      .filter((a) => a.type === "cycling")
      .reduce((sum, a) => sum + goalSeconds(a).seconds, 0),
    recoveryDays: eveningEntries
      .filter((e) => e.recoveryDay && inRange(e.localDate, range))
      .map((e) => e.localDate),
    unknownActivityDays: walkingDays.filter((d) => d.unknown).length,
  };
}

/** The PRD's proposed default targets, used until the user saves their own. */
export const DEFAULT_GOALS: GoalVersion = {
  id: "default",
  effectiveFrom: "1970-01-05",
  walkingSecondsPerDay: 600,
  resistanceSessionsPerWeek: 2,
  cyclingSecondsPerWeek: 3600,
};

/** Picks the goal version in effect for a week (latest effective_from on or before its start). */
export function goalsForWeek(versions: GoalVersion[], weekStartDate: LocalDate): GoalVersion | null {
  return (
    versions
      .filter((g) => g.effectiveFrom <= weekStartDate)
      .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0] ?? null
  );
}
