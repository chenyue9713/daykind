import { connection } from "next/server";

import { isSuspectedDuplicate } from "@/lib/domain/activity";
import { inRange, localDateOf } from "@/lib/domain/dates";
import { DEFAULT_REMINDER_SETTINGS } from "@/lib/domain/reminders";
import type { DateRange } from "@/lib/domain/types";
import type { DayKindRepository } from "../repository";
import { buildSampleDataset, type SampleDataset } from "./sample-data";

interface Options {
  userId: string;
  timezone: string;
}

const NOT_PERSISTED = {
  status: "not_persisted",
  reason: "Sample mode: your entry passed validation but was not saved. Storage is not connected yet.",
} as const;

/** Read-only repository over generated sample data. Writes are validated but never stored. */
export function createSampleRepository({ userId, timezone }: Options): DayKindRepository {
  let dataset: Promise<{ today: string; data: SampleDataset }> | null = null;

  const load = () => {
    dataset ??= (async () => {
      // Sample data depends on the current date, so it must be read at request time.
      await connection();
      const today = localDateOf(new Date(), timezone);
      return { today, data: buildSampleDataset(userId, timezone, today) };
    })();
    return dataset;
  };

  const byRange = <T>(pick: (d: SampleDataset) => T[], dateOf: (item: T) => string) => {
    return async (range: DateRange) => pick((await load()).data).filter((item) => inRange(dateOf(item), range));
  };

  return {
    kind: "sample",
    isSample: true,
    getProfile: async () => (await load()).data.profile,
    getGoalVersions: async () => (await load()).data.goals,
    savePreferences: async () => NOT_PERSISTED,
    saveTargets: async () => NOT_PERSISTED,
    getToday: async () => (await load()).today,
    listSleepEntries: byRange((d) => d.sleep, (s) => s.wakingDate),
    listEveningEntries: byRange((d) => d.evening, (e) => e.localDate),
    listSymptomEntries: byRange((d) => d.symptoms, (s) => s.localDate),
    listActivities: byRange((d) => d.activities, (a) => a.localDate),
    listWeightEntries: byRange((d) => d.weights, (w) => w.localDate),
    getActivity: async (id) => {
      const activity = (await load()).data.activities.find((a) => a.id === id);
      return activity ? { activity, sources: [] } : null;
    },
    findDuplicateCandidates: async (probe) =>
      (await load()).data.activities.filter((a) => isSuspectedDuplicate(probe, a)),
    findImportedFile: async () => null,
    saveConfirmedImport: async () => NOT_PERSISTED,
    createActivity: async () => NOT_PERSISTED,
    updateActivity: async () => NOT_PERSISTED,
    deleteActivity: async () => NOT_PERSISTED,
    saveMorningCheckIn: async () => NOT_PERSISTED,
    saveEveningCheckIn: async () => NOT_PERSISTED,
    deleteSleepEntry: async () => NOT_PERSISTED,
    deleteEveningEntry: async () => NOT_PERSISTED,
    getSymptomEntry: async (id) => (await load()).data.symptoms.find((s) => s.id === id) ?? null,
    saveSymptomEntry: async () => NOT_PERSISTED,
    deleteSymptomEntry: async () => NOT_PERSISTED,
    getReminderSettings: async () => DEFAULT_REMINDER_SETTINGS,
    saveReminderSettings: async () => NOT_PERSISTED,
    listReminderOccurrences: async () => [],
    requestTestReminder: async () => NOT_PERSISTED,
    getPushDevice: async () => null,
    savePushDevice: async () => NOT_PERSISTED,
    removePushDevice: async () => NOT_PERSISTED,
  };
}
