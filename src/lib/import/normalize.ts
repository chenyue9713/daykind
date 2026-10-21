// Interprets a ParsedSession for DayKind (PRD FR04, FR05): activity type,
// local date and timezone, duration basis, and which values are missing.
// Pure; duplicate candidates are added by the import service.
import { MAX_ACTIVITY_SECONDS, measuredDurationBasis } from "@/lib/domain/activity";
import { formatLocalDate, formatTime } from "@/lib/domain/dates";
import type { ActivityType } from "@/lib/domain/types";
import { MAX_SANE_DISTANCE_METERS } from "./limits";
import {
  floatingToInstant,
  formatOffset,
  localDateAtOffset,
  localDateOf,
  offsetMinutesAt,
  timezoneForOffset,
} from "./time";
import type {
  DateConfidence,
  ParsedSession,
  PreviewProvenance,
  RequiredConfirmation,
  SessionPreview,
  TimezoneCandidate,
  WorkoutFormat,
} from "./types";

export const ACTIVITY_TYPES: readonly ActivityType[] = ["walking", "cycling", "resistance", "other"];

/** Below this average speed (m/s, about 7 km/h) an ambiguous on-foot session is suggested as a walk. */
const WALKING_SPEED_LIMIT = 2.0;

export interface SportMapping {
  type: ActivityType | null;
  label: string;
  suggestion: ActivityType | null;
  suggestionReason: string | null;
}

const humanize = (value: string) => value.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

function speedSuggestion(distance: number | null, seconds: number | null): Pick<SportMapping, "suggestion" | "suggestionReason"> {
  if (!distance || !seconds || seconds <= 0) return { suggestion: null, suggestionReason: null };
  const speed = distance / seconds;
  if (speed > 0.3 && speed < WALKING_SPEED_LIMIT) {
    return { suggestion: "walking", suggestionReason: `Average pace (${(speed * 3.6).toFixed(1)} km/h) looks like walking.` };
  }
  return { suggestion: null, suggestionReason: null };
}

/** Maps the file's sport to a DayKind type, or null when the user must choose. */
export function mapSport(
  format: WorkoutFormat,
  sport: string | null,
  subSport: string | null,
  distance: number | null,
  seconds: number | null,
): SportMapping {
  const known = (type: ActivityType, label: string): SportMapping => ({ type, label, suggestion: null, suggestionReason: null });
  const ambiguous = (label: string, extra?: Partial<SportMapping>): SportMapping => ({
    type: null,
    label,
    ...speedSuggestion(distance, seconds),
    ...extra,
  });

  if (format === "tcx") {
    const label = sport ? `${sport} (TCX)` : "No sport recorded (TCX)";
    if (sport === "Biking") return known("cycling", label);
    // TCX only knows Running, Biking, and Other; Garmin exports walks, runs,
    // and strength sessions as Running or Other, so the user must choose.
    return ambiguous(label);
  }

  const label = [sport, subSport && subSport !== "generic" ? subSport : null].filter(Boolean).map((v) => humanize(v!)).join(" · ") || "No sport recorded";
  const sub = subSport ?? "generic";
  if (sport === "cycling" || sport === "e_biking") return known("cycling", label);
  if (["indoor_cycling", "spin", "e_bike_fitness"].includes(sub)) return known("cycling", label);
  if (sport === "walking" || ["indoor_walking", "casual_walking", "speed_walking"].includes(sub)) return known("walking", label);
  if (sub === "strength_training" && (sport === "training" || sport === "fitness_equipment")) return known("resistance", label);
  if (sport === "hiking") {
    return ambiguous(label, { suggestion: "walking", suggestionReason: "Hikes usually count as walking; confirm that this one should." });
  }
  if (sport === null || sport === "generic") return ambiguous(label);
  if ((sport === "training" || sport === "fitness_equipment") && sub === "generic") return ambiguous(label);
  return known("other", label);
}

interface TimezoneResolution {
  startedAt: string;
  confidence: DateConfidence;
  candidates: TimezoneCandidate[];
  needsConfirmation: boolean;
}

function candidate(startedAt: string, timezone: string, label: string): TimezoneCandidate {
  const localDate = localDateOf(startedAt, timezone);
  return { timezone, localDate, label: `${formatLocalDate(localDate)} · ${formatTime(startedAt, timezone)} ${label}` };
}

export function resolveTimezone(session: ParsedSession, profileTimezone: string): TimezoneResolution | null {
  if (!session.startedAt) return null;
  const yours = `in ${profileTimezone} (your timezone)`;

  if (session.startIsFloating) {
    const startedAt = floatingToInstant(session.startedAt, profileTimezone);
    return {
      startedAt,
      confidence: "floating_time",
      candidates: [candidate(startedAt, profileTimezone, yours)],
      needsConfirmation: true,
    };
  }

  const startedAt = session.startedAt;
  const profile = candidate(startedAt, profileTimezone, yours);
  if (session.utcOffsetMinutes === null) {
    return { startedAt, confidence: "assumed_profile_timezone", candidates: [profile], needsConfirmation: true };
  }
  if (session.utcOffsetMinutes === offsetMinutesAt(profileTimezone, startedAt)) {
    return { startedAt, confidence: "device_offset_matches", candidates: [profile], needsConfirmation: false };
  }

  const deviceZone = timezoneForOffset(session.utcOffsetMinutes, startedAt);
  const deviceDate = localDateAtOffset(startedAt, session.utcOffsetMinutes);
  const sameDate = deviceDate === profile.localDate;
  const candidates = [profile];
  if (deviceZone) candidates.push(candidate(startedAt, deviceZone, `on the watch (${formatOffset(session.utcOffsetMinutes)})`));
  return {
    startedAt,
    confidence: sameDate ? "device_offset_differs_same_date" : "device_offset_differs",
    candidates,
    needsConfirmation: !sameDate,
  };
}

