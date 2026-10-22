// TCX (Garmin Training Center XML) adapter. Streams the document and keeps
// only per-session summaries: positions, altitude, cadence, and extensions
// are never stored. Lap TotalTimeSeconds is timer time (pauses excluded);
// elapsed time is derived from the first and last recorded times.
import { Deadline, MAX_SESSIONS_PER_FILE, MIN_HR_COVERAGE } from "../limits";
import { ImportFailure, type ParsedFile, type ParsedSession } from "../types";
import { HeartRateSamples, isPlausibleHeartRate, NO_HEART_RATE } from "./heart-rate";
import { parseXml } from "./xml";

export const TCX_DECODER_VERSION = "daykind-tcx-1";

interface TcxTime {
  /** Epoch seconds; floating times are read as if UTC. */
  seconds: number;
  floating: boolean;
}

interface Lap {
  start: TcxTime | null;
  totalTime: number | null;
  distance: number | null;
  avgHr: number | null;
  maxHr: number | null;
}

interface Activity {
  sport: string | null;
  id: string | null;
  laps: Lap[];
  firstPoint: number | null;
  lastPoint: number | null;
  maxPointDistance: number | null;
  hr: HeartRateSamples;
  creator: string | null;
  floatingTimes: boolean;
}

const TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;

export function parseTcxTime(text: string): TcxTime | null {
  const m = TIME.exec(text.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s, frac, zone] = m;
  let ms = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s) + (frac ? Math.round(Number(frac) * 1000) : 0);
  if (Number.isNaN(ms)) return null;
  const check = new Date(Date.UTC(+y, +mo - 1, +d));
  if (check.getUTCMonth() !== +mo - 1 || check.getUTCDate() !== +d || +h > 23 || +mi > 59 || +s > 60) return null;
  if (zone && zone !== "Z") {
    const sign = zone[0] === "-" ? -1 : 1;
    const digits = zone.slice(1).replace(":", "");
    ms -= sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2))) * 60_000;
  }
  return { seconds: ms / 1000, floating: !zone };
}

