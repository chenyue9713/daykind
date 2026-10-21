import type { ActivityType, Fatigue, Intensity, Restfulness } from "./types";

/** Formats seconds as "7 h 30 min" without rounding a threshold into completion. */
export function formatDuration(seconds: number | null): string {
  if (seconds === null) return "Unknown";
  const totalMinutes = Math.floor(seconds / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

export function formatSleepDuration(min: number | null, max: number | null): string {
  if (min === null || max === null) return "Not recorded";
  if (min === max) return formatDuration(min);
  return `${formatDuration(min)} – ${formatDuration(max)} (estimate)`;
}

export function formatCount(value: number | null): string {
  return value === null ? "Unknown" : String(value);
}

export const restfulnessLabel: Record<Restfulness, string> = {
  well_rested: "Well rested",
  somewhat_rested: "Somewhat rested",
  poorly_rested: "Poorly rested",
};

export const fatigueLabel: Record<Fatigue, string> = {
  energetic: "Energetic",
  mildly_tired: "Mildly tired",
  very_tired: "Very tired",
};

export const activityTypeLabel: Record<ActivityType, string> = {
  walking: "Walk",
  cycling: "Ride",
  resistance: "Resistance session",
  other: "Other activity",
};

export const intensityLabel: Record<Intensity, string> = {
  easy: "Easy",
  moderate: "Moderate",
  hard: "Hard",
  unknown: "Intensity unknown",
};

export function formatWeight(kg: number, unit: "kg" | "lb"): string {
  return unit === "kg" ? `${kg.toFixed(1)} kg` : `${(kg / 0.45359237).toFixed(1)} lb`;
}
