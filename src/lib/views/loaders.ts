import "server-only";

// Screen loaders: compose repository reads with domain logic into view
// models. Pages call these and render; they never touch a data source directly.
import { getRepository } from "@/lib/data";
import { addDays, previousWeekRange, weekRange, weekStart } from "@/lib/domain/dates";
import { evaluateGuidance } from "@/lib/domain/guidance";
import { buildWeeklyReport } from "@/lib/domain/report";
import { computeWeeklyProgress, goalsForWeek } from "@/lib/domain/targets";
import type { GoalVersion, LocalDate } from "@/lib/domain/types";

function requireGoals(versions: GoalVersion[], start: LocalDate): GoalVersion {
  const goals = goalsForWeek(versions, start);
  if (!goals) throw new Error(`No goal version is in effect for the week starting ${start}.`);
  return goals;
}

export async function loadToday() {
  const repo = await getRepository();
  const [profile, today, goalVersions] = await Promise.all([
    repo.getProfile(),
    repo.getToday(),
    repo.getGoalVersions(),
  ]);
  const week = weekRange(weekStart(today));
  const todayRange = { start: today, end: today };
  const [sleep, evening, symptoms, weekActivities, weekEvening] = await Promise.all([
    repo.listSleepEntries(todayRange),
    repo.listEveningEntries(todayRange),
    repo.listSymptomEntries({ start: addDays(today, -7), end: today }),
    repo.listActivities(week),
    repo.listEveningEntries(week),
  ]);

  const sleepToday = sleep[0] ?? null;
  const eveningToday = evening[0] ?? null;

  return {
    isSample: repo.isSample,
    profile,
    today,
    sleepToday,
    eveningToday,
    activitiesToday: weekActivities.filter((a) => a.localDate === today),
    guidance: evaluateGuidance({ today, sleep: sleepToday, evening: eveningToday, symptoms }),
    progress: computeWeeklyProgress(week, requireGoals(goalVersions, week.start), weekActivities, weekEvening, today),
  };
}

export async function loadMorningCheckIn() {
  const repo = await getRepository();
  const [profile, today] = await Promise.all([repo.getProfile(), repo.getToday()]);
  const [sleep, symptoms] = await Promise.all([
    repo.listSleepEntries({ start: today, end: today }),
    repo.listSymptomEntries({ start: addDays(today, -7), end: addDays(today, -1) }),
  ]);
  const lastSymptom = symptoms.sort((a, b) => (a.observedAt < b.observedAt ? 1 : -1))[0] ?? null;
  return { isSample: repo.isSample, profile, today, existing: sleep[0] ?? null, lastSymptom };
}

export async function loadEveningCheckIn() {
  const repo = await getRepository();
  const [profile, today] = await Promise.all([repo.getProfile(), repo.getToday()]);
  const range = { start: today, end: today };
  const [activities, evening] = await Promise.all([repo.listActivities(range), repo.listEveningEntries(range)]);
  return {
    isSample: repo.isSample,
    profile,
    today,
    activities: activities.filter((a) => a.canonicalStatus === "canonical"),
    existing: evening[0] ?? null,
  };
}

export const HISTORY_DAYS = 14;

export async function loadHistory() {
  const repo = await getRepository();
  const [profile, today] = await Promise.all([repo.getProfile(), repo.getToday()]);
  const range = { start: addDays(today, -(HISTORY_DAYS - 1)), end: today };
  const [sleep, evening, symptoms, activities, weights] = await Promise.all([
    repo.listSleepEntries(range),
    repo.listEveningEntries(range),
    repo.listSymptomEntries(range),
    repo.listActivities(range),
    repo.listWeightEntries(range),
  ]);

  const days = Array.from({ length: HISTORY_DAYS }, (_, i) => addDays(today, -i)).map((date) => ({
    date,
    sleep: sleep.find((s) => s.wakingDate === date) ?? null,
    evening: evening.find((e) => e.localDate === date) ?? null,
    symptoms: symptoms.filter((s) => s.localDate === date).sort((a, b) => (a.observedAt < b.observedAt ? -1 : 1)),
    activities: activities
      .filter((a) => a.localDate === date && a.canonicalStatus !== "deleted")
      .sort((a, b) => ((a.startedAt ?? a.createdAt) < (b.startedAt ?? b.createdAt) ? -1 : 1)),
    weights: weights.filter((w) => w.localDate === date),
  }));

  return { isSample: repo.isSample, profile, today, days };
}

export async function loadWeeklyReport() {
  const repo = await getRepository();
  const [profile, today, goalVersions] = await Promise.all([
    repo.getProfile(),
    repo.getToday(),
    repo.getGoalVersions(),
  ]);
  const range = previousWeekRange(today);
  const withPrevious = { start: addDays(range.start, -7), end: range.end };
  const [sleep, evening, activities, symptoms, weights] = await Promise.all([
    repo.listSleepEntries(range),
    repo.listEveningEntries(range),
    repo.listActivities(range),
    repo.listSymptomEntries(range),
    repo.listWeightEntries(withPrevious),
  ]);
  const report = buildWeeklyReport({
    range,
    goals: requireGoals(goalVersions, range.start),
    sleep,
    evening,
    activities,
    symptoms,
    weights,
  });
  return { isSample: repo.isSample, profile, report };
}

export async function loadSettings() {
  const repo = await getRepository();
  const [profile, today, goalVersions] = await Promise.all([
    repo.getProfile(),
    repo.getToday(),
    repo.getGoalVersions(),
  ]);
  return {
    isSample: repo.isSample,
    dataSource: repo.kind,
    profile,
    goals: requireGoals(goalVersions, weekStart(today)),
  };
}
