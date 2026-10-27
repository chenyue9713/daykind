import "server-only";

// Screen loaders: compose repository reads with domain logic into view
// models. Pages call these and render; they never touch a data source directly.
import { getCurrentUser } from "@/lib/auth/session";
import { getRepository, getSetUpRepository } from "@/lib/data";
import { distanceFromMeters, isMeasuredActivity } from "@/lib/domain/activity-form";
import { addDays, formatTime, isLocalDate, previousWeekRange, weekRange, weekStart } from "@/lib/domain/dates";
import { durationBasisLabel, formatDuration } from "@/lib/domain/format";
import { evaluateGuidance } from "@/lib/domain/guidance";
import { needsOnboarding, targetSchedule, timezoneOptions } from "@/lib/domain/preferences";
import { buildWeeklyReport } from "@/lib/domain/report";
import { reminderEnv } from "@/lib/reminders/config";
import { computeWeeklyProgress, goalSeconds, goalsForWeek } from "@/lib/domain/targets";
import type { Activity, GoalVersion, LocalDate, UserProfile } from "@/lib/domain/types";

function requireGoals(versions: GoalVersion[], start: LocalDate): GoalVersion {
  const goals = goalsForWeek(versions, start);
  if (!goals) throw new Error(`No goal version is in effect for the week starting ${start}.`);
  return goals;
}

export async function loadToday() {
  const repo = await getSetUpRepository();
  const [profile, today, goalVersions, reminderSettings] = await Promise.all([
    repo.getProfile(),
    repo.getToday(),
    repo.getGoalVersions(),
    repo.getReminderSettings(),
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
    remindersOn: reminderSettings.deliveryEnabled && reminderEnv().channels.includes(reminderSettings.channel),
    sleepToday,
    eveningToday,
    activitiesToday: weekActivities.filter((a) => a.localDate === today && a.canonicalStatus === "canonical"),
    guidance: evaluateGuidance({ today, sleep: sleepToday, evening: eveningToday, symptoms }),
    progress: computeWeeklyProgress(week, requireGoals(goalVersions, week.start), weekActivities, weekEvening, today),
  };
}

/**
 * The check-in date requested in the URL (for editing an earlier day), or
 * today. Future dates fall back to today: check-ins describe days that began.
 */
function checkInDate(requested: string | undefined, today: LocalDate): LocalDate {
  return requested && isLocalDate(requested) && requested <= today ? requested : today;
}

export async function loadMorningCheckIn(requestedDate?: string) {
  const repo = await getSetUpRepository();
  const [profile, today] = await Promise.all([repo.getProfile(), repo.getToday()]);
  const date = checkInDate(requestedDate, today);
  const [sleep, symptoms] = await Promise.all([
    repo.listSleepEntries({ start: date, end: date }),
    repo.listSymptomEntries({ start: addDays(date, -7), end: date }),
  ]);
  const existing = sleep[0] ?? null;
  const symptom = symptoms.find((s) => existing?.symptomEntryId && s.id === existing.symptomEntryId) ?? null;
  const lastSymptom =
    symptoms
      .filter((s) => s.localDate < date)
      .sort((a, b) => (a.observedAt < b.observedAt ? 1 : -1))[0] ?? null;
  return { isSample: repo.isSample, profile, today, date, existing, symptom, lastSymptom };
}

export async function loadEveningCheckIn(requestedDate?: string) {
  const repo = await getSetUpRepository();
  const [profile, today] = await Promise.all([repo.getProfile(), repo.getToday()]);
  const date = checkInDate(requestedDate, today);
  const range = { start: date, end: date };
  const [activities, evening, symptoms] = await Promise.all([
    repo.listActivities(range),
    repo.listEveningEntries(range),
    repo.listSymptomEntries(range),
  ]);
  const existing = evening[0] ?? null;
  return {
    isSample: repo.isSample,
    profile,
    today,
    date,
    activities: activities.filter((a) => a.canonicalStatus === "canonical"),
    existing,
    symptom: symptoms.find((s) => existing?.symptomEntryId && s.id === existing.symptomEntryId) ?? null,
  };
}

export const HISTORY_DAYS = 14;

export async function loadHistory() {
  const repo = await getSetUpRepository();
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
  const repo = await getSetUpRepository();
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

/** Recent reminder occurrences shown as delivery status in Settings. */
export const REMINDER_STATUS_LIMIT = 12;

export async function loadSettings() {
  const repo = await getSetUpRepository();
  const [profile, today, goalVersions, reminderSettings, reminderOccurrences, pushDevice] = await Promise.all([
    repo.getProfile(),
    repo.getToday(),
    repo.getGoalVersions(),
    repo.getReminderSettings(),
    repo.listReminderOccurrences(REMINDER_STATUS_LIMIT),
    repo.getPushDevice(),
  ]);
  const env = reminderEnv();
  const user = await getCurrentUser();
  return {
    isSample: repo.isSample,
    dataSource: repo.kind,
    email: user.email,
    profile,
    today,
    schedule: targetSchedule(goalVersions, today),
    timezones: timezoneOptions(profile.timezone),
    reminders: {
      settings: reminderSettings,
      occurrences: reminderOccurrences,
      pushDevice,
      /** Channels this server can send. Secrets never leave the server. */
      channels: env.channels,
      /** Public by design: the browser needs it to subscribe. */
      vapidPublicKey: env.configured ? (env.env.push?.vapidPublicKey ?? null) : null,
    },
  };
}

/** First-use setup. `done` is true once it was finished (sample mode can still preview it). */
export async function loadWelcome() {
  const repo = await getRepository();
  const [profile, today, goalVersions] = await Promise.all([
    repo.getProfile(),
    repo.getToday(),
    repo.getGoalVersions(),
  ]);
  return {
    isSample: repo.isSample,
    done: !needsOnboarding(profile),
    profile,
    schedule: targetSchedule(goalVersions, today),
    timezones: timezoneOptions(profile.timezone),
  };
}

function localTime(activity: Activity): string {
  if (activity.startedAt === null) return "";
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: activity.timezone,
  }).format(new Date(activity.startedAt));
}

