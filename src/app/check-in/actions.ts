"use server";

import { refresh } from "next/cache";
import { unstable_rethrow } from "next/navigation";

import { getSetUpRepository, type DeleteInput } from "@/lib/data";
import { UUID_PATTERN, validateEveningCheckIn, validateMorningCheckIn } from "@/lib/domain/checkins";
import {
  fromResult,
  invalid,
  serverFailure,
  staleForm,
  toRaw,
  writeMeta,
  type CheckInFormState,
} from "@/lib/forms/server-form";

export type { CheckInFormState };

export async function submitMorningCheckIn(_prev: CheckInFormState, formData: FormData): Promise<CheckInFormState> {
  const raw = toRaw(formData);
  const meta = writeMeta(raw);
  if (!meta) return staleForm;
  const parsed = validateMorningCheckIn(raw);
  if (!parsed.ok) return invalid(parsed.errors);
  try {
    const repo = await getSetUpRepository();
    // Sleep belongs to the waking date, which cannot be later than today in the user's timezone.
    if (parsed.value.wakingDate > (await repo.getToday())) {
      return invalid({ wakingDate: "The waking date can't be in the future." });
    }
    return fromResult(await repo.saveMorningCheckIn(parsed.value, meta));
  } catch (error) {
    unstable_rethrow(error);
    return serverFailure;
  }
}

export async function submitEveningCheckIn(_prev: CheckInFormState, formData: FormData): Promise<CheckInFormState> {
  const raw = toRaw(formData);
  const meta = writeMeta(raw);
  if (!meta) return staleForm;
  try {
    const repo = await getSetUpRepository();
    const today = await repo.getToday();
    const date = raw.localDate ?? today;
    if (date > today) return invalid({ localDate: "An evening check-in can't be for a future date." });
    // Count existing activities server-side; never trust the client for conflicts.
    const existing = (await repo.listActivities({ start: date, end: date })).filter(
      (a) => a.canonicalStatus === "canonical",
    );
    const parsed = validateEveningCheckIn(raw, existing.length);
    if (!parsed.ok) return invalid(parsed.errors);
    return fromResult(await repo.saveEveningCheckIn(parsed.value, meta));
  } catch (error) {
    unstable_rethrow(error);
    return serverFailure;
  }
}

export type RecordKind = "sleep" | "evening" | "symptom" | "activity";

export interface DeleteState {
  status: "idle" | "deleted" | "failed";
  message: string | null;
}

export async function deleteRecord(kind: RecordKind, input: DeleteInput): Promise<DeleteState> {
  if (!UUID_PATTERN.test(input.id) || !Number.isInteger(input.expectedRevision)) {
    return { status: "failed", message: "Not deleted: reload the page and try again." };
  }
  try {
    const repo = await getSetUpRepository();
    const remove = {
      sleep: repo.deleteSleepEntry,
      evening: repo.deleteEveningEntry,
      symptom: repo.deleteSymptomEntry,
      activity: repo.deleteActivity,
    }[kind];
    const result = await remove(input);
    if (result.status === "saved") {
      refresh();
      return { status: "deleted", message: "Deleted." };
    }
    return { status: "failed", message: `Not deleted: ${"reason" in result ? result.reason : "try again."}` };
  } catch (error) {
    unstable_rethrow(error);
    return { status: "failed", message: "Not deleted: the server could not be reached. Try again." };
  }
}
