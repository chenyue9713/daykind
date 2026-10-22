// Import workflow (PRD FR04) over the shared ActivityStore contract.
//
// The preview is stateless: nothing about an upload is stored until the user
// confirms. The browser keeps its local file and sends it again with the
// decisions; the server re-parses it, checks it is the same file, rebuilds
// duplicate candidates, and saves everything in one store transaction. Raw
// file bytes are never written anywhere, so there is nothing to clean up
// after cancellation or failure.
import { createHash, randomUUID } from "node:crypto";

import { goalSecondsOf, type DuplicateProbe } from "@/lib/domain/activity";
import type { ActivityStore } from "@/lib/data/repository";
import type { Activity, ActivityType } from "@/lib/domain/types";
import { buildConfirmedImport } from "./decisions";
import { ACTIVITY_TYPES, normalizeSession } from "./normalize";
import { parseWorkoutFile } from "./parsers";
import { sanitizeFileName } from "./sniff";
import type { DuplicateCandidate, ImportError, ImportPreview, SessionDecision, SessionPreview } from "./types";

export type ImportStore = Pick<ActivityStore, "findImportedFile" | "findDuplicateCandidates" | "saveConfirmedImport">;

export interface ImportDeps {
  store: ImportStore;
  profileTimezone: string;
  now?: () => Date;
  newRequestId?: () => string;
}

export type PreviewOutcome = { ok: true; preview: ImportPreview } | { ok: false; error: ImportError };

export type ConfirmOutcome =
  | { status: "saved"; savedAt: string; activityIds: string[] }
  /** Sample mode or another non-persisting store: the import was valid but nothing was saved. */
  | { status: "not_persisted"; message: string }
  /** Nothing was saved. `preview` is a fresh preview when the user needs to review again. */
  | { status: "error"; error: ImportError; preview?: ImportPreview };

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function describeMatch(session: SessionPreview, activity: Activity): string[] {
  const reasons: string[] = [];
  if (session.startedAt && activity.startedAt) {
    const minutes = Math.round(Math.abs(Date.parse(session.startedAt) - Date.parse(activity.startedAt)) / 60_000);
    reasons.push(minutes === 0 ? "Starts at the same minute" : `Starts ${minutes} min apart`);
  } else {
    reasons.push("Same day (the existing entry has no start time)");
  }
  const existing = goalSecondsOf(activity);
  if (session.goalSeconds !== null && existing > 0) {
    const pct = Math.round((Math.abs(existing - session.goalSeconds) / Math.max(existing, session.goalSeconds)) * 100);
    reasons.push(pct === 0 ? "Same duration" : `Duration within ${pct}%`);
  }
  if (activity.source === "manual") reasons.push("Entered manually");
  return reasons;
}

function toCandidate(session: SessionPreview, activity: Activity): DuplicateCandidate {
  return {
    activityId: activity.id,
    revision: activity.revision,
    source: activity.source,
    type: activity.type,
    startedAt: activity.startedAt,
    localDate: activity.localDate,
    goalSeconds: goalSecondsOf(activity),
    durationBasis: activity.durationBasis,
    elapsedSeconds: activity.elapsedSeconds,
    activeSeconds: activity.activeSeconds,
    distanceMeters: activity.distanceMeters,
    avgHeartRateBpm: activity.avgHeartRateBpm,
    maxHeartRateBpm: activity.maxHeartRateBpm,
    note: activity.note,
    intensity: activity.intensity,
    reasons: describeMatch(session, activity),
  };
}

/** Candidates for every type the session could be and every date it could fall on. */
async function findCandidates(session: SessionPreview, store: ImportStore): Promise<DuplicateCandidate[]> {
  if (session.status === "failed" || !session.startedAt || session.goalSeconds === null) return [];
  const types: readonly ActivityType[] = session.type ? [session.type] : ACTIVITY_TYPES;
  const dates = [...new Set(session.timezoneCandidates.map((c) => c.localDate))];
  const probes: DuplicateProbe[] = types.flatMap((type) =>
    dates.map((localDate) => ({ type, startedAt: session.startedAt, localDate, goalSeconds: session.goalSeconds! })),
  );
  const found = new Map<string, DuplicateCandidate>();
  for (const probe of probes) {
    for (const activity of await store.findDuplicateCandidates(probe)) {
      if (activity.canonicalStatus === "canonical" && !found.has(activity.id)) found.set(activity.id, toCandidate(session, activity));
    }
  }
  return [...found.values()];
}

