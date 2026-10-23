// Display wording for the import preview. Pure and client-safe.
import { formatDuration } from "@/lib/domain/format";
import type { DateConfidence, HeartRateSummary, SessionPreview } from "./types";

export { formatDistance } from "@/lib/domain/units";

export function describeDuration(s: Pick<SessionPreview, "durationBasis" | "goalSeconds" | "elapsedSeconds" | "pausedSeconds">): {
  main: string;
  detail: string | null;
  fallback: boolean;
} {
  if (s.durationBasis === "active") {
    const parts: string[] = [];
    if (s.elapsedSeconds !== null) parts.push(`${formatDuration(s.elapsedSeconds)} elapsed`);
    if (s.pausedSeconds !== null && s.pausedSeconds >= 60) parts.push(`${formatDuration(s.pausedSeconds)} paused, not counted`);
    else if (s.pausedSeconds !== null) parts.push("no pauses");
    return { main: `${formatDuration(s.goalSeconds)} active (timer)`, detail: parts.join(" · ") || null, fallback: false };
  }
  if (s.durationBasis === "elapsed") {
    return {
      main: `${formatDuration(s.goalSeconds)} elapsed`,
      detail: "No timer time in the file, so any pauses are included.",
      fallback: true,
    };
  }
  return { main: "Unknown", detail: null, fallback: false };
}

export function describeHeartRate(hr: HeartRateSummary): { main: string; detail: string | null } {
  if (hr.basis === "none" || (hr.avgBpm === null && hr.maxBpm === null)) return { main: "Not recorded", detail: null };
  const parts = [hr.avgBpm !== null ? `${hr.avgBpm} bpm average` : null, hr.maxBpm !== null ? `${hr.maxBpm} bpm max` : null].filter(Boolean);
  const pct = hr.coverage !== null ? Math.round(hr.coverage * 100) : null;
  let detail: string | null;
  if (hr.basis === "device_summary") {
    detail = pct !== null && pct < 100 ? `From the device's summary; covers ${pct}% of active time.` : "From the device's summary.";
  } else if (hr.avgBpm === null) {
    detail = `No average shown: heart rate covered only ${pct ?? 0}% of the workout.`;
  } else {
    detail = `Calculated from samples covering ${pct}% of active time.`;
  }
  return { main: parts.join(" · ") || "Not recorded", detail };
}

export const dateConfidenceLabel: Record<DateConfidence, string> = {
  device_offset_matches: "The watch recorded local time, matching your timezone.",
  device_offset_differs_same_date: "The watch was set to a different timezone, but the date is the same.",
  device_offset_differs: "The watch was set to a different timezone, which gives a different date. Choose which is right.",
  assumed_profile_timezone: "The file does not say which timezone it was recorded in. Confirm the day.",
  floating_time: "The file's times have no timezone, so they were read as local time. Confirm the day.",
};