function toNumber(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

const isoOf = (seconds: number) => new Date(seconds * 1000).toISOString();

export function parseTcx(input: string, deadline = new Deadline()): ParsedFile {
  const activities: Activity[] = [];
  const stack: string[] = [];
  let text = "";
  let sawRoot = false;
  let sawCourses = false;
  let activity: Activity | null = null;
  let lap: Lap | null = null;
  let point: { time: TcxTime | null; hr: number | null; distance: number | null } | null = null;

  const parent = (depth = 1) => stack[stack.length - 1 - depth];

  parseXml(
    input,
    {
      open(name, attributes) {
        if (stack.length === 0) {
          if (name !== "TrainingCenterDatabase") {
            throw new ImportFailure(
              "unsupported_content",
              "This XML file is not a Garmin TCX workout. Export the workout as TCX from Garmin Connect, or add it manually.",
            );
          }
          sawRoot = true;
        }
        stack.push(name);
        text = "";
        const p = parent();
        if (name === "Courses") sawCourses = true;
        if (name === "Activity" && (p === "Activities" || p === "FirstSport" || p === "NextSport")) {
          if (activities.length >= MAX_SESSIONS_PER_FILE) {
            throw new ImportFailure("too_complex", `This file has more than ${MAX_SESSIONS_PER_FILE} workouts. Export them one at a time.`);
          }
          activity = {
            sport: attributes.Sport ?? null,
            id: null,
            laps: [],
            firstPoint: null,
            lastPoint: null,
            maxPointDistance: null,
            hr: new HeartRateSamples(),
            creator: null,
            floatingTimes: false,
          };
          activities.push(activity);
        } else if (name === "Lap" && p === "Activity" && activity) {
          const start = attributes.StartTime ? parseTcxTime(attributes.StartTime) : null;
          if (start?.floating) activity.floatingTimes = true;
          lap = { start, totalTime: null, distance: null, avgHr: null, maxHr: null };
          activity.laps.push(lap);
        } else if (name === "Trackpoint" && activity) {
          point = { time: null, hr: null, distance: null };
        }
      },
      text(value) {
        text += value;
      },
      close(name) {
        const p = parent();
        const value = text;
        text = "";
        if (activity) {
          if (name === "Id" && p === "Activity") activity.id = value.trim().slice(0, 64) || null;
          else if (name === "Name" && p === "Creator" && parent(2) === "Activity") activity.creator ??= value.trim().slice(0, 80) || null;
          else if (lap && p === "Lap") {
            if (name === "TotalTimeSeconds") lap.totalTime = toNumber(value);
            else if (name === "DistanceMeters") lap.distance = toNumber(value);
          } else if (lap && name === "Value" && parent(2) === "Lap") {
            if (p === "AverageHeartRateBpm") lap.avgHr = toNumber(value);
            else if (p === "MaximumHeartRateBpm") lap.maxHr = toNumber(value);
          } else if (point && p === "Trackpoint") {
            if (name === "Time") point.time = parseTcxTime(value);
            else if (name === "DistanceMeters") point.distance = toNumber(value);
          } else if (point && name === "Value" && p === "HeartRateBpm" && parent(2) === "Trackpoint") {
            point.hr = toNumber(value);
          }

          if (name === "Trackpoint" && point) {
            if (point.time) {
              const t = point.time.seconds;
              if (point.time.floating) activity.floatingTimes = true;
              activity.firstPoint = activity.firstPoint === null ? t : Math.min(activity.firstPoint, t);
              activity.lastPoint = activity.lastPoint === null ? t : Math.max(activity.lastPoint, t);
              if (point.hr !== null) activity.hr.add(t, point.hr);
            }
            if (point.distance !== null && point.distance >= 0) {
              activity.maxPointDistance = Math.max(activity.maxPointDistance ?? 0, point.distance);
            }
            point = null;
          } else if (name === "Lap") {
            lap = null;
          } else if (name === "Activity" && (p === "Activities" || p === "FirstSport" || p === "NextSport")) {
            activity = null;
          }
        }
        stack.pop();
      },
    },
    deadline,
  );

  if (!sawRoot) {
    throw new ImportFailure("unsupported_content", "This file is not a Garmin TCX workout.");
  }
  if (activities.length === 0) {
    throw new ImportFailure(
      sawCourses ? "not_an_activity" : "no_sessions",
      sawCourses
        ? "This TCX file contains a course (a planned route), not a recorded workout. Export the completed activity instead."
        : "No workouts were found in this file. Export the completed activity from Garmin Connect, or add it manually.",
    );
  }

  return {
    format: "tcx",
    decoderVersion: TCX_DECODER_VERSION,
    deviceLabel: activities.find((a) => a.creator)?.creator ?? null,
    sessions: activities.map(toSession),
    warnings: [],
  };
}

function toSession(a: Activity, index: number): ParsedSession {
  const errors: string[] = [];
  const warnings: string[] = [];
  const firstLapStart = a.laps.find((l) => l.start)?.start ?? null;
  const idTime = a.id ? parseTcxTime(a.id) : null;
  const start = firstLapStart ?? idTime ?? (a.firstPoint !== null ? { seconds: a.firstPoint, floating: a.floatingTimes } : null);
  if (!start) errors.push("No start time was recorded for this session.");

  const timedLaps = a.laps.filter((l) => l.totalTime !== null && l.totalTime >= 0);
  const timerSeconds =
    a.laps.length > 0 && timedLaps.length === a.laps.length
      ? Math.round(timedLaps.reduce((sum, l) => sum + (l.totalTime ?? 0), 0))
      : null;

  const lastLap = [...a.laps].reverse().find((l) => l.start && l.totalTime !== null);
  const ends = [a.lastPoint, lastLap?.start && lastLap.totalTime !== null ? lastLap.start.seconds + lastLap.totalTime : null].filter(
    (v): v is number => v !== null,
  );
  const end = ends.length ? Math.max(...ends) : null;
  let elapsedSeconds = start && end !== null ? Math.round(end - start.seconds) : null;
  if (elapsedSeconds !== null && timerSeconds !== null && elapsedSeconds < timerSeconds) {
    // Laps without trackpoints cannot reveal pauses; elapsed is at least the timer time.
    elapsedSeconds = timerSeconds;
  }
  if ((elapsedSeconds === null || elapsedSeconds <= 0) && !(timerSeconds !== null && timerSeconds > 0)) {
    errors.push("No duration was recorded for this session.");
  }

  const lapDistances = a.laps.map((l) => l.distance);
  const distanceMeters =
    a.laps.length > 0 && lapDistances.every((d) => d !== null && d >= 0)
      ? lapDistances.reduce<number>((sum, d) => sum + (d ?? 0), 0)
      : a.maxPointDistance;

  let heartRate = NO_HEART_RATE;
  const lapTime = timedLaps.reduce((sum, l) => sum + (l.totalTime ?? 0), 0);
  const hrLaps = timedLaps.filter((l) => isPlausibleHeartRate(l.avgHr));
  if (hrLaps.length > 0 && lapTime > 0) {
    const covered = hrLaps.reduce((sum, l) => sum + (l.totalTime ?? 0), 0);
    const coverage = Math.min(1, covered / lapTime);
    const maxes = a.laps.map((l) => l.maxHr).filter(isPlausibleHeartRate);
    heartRate = {
      avgBpm: covered > 0 && coverage >= MIN_HR_COVERAGE ? Math.round(hrLaps.reduce((s, l) => s + (l.avgHr ?? 0) * (l.totalTime ?? 0), 0) / covered) : null,
      maxBpm: maxes.length ? Math.max(...maxes) : null,
      basis: "device_summary",
      coverage: Math.round(coverage * 100) / 100,
    };
  } else if (a.hr.size > 0 && start && end !== null) {
    heartRate = a.hr.summarize(start.seconds, end, timerSeconds);
  }
  if (a.laps.some((l) => l.avgHr !== null && !isPlausibleHeartRate(l.avgHr))) {
    warnings.push("Some heart-rate values were outside 25–250 bpm and were ignored.");
  }

  return {
    index,
    sport: a.sport,
    subSport: null,
    startedAt: start ? isoOf(start.seconds) : null,
    startIsFloating: start?.floating ?? false,
    utcOffsetMinutes: null,
    elapsedSeconds: elapsedSeconds !== null && elapsedSeconds > 0 ? elapsedSeconds : null,
    elapsedSource: elapsedSeconds !== null && elapsedSeconds > 0 ? "derived" : null,
    timerSeconds,
    distanceMeters,
    heartRate,
    providerId: start ? `tcx:${a.id ?? isoOf(start.seconds)}` : null,
    errors,
    warnings,
  };
}
