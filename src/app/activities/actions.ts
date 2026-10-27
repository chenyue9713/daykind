"use server";

import { redirect, unstable_rethrow } from "next/navigation";

import { getSetUpRepository } from "@/lib/data";
import { parseActivityForm } from "@/lib/domain/activity-form";
import {
  fromResult,
  invalid,
  serverFailure,
  staleForm,
  toRaw,
  writeMeta,
  type CheckInFormState,
} from "@/lib/forms/server-form";

/** Creates a manual activity, or edits the one named by `entryId`. */
export async function saveActivity(_prev: CheckInFormState, formData: FormData): Promise<CheckInFormState> {
  const raw = toRaw(formData);
  const meta = writeMeta(raw);
  if (!meta) return staleForm;
  let savedDate: string | null = null;
  try {
    const repo = await getSetUpRepository();
    const [profile, today] = await Promise.all([repo.getProfile(), repo.getToday()]);
    const existing = meta.id ? await repo.getActivity(meta.id) : null;
    if (meta.id && !existing) {
      return { status: "conflict", message: "Not saved: this activity no longer exists. It may have been deleted on another device.", errors: {} };
    }
    const parsed = parseActivityForm(raw, {
      existing: existing?.activity ?? null,
      timezone: profile.timezone,
      today,
      distanceUnit: profile.distanceUnit,
    });
    if (!parsed.ok) return invalid(parsed.errors);

    const result = existing
      ? await repo.updateActivity(existing.activity.id, parsed.value, meta)
      : await repo.createActivity(parsed.value, meta);
    if (result.status !== "saved") return fromResult(result);
    savedDate = parsed.value.localDate;
  } catch (error) {
    unstable_rethrow(error);
    return serverFailure;
  }
  redirect(`/history#day-${savedDate}`);
}
