// Bounds for untrusted workout files (PRD FR04). Size is checked while the
// upload streams in; the structural limits and deadline bound parse time and
// memory for files that are small but pathological.

/** Proposed per-file limit from the PRD. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_FILE_LABEL = "20 MB";

/** Wall-clock budget for one parse. Checked cooperatively by both decoders. */
export const PARSE_TIME_BUDGET_MS = 5_000;

export const MAX_SESSIONS_PER_FILE = 50;

/** XML (TCX) structure. */
export const MAX_XML_DEPTH = 64;
export const MAX_XML_ELEMENTS = 2_000_000;
export const MAX_XML_ATTRIBUTES = 32;
export const MAX_XML_TEXT_LENGTH = 64 * 1024;

/** FIT structure. */
export const MAX_FIT_MESSAGES = 3_000_000;
export const MAX_FIT_DEFINITIONS = 10_000;
export const MAX_FIT_CHAINED_FILES = 8;

/** Heart-rate samples kept per file, only used when the device gave no summary. */
export const MAX_HR_SAMPLES = 500_000;
/** A sample counts for at most this long, so gaps (pauses, dropouts) are not filled in. */
export const MAX_HR_SAMPLE_GAP_SECONDS = 10;
/** Below this coverage a sample-based average is not shown as the workout average. */
export const MIN_HR_COVERAGE = 0.8;

export const MIN_HEART_RATE_BPM = 25;
export const MAX_HEART_RATE_BPM = 250;

export const MAX_SANE_DISTANCE_METERS = 1_000_000;

export class Deadline {
  private readonly endsAt: number;

  constructor(
    budgetMs = PARSE_TIME_BUDGET_MS,
    private readonly now: () => number = Date.now,
  ) {
    this.endsAt = now() + budgetMs;
  }

  get expired(): boolean {
    return this.now() > this.endsAt;
  }
}
