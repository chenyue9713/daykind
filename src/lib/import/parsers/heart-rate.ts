// Heart-rate summaries (PRD FR04): prefer the device's summary; otherwise
// average valid samples weighted by time, with gaps capped so pauses and
// dropouts are never filled in, and label the coverage. An unweighted mean of
// sparse points is never presented as the workout average.
import {
  MAX_HEART_RATE_BPM,
  MAX_HR_SAMPLE_GAP_SECONDS,
  MAX_HR_SAMPLES,
  MIN_HEART_RATE_BPM,
  MIN_HR_COVERAGE,
} from "../limits";
import type { HeartRateSummary } from "../types";

export const NO_HEART_RATE: HeartRateSummary = { avgBpm: null, maxBpm: null, basis: "none", coverage: null };

export function isPlausibleHeartRate(bpm: number | null | undefined): bpm is number {
  return typeof bpm === "number" && Number.isFinite(bpm) && bpm >= MIN_HEART_RATE_BPM && bpm <= MAX_HEART_RATE_BPM;
}

/** Collects (time, bpm) samples in time order without storing anything else. */
export class HeartRateSamples {
  private times: number[] = [];
  private values: number[] = [];

  get size(): number {
    return this.times.length;
  }

  /** `time` in epoch seconds. Implausible values and out-of-order samples are ignored. */
  add(time: number, bpm: number): void {
    if (this.times.length >= MAX_HR_SAMPLES || !isPlausibleHeartRate(bpm)) return;
    const last = this.times[this.times.length - 1];
    if (last !== undefined && time < last) return;
    this.times.push(time);
    this.values.push(bpm);
  }

  /** Summarizes samples in [start, end] (epoch seconds) against the session's active time. */
  summarize(start: number, end: number, activeSeconds: number | null): HeartRateSummary {
    let covered = 0;
    let weighted = 0;
    let max: number | null = null;
    for (let i = 0; i < this.times.length; i++) {
      const t = this.times[i];
      if (t < start || t > end) continue;
      const next = i + 1 < this.times.length ? Math.min(this.times[i + 1], end) : end;
      const weight = Math.min(Math.max(next - t, 0), MAX_HR_SAMPLE_GAP_SECONDS);
      covered += weight;
      weighted += this.values[i] * weight;
      max = max === null ? this.values[i] : Math.max(max, this.values[i]);
    }
    if (max === null) return NO_HEART_RATE;
    const denominator = activeSeconds && activeSeconds > 0 ? activeSeconds : end - start;
    const coverage = denominator > 0 ? Math.min(1, covered / denominator) : 0;
    return {
      avgBpm: covered > 0 && coverage >= MIN_HR_COVERAGE ? Math.round(weighted / covered) : null,
      maxBpm: max,
      basis: "time_weighted_samples",
      coverage: Math.round(coverage * 100) / 100,
    };
  }
}