export interface NormalizeContext {
  format: WorkoutFormat;
  profileTimezone: string;
  now: Date;
}

/** Builds the preview for one session, without duplicate candidates. */
export function normalizeSession(session: ParsedSession, ctx: NormalizeContext): SessionPreview {
  const errors = [...session.errors];
  const warnings = [...session.warnings];
  const required: RequiredConfirmation[] = [];

  const tz = resolveTimezone(session, ctx.profileTimezone);
  if (tz) {
    const start = Date.parse(tz.startedAt);
    if (start < Date.UTC(2000, 0, 1) || start > ctx.now.getTime() + 86_400_000) {
      errors.push("The recorded date is impossible (before 2000 or in the future). Check the watch's clock, or add this workout manually.");
    }
    if (tz.needsConfirmation) required.push("timezone");
  }

  // Durations: elapsed includes pauses; timer (active) excludes them.
  let elapsed = session.elapsedSeconds;
  const elapsedProvenance: PreviewProvenance = elapsed === null ? "absent" : session.elapsedSource === "derived" ? "derived" : "device";
  if (elapsed !== null && elapsed > MAX_ACTIVITY_SECONDS) {
    errors.push("This session is longer than 24 hours, which DayKind cannot store. Add it manually with the correct duration.");
    elapsed = null;
  }
  let active = session.timerSeconds;
  let activeProvenance: PreviewProvenance = active === null ? "absent" : "device";
  if (active !== null && (active <= 0 || (elapsed !== null && active > elapsed + 1))) {
    warnings.push("The timer time was missing or longer than the elapsed time, so elapsed time is used instead.");
    active = null;
    activeProvenance = "rejected_implausible";
  } else if (active !== null && elapsed !== null && active > elapsed) {
    active = elapsed; // Rounding: never let active exceed elapsed by a second.
  }
  const basis = elapsed !== null || active !== null ? measuredDurationBasis(active) : null;
  const goalSeconds = basis === "active" ? active : basis === "elapsed" ? elapsed : null;

  let distance = session.distanceMeters;
  let distanceProvenance: PreviewProvenance = distance === null ? "absent" : "device";
  if (distance === 0) {
    // Devices write 0 when no distance sensor was used (e.g. strength, indoor rides without a speed sensor).
    distance = null;
    distanceProvenance = "device_zero_treated_as_unknown";
  } else if (distance !== null && !(distance > 0 && distance <= MAX_SANE_DISTANCE_METERS)) {
    warnings.push("The recorded distance was not plausible and was left out.");
    distance = null;
    distanceProvenance = "rejected_implausible";
  }

  let heartRate = session.heartRate;
  if (heartRate.avgBpm !== null && heartRate.maxBpm !== null && heartRate.avgBpm > heartRate.maxBpm) {
    warnings.push("The average heart rate was above the maximum, so the average was left out.");
    heartRate = { ...heartRate, avgBpm: null };
  }
  const hrProvenance = (value: number | null): PreviewProvenance =>
    value === null ? "absent" : heartRate.basis === "device_summary" ? "device" : "derived";

  const sport = mapSport(ctx.format, session.sport, session.subSport, distance, goalSeconds);
  if (sport.type === null) required.push("sport");

  const status = errors.length > 0 ? "failed" : required.length > 0 ? "needs_review" : "ready";
  return {
    key: String(session.index),
    index: session.index,
    status,
    errors,
    warnings,
    sportLabel: sport.label,
    rawSport: session.sport,
    rawSubSport: session.subSport,
    type: sport.type,
    typeSuggestion: sport.suggestion,
    typeSuggestionReason: sport.suggestionReason,
    startedAt: tz?.startedAt ?? null,
    timezone: ctx.profileTimezone,
    localDate: tz ? localDateOf(tz.startedAt, ctx.profileTimezone) : null,
    dateConfidence: tz?.confidence ?? null,
    timezoneCandidates: tz?.candidates ?? [],
    deviceUtcOffsetMinutes: session.utcOffsetMinutes,
    elapsedSeconds: elapsed,
    activeSeconds: active,
    goalSeconds,
    durationBasis: basis,
    pausedSeconds: active !== null && elapsed !== null ? elapsed - active : null,
    distanceMeters: distance,
    heartRate,
    providerId: session.providerId,
    provenance: {
      elapsedSeconds: elapsedProvenance,
      activeSeconds: activeProvenance,
      distanceMeters: distanceProvenance,
      avgHeartRateBpm: hrProvenance(heartRate.avgBpm),
      maxHeartRateBpm: hrProvenance(heartRate.maxBpm),
    },
    duplicates: [],
    requiredConfirmations: errors.length > 0 ? [] : required,
  };
}
