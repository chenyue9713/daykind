"use server";

import { redirect, unstable_rethrow } from "next/navigation";

import { getSetUpRepository } from "@/lib/data";
import { parseSymptom, type FieldErrors } from "@/lib/domain/checkins";
import { isLocalDate } from "@/lib/domain/dates";
import {
  fromResult,
  invalid,
  serverFailure,
  staleForm,
  toRaw,
  writeMeta,
  type CheckInFormState,
} from "@/lib/forms/server-form";

/** Records an ankle observation outside a check-in, or edits the one named by `entryId`. */
export async function saveSymptom(_prev: CheckInFormState, formData: FormData): Promise<CheckInFormState> {
  const raw = toRaw(formData);
  const meta = writeMeta(raw);
  if (!meta) return staleForm;
  const errors: FieldErrors = {};
  const symptom = parseSymptom(raw, errors, true);
  if (!symptom) return invalid(errors);
  let savedDate: string | null = null;
  try {
    const repo = await getSetUpRepository();
    const today = await repo.getToday();
    const existing = meta.id ? await repo.getSymptomEntry(meta.id) : null;
    if (meta.id && !existing) {
      return { status: "conflict", message: "Not saved: this entry no longer exists. It may have been deleted on another device.", errors: {} };
    }
    // An edit keeps when the observation was made; a new one is observed now, today.
    const localDate = existing?.localDate ?? (raw.localDate && isLocalDate(raw.localDate) ? raw.localDate : today);
    if (localDate > today) errors.localDate = "The date can't be in the future.";
    if (Object.keys(errors).length > 0) return invalid(errors);

    const result = await repo.saveSymptomEntry(
      existing?.id ?? null,
      { localDate, observedAt: existing?.observedAt ?? new Date().toISOString(), symptom },
      meta,
    );
    if (result.status !== "saved") return fromResult(result);
    savedDate = localDate;
  } catch (error) {
    unstable_rethrow(error);
    return serverFailure;
  }
  redirect(`/history#day-${savedDate}`);
}
