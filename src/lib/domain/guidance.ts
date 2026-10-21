// Deterministic, explainable recovery guidance (PRD FR06).
// This is not a medical readiness score. Wording is draft text that still
// requires review against the user's own care guidance before real use.
import { formatLocalDate } from "./dates";
import { fatigueLabel, formatSleepDuration, restfulnessLabel } from "./format";
import type { EveningEntry, Instant, LocalDate, SleepEntry, SymptomEntry } from "./types";

export const GUIDANCE_RULE_VERSION = "draft-2026-10-20.1";

/** Proposed product heuristic, not a clinical boundary (PRD Section 15). */
export const LIGHTER_DAY_SLEEP_SECONDS = 6 * 3600;

export type GuidanceCategory =
  | "symptom_warning"
  | "recovery_priority"
  | "lighter_day"
  | "ordinary_day"
  | "incomplete";

export interface GuidanceReason {
  text: string;
  /** When the underlying input was recorded, for freshness labels. */
  recordedAt?: Instant;
}

export interface GuidanceResult {
  ruleVersion: string;
  category: GuidanceCategory;
  headline: string;
  message: string;
  reasons: GuidanceReason[];
  /** Inputs that are missing and would make the guidance more complete. */
  missing: string[];
  /** Shown when the latest symptom entry is from an earlier day. */
  staleSymptomNote: string | null;
  /** When true, the UI must not show exercise encouragement or target catch-up prompts. */
  suppressActivityPrompts: boolean;
}

export interface GuidanceInput {
  today: LocalDate;
  sleep: SleepEntry | null;
  evening: EveningEntry | null;
  /** Recent symptom observations, any order. */
  symptoms: SymptomEntry[];
}

const copy: Record<GuidanceCategory, { headline: string; message: string }> = {
  symptom_warning: {
    headline: "Please get medical advice",
    message:
      "Sudden joint pain and swelling together with worsening pain, fever, shivering, or feeling unwell can need urgent assessment. Contact a healthcare professional or your local urgent care service. DayKind cannot tell what is causing these symptoms.",
  },
  recovery_priority: {
    headline: "Recovery comes first today",
    message:
      "Rest from painful loading and follow your existing care plan. Your targets will still be here; today is not a day to catch up. If symptoms are new or not improving, consider contacting a healthcare professional.",
  },
  lighter_day: {
    headline: "Consider a lighter day",
    message:
      "A lower-demand day may be more manageable. If walking feels comfortable, a short easy walk is one option. Cycling is not automatically easier on a sore ankle. Stop if symptoms get worse.",
  },
  ordinary_day: {
    headline: "Your usual modest plan looks reasonable",
    message:
      "Based on what you recorded, your usual plan, such as the ten-minute walk or a planned resistance session, looks reasonable. This is not medical clearance or a reason to increase intensity.",
  },
  incomplete: {
    headline: "Not enough information yet",
    message:
      "Some of today's inputs are missing, so DayKind cannot suggest a plan. Complete the check-in for a fuller suggestion.",
  },
};

function latestFirst(a: SymptomEntry, b: SymptomEntry): number {
  return a.observedAt < b.observedAt ? 1 : -1;
}

