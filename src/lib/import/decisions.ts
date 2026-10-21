// Turns the user's preview decisions into the shared contract's
// ConfirmedImport (doc/activity-contract.md). Pure. Decisions come from the
// browser and are untrusted: every value is checked against a preview the
// server rebuilt from the same file, and notes come only from the store.
import { validateActivityDraft, type ActivityDraft } from "@/lib/domain/activity";
import type { ActivityType, FieldProvenanceMap, Intensity } from "@/lib/domain/types";
import type { ConfirmedImport, ImportedSession, ImportResolution } from "@/lib/data/repository";
import { ACTIVITY_TYPES } from "./normalize";
import { localDateOf } from "./time";
import type { DuplicateCandidate, ImportPreview, SessionDecision, SessionPreview } from "./types";

export type DecisionCheck =
  | { ok: true; value: ConfirmedImport }
  /** The decisions are malformed or incomplete; show the message. */
  | { ok: false; kind: "invalid"; message: string }
  /** The data changed since the preview (e.g. a new possible duplicate); review again. */
  | { ok: false; kind: "changed"; message: string };

const invalid = (message: string): DecisionCheck => ({ ok: false, kind: "invalid", message });

export function candidatesForType(session: SessionPreview, type: ActivityType | null): DuplicateCandidate[] {
  return type === null ? [] : session.duplicates.filter((c) => c.type === type);
}

/** Parses untrusted JSON decisions into a typed list, or null when malformed. */
export function parseDecisions(raw: unknown): SessionDecision[] | null {
  if (!Array.isArray(raw) || raw.length > 100) return null;
  const out: SessionDecision[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const d = item as Record<string, unknown>;
    if (typeof d.key !== "string" || d.key.length > 8) return null;
    if (d.action === "skip") {
      out.push({ key: d.key, action: "skip" });
      continue;
    }
    if (d.action !== "import") return null;
    if (typeof d.type !== "string" || !ACTIVITY_TYPES.includes(d.type as ActivityType)) return null;
    if (typeof d.timezone !== "string" || d.timezone.length > 64) return null;
    const reviewed = d.reviewedCandidateIds;
    if (!Array.isArray(reviewed) || reviewed.length > 50 || !reviewed.every((id) => typeof id === "string" && id.length <= 64)) return null;

    let duplicate: Extract<SessionDecision, { action: "import" }>["duplicate"] = null;
    if (d.duplicate !== null && d.duplicate !== undefined) {
      const dup = d.duplicate as Record<string, unknown>;
      if (dup.resolution === "keep_both") duplicate = { resolution: "keep_both" };
      else if (
        (dup.resolution === "link" || dup.resolution === "replace") &&
        typeof dup.activityId === "string" &&
        Number.isInteger(dup.expectedRevision)
      ) {
        duplicate =
          dup.resolution === "link"
            ? { resolution: "link", activityId: dup.activityId, expectedRevision: dup.expectedRevision as number }
            : { resolution: "replace", activityId: dup.activityId, expectedRevision: dup.expectedRevision as number, keepNote: dup.keepNote === true };
      } else return null;
    }
    out.push({
      key: d.key,
      action: "import",
      type: d.type as ActivityType,
      timezone: d.timezone,
      duplicate,
      reviewedCandidateIds: reviewed as string[],
    });
  }
  return out;
}

function provenanceFor(session: SessionPreview, source: "tcx" | "fit", typeChosenByUser: boolean): FieldProvenanceMap {
  const map: FieldProvenanceMap = {
    type: { source, kind: typeChosenByUser ? "reported" : "measured" },
    startedAt: { source, kind: "measured" },
  };
  const kindOf = (value: string) => (value === "device" ? "measured" : value === "derived" ? "derived" : null);
  const fields = ["elapsedSeconds", "activeSeconds", "distanceMeters", "avgHeartRateBpm", "maxHeartRateBpm"] as const;
  for (const field of fields) {
    const kind = kindOf(session.provenance[field]);
    if (kind) map[field] = { source, kind };
  }
  return map;
}

/** The permitted summary kept with the source: canonical units, no GPS, streams, or serial numbers. */
export function importedSummary(preview: ImportPreview, session: SessionPreview, timezone: string): Record<string, unknown> {
  return {
    sessionIndex: session.index,
    sport: session.rawSport,
    subSport: session.rawSubSport,
    startedAt: session.startedAt,
    deviceUtcOffsetMinutes: session.deviceUtcOffsetMinutes,
    dateConfidence: session.dateConfidence,
    timezone,
    elapsedSeconds: session.elapsedSeconds,
    activeSeconds: session.activeSeconds,
    pausedSeconds: session.pausedSeconds,
    distanceMeters: session.distanceMeters,
    heartRate: session.heartRate,
    provenance: session.provenance,
    deviceLabel: preview.deviceLabel,
    warnings: session.warnings,
  };
}