export async function buildPreview(
  bytes: Uint8Array,
  rawFileName: string | null,
  deps: ImportDeps,
  requestId?: string,
): Promise<PreviewOutcome> {
  const fileName = sanitizeFileName(rawFileName);
  const parsed = parseWorkoutFile(bytes, fileName);
  if (!parsed.ok) return parsed;

  const fileHash = sha256Hex(bytes);
  const existing = await deps.store.findImportedFile(fileHash);
  if (existing) {
    const when = new Date(existing.importedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    return {
      ok: false,
      error: {
        code: "already_imported",
        message: `You already imported this exact file on ${when}. Nothing new was added. To import it again, first delete its activities in History.`,
      },
    };
  }

  const now = deps.now?.() ?? new Date();
  const sessions: SessionPreview[] = [];
  for (const raw of parsed.file.sessions) {
    const session = normalizeSession(raw, { format: parsed.file.format, profileTimezone: deps.profileTimezone, now });
    session.duplicates = await findCandidates(session, deps.store);
    if (session.duplicates.length > 0 && session.status !== "failed") {
      session.requiredConfirmations.push("duplicate");
      session.status = "needs_review";
    }
    sessions.push(session);
  }

  return {
    ok: true,
    preview: {
      requestId: requestId && UUID.test(requestId) ? requestId : (deps.newRequestId ?? randomUUID)(),
      fileHash,
      fileName,
      format: parsed.file.format,
      deviceLabel: parsed.file.deviceLabel,
      decoderVersion: parsed.file.decoderVersion,
      profileTimezone: deps.profileTimezone,
      sessions,
      warnings: parsed.file.warnings,
    },
  };
}

export async function confirmImport(
  bytes: Uint8Array,
  rawFileName: string | null,
  input: { requestId: string; expectedHash: string; decisions: SessionDecision[] },
  deps: ImportDeps,
): Promise<ConfirmOutcome> {
  const rebuilt = await buildPreview(bytes, rawFileName, deps, input.requestId);
  if (!rebuilt.ok) return { status: "error", error: rebuilt.error };
  const preview = rebuilt.preview;
  if (preview.fileHash !== input.expectedHash) {
    return {
      status: "error",
      error: { code: "changed_since_preview", message: "The selected file changed since the preview. Review the new preview before saving." },
      preview: { ...preview, requestId: (deps.newRequestId ?? randomUUID)() },
    };
  }

  const check = buildConfirmedImport(preview, input.decisions);
  if (!check.ok) {
    return {
      status: "error",
      error: { code: check.kind === "changed" ? "changed_since_preview" : "invalid_decisions", message: check.message },
      preview: check.kind === "changed" ? { ...preview, requestId: (deps.newRequestId ?? randomUUID)() } : undefined,
    };
  }

  let result;
  try {
    result = await deps.store.saveConfirmedImport(check.value);
  } catch {
    return storageFailed();
  }

  switch (result.status) {
    case "saved":
      return { status: "saved", savedAt: result.savedAt, activityIds: result.activityIds };
    case "not_persisted":
      return { status: "not_persisted", message: result.reason };
    case "duplicate_file":
      return {
        status: "error",
        error: { code: "already_imported", message: "This file (or a workout in it) was already imported. Nothing new was added." },
      };
    case "conflict": {
      const fresh = await buildPreview(bytes, rawFileName, deps);
      return {
        status: "error",
        error: {
          code: "conflict",
          message: "An activity you chose to link or replace was changed or removed since the preview. Nothing was saved. Review the updated preview.",
        },
        preview: fresh.ok ? fresh.preview : undefined,
      };
    }
    case "invalid":
      return {
        status: "error",
        error: {
          code: "invalid_decisions",
          message: `Session ${result.sessionIndex + 1} was rejected: ${Object.values(result.errors).find(Boolean) ?? result.reason} Nothing was saved.`,
        },
      };
    default:
      // "failed", or a status added to the contract later: never treat as saved.
      return storageFailed();
  }
}

function storageFailed(): ConfirmOutcome {
  return {
    status: "error",
    error: { code: "storage_failed", message: "The import could not be saved, and nothing was added. Your choices are still here; try again." },
  };
}