export function evaluateGuidance(input: GuidanceInput): GuidanceResult {
  const { today, sleep, evening } = input;
  const sorted = [...input.symptoms].sort(latestFirst);
  const current = sorted.find((s) => s.localDate === today) ?? null;
  const previous = current ? null : (sorted.find((s) => s.localDate < today) ?? null);

  const completeSleep = sleep && sleep.completionState === "complete" ? sleep : null;
  const fatigue = evening?.eveningFatigue ?? completeSleep?.morningFatigue ?? null;
  const fatigueAt = evening?.eveningFatigue ? evening.updatedAt : completeSleep?.updatedAt;

  const missing: string[] = [];
  if (!completeSleep || completeSleep.durationMinSeconds === null) missing.push("today's sleep");
  if (!fatigue) missing.push("how tired you feel");
  if (!current || current.anklePain === null) missing.push("current ankle status");

  const staleSymptomNote = previous
    ? `Your last ankle entry was on ${formatLocalDate(previous.localDate)}. It is not treated as current.`
    : null;

  const result = (
    category: GuidanceCategory,
    reasons: GuidanceReason[],
    suppressActivityPrompts: boolean,
  ): GuidanceResult => ({
    ruleVersion: GUIDANCE_RULE_VERSION,
    category,
    ...copy[category],
    reasons,
    missing,
    staleSymptomNote,
    suppressActivityPrompts,
  });

  // 1. Joint symptom warning — applies even when other data are missing.
  if (current?.swellingHeatRedness && (current.newOrWorsening || current.feverOrUnwell)) {
    const detail = [
      "swelling, heat, or redness",
      current.newOrWorsening ? "new or worsening pain" : null,
      current.feverOrUnwell ? "fever or feeling unwell" : null,
    ]
      .filter(Boolean)
      .join(", ");
    return result(
      "symptom_warning",
      [{ text: `You reported ${detail}.`, recordedAt: current.observedAt }],
      true,
    );
  }

  // 2. Recovery priority.
  const recovery: GuidanceReason[] = [];
  if (current?.flareReported) recovery.push({ text: "You reported a flare.", recordedAt: current.observedAt });
  if (current?.newOrWorsening)
    recovery.push({ text: "You reported new or worsening ankle pain.", recordedAt: current.observedAt });
  if (current?.weightBearingDifficulty)
    recovery.push({ text: "You reported difficulty bearing weight.", recordedAt: current.observedAt });
  if (fatigue === "very_tired") recovery.push({ text: "You reported feeling very tired.", recordedAt: fatigueAt });
  if (recovery.length > 0) return result("recovery_priority", recovery, true);

  // 3. Lighter day.
  const lighter: GuidanceReason[] = [];
  if (completeSleep?.restfulness === "poorly_rested")
    lighter.push({ text: "You felt poorly rested.", recordedAt: completeSleep.updatedAt });
  if (completeSleep && completeSleep.durationMinSeconds !== null) {
    const { durationMinSeconds: min, durationMaxSeconds: max } = completeSleep;
    // Ranges spanning the threshold use the lower bound conservatively.
    if (min < LIGHTER_DAY_SLEEP_SECONDS) {
      const spans = max !== null && max >= LIGHTER_DAY_SLEEP_SECONDS;
      lighter.push({
        text: spans
          ? `Your sleep estimate (${formatSleepDuration(min, max)}) may be under six hours; the lower end is used.`
          : `You recorded ${formatSleepDuration(min, max)} of sleep, under the proposed six-hour marker.`,
        recordedAt: completeSleep.updatedAt,
      });
    }
  }
  if (fatigue === "mildly_tired") lighter.push({ text: "You reported feeling mildly tired.", recordedAt: fatigueAt });
  if (current && current.anklePain !== null && current.anklePain > 0)
    lighter.push({ text: `You reported ankle pain of ${current.anklePain}/10.`, recordedAt: current.observedAt });
  if (lighter.length > 0) return result("lighter_day", lighter, false);

  // 5. Incomplete data never yields an unconditional all-clear.
  if (missing.length > 0) return result("incomplete", [], false);

  // 4. Ordinary day.
  const ordinary: GuidanceReason[] = [];
  if (completeSleep) {
    ordinary.push({
      text: `You recorded ${formatSleepDuration(completeSleep.durationMinSeconds, completeSleep.durationMaxSeconds)} of sleep${
        completeSleep.restfulness ? ` and felt ${restfulnessLabel[completeSleep.restfulness].toLowerCase()}` : ""
      }.`,
      recordedAt: completeSleep.updatedAt,
    });
  }
  if (fatigue) ordinary.push({ text: `You reported feeling ${fatigueLabel[fatigue].toLowerCase()}.`, recordedAt: fatigueAt });
  if (current) ordinary.push({ text: "You reported no ankle pain or symptom flags today.", recordedAt: current.observedAt });
  return result("ordinary_day", ordinary, false);
}
