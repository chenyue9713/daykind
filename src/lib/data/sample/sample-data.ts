// SAMPLE DATA — invented records for reviewing the interface only.
// These are not the user's records, a baseline, or a recommendation.
// Dates are generated relative to "today" so every screen has content.
import { addDays, isoWeekdayIndex, zonedTimeToInstant } from "@/lib/domain/dates";
import type {
  Activity,
  ActivityType,
  EveningEntry,
  Fatigue,
  GoalVersion,
  Intensity,
  LocalDate,
  Restfulness,
  SleepEntry,
  SymptomEntry,
  UserProfile,
  WeightEntry,
} from "@/lib/domain/types";

export interface SampleDataset {
  profile: UserProfile;
  goals: GoalVersion[];
  sleep: SleepEntry[];
  evening: EveningEntry[];
  symptoms: SymptomEntry[];
  activities: Activity[];
  weights: WeightEntry[];
}

const DAYS_OF_HISTORY = 21;

export function buildSampleDataset(userId: string, timezone: string, today: LocalDate): SampleDataset {
  const at = (date: LocalDate, time: string) => zonedTimeToInstant(date, time, timezone);
  const owned = (id: string, instant: string) => ({
    id,
    userId,
    createdAt: instant,
    updatedAt: instant,
    revision: 1,
    source: "sample" as const,
  });

  const sleep: SleepEntry[] = [];
  const evening: EveningEntry[] = [];
  const symptoms: SymptomEntry[] = [];
  const activities: Activity[] = [];
  const weights: WeightEntry[] = [];

  const addSleep = (
    date: LocalDate,
    minMinutes: number,
    maxMinutes: number,
    total: number | null,
    baby: number | null,
    restfulness: Restfulness,
    fatigue: Fatigue,
  ) => {
    sleep.push({
      ...owned(`sample-sleep-${date}`, at(date, "10:04")),
      wakingDate: date,
      timezone,
      durationMinSeconds: minMinutes * 60,
      durationMaxSeconds: maxMinutes * 60,
      approximate: minMinutes !== maxMinutes,
      totalInterruptions: total,
      babyInterruptions: baby,
      restfulness,
      morningFatigue: fatigue,
      note: null,
      completionState: "complete",
    });
  };

  const addActivity = (
    date: LocalDate,
    time: string,
    type: ActivityType,
    activeMinutes: number,
    elapsedMinutes: number,
    intensity: Intensity,
    distanceMeters: number | null = null,
  ) => {
    const startedAt = at(date, time);
    activities.push({
      ...owned(`sample-activity-${date}-${time}`, startedAt),
      type,
      startedAt,
      localDate: date,
      timezone,
      elapsedSeconds: elapsedMinutes * 60,
      activeSeconds: activeMinutes * 60,
      reportedSeconds: null,
      durationBasis: "active",
      distanceMeters,
      avgHeartRateBpm: null,
      maxHeartRateBpm: null,
      intensity,
      note: null,
      canonicalStatus: "canonical",
      linkedActivityId: null,
      fieldProvenance: {},
    });
  };

  const addSymptom = (
    date: LocalDate,
    time: string,
    context: SymptomEntry["context"],
    anklePain: number | null,
    flags: Partial<Pick<SymptomEntry, "newOrWorsening" | "flareReported" | "side">> = {},
  ) => {
    symptoms.push({
      ...owned(`sample-symptom-${date}-${time}`, at(date, time)),
      observedAt: at(date, time),
      localDate: date,
      context,
      anklePain,
      side: flags.side ?? (anklePain ? "right" : null),
      flareReported: flags.flareReported ?? false,
      newOrWorsening: flags.newOrWorsening ?? false,
      swellingHeatRedness: false,
      weightBearingDifficulty: false,
      feverOrUnwell: null,
    });
  };

  const addEvening = (
    date: LocalDate,
    status: EveningEntry["activityStatus"],
    fatigue: Fatigue,
    recoveryDay = false,
  ) => {
    evening.push({
      ...owned(`sample-evening-${date}`, at(date, "21:12")),
      localDate: date,
      activityStatus: status,
      eveningFatigue: fatigue,
      recoveryDay,
      completionState: "complete",
    });
  };

  const sleepTemplates: [number, number, number | null, number | null, Restfulness, Fatigue][] = [
    [420, 420, 3, 3, "somewhat_rested", "mildly_tired"],
    [450, 480, 0, 0, "well_rested", "energetic"],
    [330, 360, 4, 3, "poorly_rested", "mildly_tired"],
    [400, 400, 2, 2, "somewhat_rested", "mildly_tired"],
    [390, 420, null, 2, "somewhat_rested", "energetic"],
    [460, 460, 1, 1, "well_rested", "energetic"],
    [300, 300, 5, 4, "poorly_rested", "very_tired"],
  ];

  for (let offset = DAYS_OF_HISTORY - 1; offset >= 1; offset--) {
    const date = addDays(today, -offset);
    const weekday = isoWeekdayIndex(date);

    // Some days are deliberately left unlogged to show missing-data states.
    const skipSleep = offset % 8 === 5;
    const skipEvening = offset % 6 === 3;
    const recoveryDay = offset === 9;

    if (!skipSleep) addSleep(date, ...sleepTemplates[offset % sleepTemplates.length]);
    addSymptom(date, "10:04", "morning", offset % 4 === 0 ? 2 : 0);

    if (recoveryDay) {
      addSymptom(date, "21:12", "evening", 4, { newOrWorsening: true });
      addEvening(date, "confirmed_none", "very_tired", true);
      continue;
    }
    if (skipEvening) continue;

    if (weekday !== 3) {
      if (offset % 5 === 1) {
        // Two short walks accumulate toward the daily walking target.
        addActivity(date, "07:45", "walking", 5, 5, "easy", 420);
        addActivity(date, "17:30", "walking", 5, 6, "easy", 400);
      } else {
        addActivity(date, "12:15", "walking", 12 + (offset % 3) * 4, 14 + (offset % 3) * 4, "easy", 1300);
      }
    }
    if (weekday === 1 || weekday === 4) addActivity(date, "19:00", "resistance", 25, 30, "moderate");
    if (weekday === 2) addActivity(date, "18:10", "cycling", 25, 28, "moderate", 9800);
    if (weekday === 5) addActivity(date, "09:30", "cycling", 35, 41, "easy", 13200);

    addSymptom(date, "21:12", "evening", offset % 4 === 0 ? 1 : 0);
    const hasActivity = activities.some((a) => a.localDate === date);
    addEvening(date, hasActivity ? "logged" : "confirmed_none", offset % 3 === 0 ? "very_tired" : "mildly_tired");

    if (weekday === 0 || weekday === 3 || weekday === 6) {
      weights.push({
        ...owned(`sample-weight-${date}`, at(date, "07:00")),
        measuredAt: at(date, "07:00"),
        localDate: date,
        weightKg: 88.4 - (DAYS_OF_HISTORY - offset) * 0.03 + (offset % 2) * 0.2,
        enteredUnit: "kg",
      });
    }
  }

  // Today: morning check-in complete, evening still due.
  addSleep(today, 360, 405, 3, 3, "somewhat_rested", "mildly_tired");
  addSymptom(today, "10:04", "morning", 1, { side: "right" });
  addActivity(today, "08:20", "walking", 6, 7, "easy", 500);

  return {
    profile: {
      userId,
      displayName: "Sample user",
      timezone,
      timezoneConfirmed: false,
      distanceUnit: "mi",
      weightUnit: "lb",
      weightTrackingEnabled: true,
      guidanceLimitsAcknowledgedAt: null,
      onboardingCompletedAt: null,
      revision: 1,
    },
    goals: [
      {
        id: "sample-goals-1",
        effectiveFrom: "2026-01-05",
        walkingSecondsPerDay: 600,
        resistanceSessionsPerWeek: 2,
        cyclingSecondsPerWeek: 3600,
        revision: 1,
      },
    ],
    sleep,
    evening,
    symptoms,
    activities,
    weights,
  };
}