export function buildConfirmedImport(preview: ImportPreview, decisions: SessionDecision[]): DecisionCheck {
  const byKey = new Map(decisions.map((d) => [d.key, d]));
  if (byKey.size !== decisions.length) return invalid("Each session can only be decided once.");
  for (const key of byKey.keys()) {
    if (!preview.sessions.some((s) => s.key === key)) return invalid("A decision refers to a session that is not in this file.");
  }

  const sessions: ImportedSession[] = [];
  for (const session of preview.sessions) {
    const decision = byKey.get(session.key);
    const name = `Session ${session.index + 1}`;
    if (session.status === "failed") {
      if (decision && decision.action !== "skip") return invalid(`${name} could not be read and cannot be imported.`);
      continue;
    }
    if (!decision) return invalid(`Choose whether to import ${name.toLowerCase()}.`);
    if (decision.action === "skip") continue;

    if (session.type !== null && decision.type !== session.type) {
      return invalid(`${name}: the activity type comes from the file and cannot be changed here.`);
    }
    const tzChoice = session.timezoneCandidates.find((c) => c.timezone === decision.timezone);
    if (!tzChoice) return invalid(`${name}: choose which day this workout happened.`);

    const candidates = candidatesForType(session, decision.type);
    const unseen = candidates.filter((c) => !decision.reviewedCandidateIds.includes(c.activityId));
    if (unseen.length > 0) {
      return { ok: false, kind: "changed", message: `${name}: a possible duplicate was added since the preview. Review it before saving.` };
    }
    if (candidates.length > 0 && !decision.duplicate) {
      return invalid(`${name} looks like an activity you already have. Choose keep both, link, or replace.`);
    }

    let resolution: ImportResolution = { kind: "create" };
    let note: string | null = null;
    let intensity: Intensity = "unknown";
    const provenance = provenanceFor(session, preview.format, session.type === null);
    if (decision.duplicate && decision.duplicate.resolution !== "keep_both") {
      const target = candidates.find((c) => c.activityId === (decision.duplicate as { activityId: string }).activityId);
      if (!target) return invalid(`${name}: the activity to link or replace is not one of the suggested matches.`);
      if (target.revision !== decision.duplicate.expectedRevision) {
        return { ok: false, kind: "changed", message: `${name}: the matching activity was edited since the preview. Review it again.` };
      }
      resolution = { kind: decision.duplicate.resolution, activityId: target.activityId, expectedRevision: target.revision };
      if (decision.duplicate.resolution === "replace" && decision.duplicate.keepNote) {
        note = target.note;
        intensity = target.intensity === "easy" || target.intensity === "moderate" || target.intensity === "hard" ? target.intensity : "unknown";
        const reportedSource = target.source === "manual" || target.source === "tcx" || target.source === "fit" ? target.source : "manual";
        if (note !== null) provenance.note = { source: reportedSource, kind: "reported" };
        if (intensity !== "unknown") provenance.intensity = { source: reportedSource, kind: "reported" };
      }
    }

    const startedAt = session.startedAt!;
    const draft: ActivityDraft = {
      type: decision.type,
      startedAt,
      localDate: localDateOf(startedAt, tzChoice.timezone),
      timezone: tzChoice.timezone,
      elapsedSeconds: session.elapsedSeconds,
      activeSeconds: session.activeSeconds,
      reportedSeconds: null,
      durationBasis: session.durationBasis!,
      distanceMeters: session.distanceMeters,
      avgHeartRateBpm: session.heartRate.avgBpm,
      maxHeartRateBpm: session.heartRate.maxBpm,
      intensity,
      note,
      fieldProvenance: provenance,
    };
    const errors = validateActivityDraft(draft);
    const firstError = Object.values(errors).find(Boolean);
    if (firstError) return invalid(`${name}: ${firstError}`);

    sessions.push({
      draft,
      source: {
        sourceKind: preview.format,
        providerId: session.providerId,
        importedSummary: importedSummary(preview, session, tzChoice.timezone),
        decoderVersion: preview.decoderVersion,
      },
      resolution,
    });
  }

  if (sessions.length === 0) return invalid("Choose at least one session to import, or cancel.");
  return {
    ok: true,
    value: {
      requestId: preview.requestId,
      file: { sha256: preview.fileHash, kind: preview.format, filenameSanitized: preview.fileName },
      sessions,
    },
  };
}