function measuredSummary(a: Activity, profile: UserProfile): string {
  const { seconds, basis } = goalSeconds(a);
  const parts = [formatTime(a.startedAt, a.timezone), `${formatDuration(seconds)} ${durationBasisLabel[basis]}`];
  if (a.distanceMeters !== null) {
    parts.push(`${distanceFromMeters(a.distanceMeters, profile.distanceUnit).toFixed(2)} ${profile.distanceUnit}`);
  }
  parts.push(a.avgHeartRateBpm === null ? "heart rate not recorded" : `average heart rate ${a.avgHeartRateBpm} bpm`);
  return `${parts.join(" · ")}.`;
}

export async function loadNewActivityForm(requestedDate?: string) {
  const repo = await getSetUpRepository();
  const [profile, today] = await Promise.all([repo.getProfile(), repo.getToday()]);
  return {
    existing: null,
    measured: false,
    values: { localDate: checkInDate(requestedDate, today), startTime: "", durationMinutes: "", distance: "" },
    today,
    distanceUnit: profile.distanceUnit,
    measuredSummary: null,
  };
}

export async function loadEditActivityForm(id: string) {
  const repo = await getSetUpRepository();
  const [profile, today, detail] = await Promise.all([repo.getProfile(), repo.getToday(), repo.getActivity(id)]);
  if (!detail) return null;
  const a = detail.activity;
  const measured = isMeasuredActivity(a);
  return {
    form: {
      existing: a,
      measured,
      values: {
        localDate: a.localDate,
        startTime: localTime(a),
        durationMinutes: String(Math.round(goalSeconds(a).seconds / 60)),
        distance:
          a.distanceMeters === null ? "" : String(Math.round(distanceFromMeters(a.distanceMeters, profile.distanceUnit) * 100) / 100),
      },
      today,
      distanceUnit: profile.distanceUnit,
      measuredSummary: measured ? measuredSummary(a, profile) : null,
    },
    sourceNote:
      detail.sources.length > 1
        ? `This activity combines ${detail.sources.length} sources: ${detail.sources.map((src) => src.sourceKind.toUpperCase()).join(", ")}.`
        : null,
  };
}
