"use server";

import { getRepository, type SaveResult } from "@/lib/data";
import {
  validateEveningCheckIn,
  validateMorningCheckIn,
  type FieldErrors,
  type RawForm,
} from "@/lib/domain/checkins";

export interface CheckInFormState {
  status: "idle" | "invalid" | "saved" | "not_persisted" | "failed";
  message: string | null;
  errors: FieldErrors;
}

function toRaw(formData: FormData): RawForm {
  const raw: RawForm = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") raw[key] = value;
  }
  return raw;
}

const invalid = (errors: FieldErrors): CheckInFormState => ({
  status: "invalid",
  message: "Some answers need attention. Nothing you entered was cleared.",
  errors,
});

function fromSave(result: SaveResult): CheckInFormState {
  switch (result.status) {
    case "saved":
      return { status: "saved", message: "Saved.", errors: {} };
    case "not_persisted":
      return { status: "not_persisted", message: result.reason, errors: {} };
    case "failed":
      return { status: "failed", message: `Not saved: ${result.reason} Your answers are still here.`, errors: {} };
  }
}

export async function submitMorningCheckIn(_prev: CheckInFormState, formData: FormData): Promise<CheckInFormState> {
  const parsed = validateMorningCheckIn(toRaw(formData));
  if (!parsed.ok) return invalid(parsed.errors);
  try {
    const repo = await getRepository();
    return fromSave(await repo.saveMorningCheckIn(parsed.value));
  } catch {
    return fromSave({ status: "failed", reason: "The server could not save this check-in." });
  }
}

export async function submitEveningCheckIn(_prev: CheckInFormState, formData: FormData): Promise<CheckInFormState> {
  try {
    const repo = await getRepository();
    const raw = toRaw(formData);
    const date = raw.localDate ?? (await repo.getToday());
    // Count existing activities server-side; never trust the client for conflicts.
    const existing = (await repo.listActivities({ start: date, end: date })).filter(
      (a) => a.canonicalStatus === "canonical",
    );
    const parsed = validateEveningCheckIn(raw, existing.length);
    if (!parsed.ok) return invalid(parsed.errors);
    return fromSave(await repo.saveEveningCheckIn(parsed.value));
  } catch {
    return fromSave({ status: "failed", reason: "The server could not save this check-in." });
  }
}
