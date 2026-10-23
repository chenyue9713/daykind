"use server";

import { redirect, unstable_rethrow } from "next/navigation";

import { getRepository, getSetUpRepository, type MutationResult, type TargetChange, type WriteMeta } from "@/lib/data";
import { UUID_PATTERN, type RawForm } from "@/lib/domain/checkins";
import { formatLocalDate } from "@/lib/domain/dates";
import { targetSchedule, validateOnboarding, validatePreferences, validateTargets, type TargetsInput } from "@/lib/domain/preferences";
import {
  fromResult,
  invalid,
  staleForm,
  toRaw,
  writeMeta,
  type CheckInFormState,
} from "@/lib/forms/server-form";

const saveFailure: CheckInFormState = {
  status: "failed",
  message: "Not saved: the server could not save your preferences. Your choices are still here — try again.",
  errors: {},
};

/** The pending target version the form was showing, so an edit updates it instead of adding another. */
function pendingTarget(raw: RawForm): { pendingId: string | null; expectedRevision: number | null } {
  const pendingId = raw.pendingId && UUID_PATTERN.test(raw.pendingId) ? raw.pendingId : null;
  const revision = Number(raw.pendingRevision);
  return { pendingId, expectedRevision: pendingId && Number.isInteger(revision) && revision > 0 ? revision : null };
}

function describeChange(change: TargetChange): string {
  switch (change.outcome) {
    case "scheduled":
      return `Saved. The new targets start ${formatLocalDate(change.version!.effectiveFrom, "long")}. This week keeps its current targets.`;
    case "removed":
      return "Saved. The upcoming change was removed, so your targets stay as they are.";
    case "unchanged":
      return "These are already your targets, so nothing changed.";
  }
}

function targetState(result: MutationResult<TargetChange>): CheckInFormState {
  const state = fromResult(result);
  return result.status === "saved" ? { ...state, message: describeChange(result.record) } : state;
}

/** Settings: timezone, units, and weight tracking. Saving confirms the timezone. */
export async function savePreferences(_prev: CheckInFormState, formData: FormData): Promise<CheckInFormState> {
  const raw = toRaw(formData);
  const meta = writeMeta(raw);
  if (!meta) return staleForm;
  const parsed = validatePreferences(raw);
  if (!parsed.ok) return invalid(parsed.errors);
  try {
    const repo = await getSetUpRepository();
    const state = fromResult(await repo.savePreferences({ preferences: parsed.value }, meta));
    return state.status === "saved"
      ? { ...state, message: "Saved. New entries use these settings; records you already saved keep their own dates." }
      : state;
  } catch (error) {
    unstable_rethrow(error);
    return saveFailure;
  }
}

/**
 * Settings: weekly targets, saved as the version starting next Monday in the
 * confirmed timezone. "Discard" sends the targets in effect, which removes the
 * pending version.
 */
export async function saveTargets(_prev: CheckInFormState, formData: FormData): Promise<CheckInFormState> {
  const raw = toRaw(formData);
  const meta = writeMeta(raw);
  if (!meta) return staleForm;
  try {
    const repo = await getSetUpRepository();
    const { pendingId, expectedRevision } = pendingTarget(raw);
    const targetMeta: WriteMeta = { requestId: meta.requestId, id: pendingId, expectedRevision };
    let values: TargetsInput;
    if (raw.intent === "discard") {
      const { current } = targetSchedule(await repo.getGoalVersions(), await repo.getToday());
      values = {
        walkingSecondsPerDay: current.walkingSecondsPerDay,
        resistanceSessionsPerWeek: current.resistanceSessionsPerWeek,
        cyclingSecondsPerWeek: current.cyclingSecondsPerWeek,
      };
    } else {
      const parsed = validateTargets(raw);
      if (!parsed.ok) return invalid(parsed.errors);
      values = parsed.value;
    }
    return targetState(await repo.saveTargets(values, targetMeta));
  } catch (error) {
    unstable_rethrow(error);
    return saveFailure;
  }
}

/** First-use setup: preferences, targets, and the guidance acknowledgment, saved together. */
export async function completeOnboarding(_prev: CheckInFormState, formData: FormData): Promise<CheckInFormState> {
  const raw = toRaw(formData);
  const meta = writeMeta(raw);
  if (!meta) return staleForm;
  const parsed = validateOnboarding(raw);
  if (!parsed.ok) return invalid(parsed.errors);
  try {
    const repo = await getRepository();
    const result = await repo.savePreferences(
      {
        preferences: parsed.value.preferences,
        targets: { values: parsed.value.targets, ...pendingTarget(raw) },
        acknowledgeGuidance: true,
        completeOnboarding: true,
      },
      meta,
    );
    if (result.status !== "saved") return fromResult(result);
  } catch (error) {
    unstable_rethrow(error);
    return saveFailure;
  }
  redirect("/");
}
