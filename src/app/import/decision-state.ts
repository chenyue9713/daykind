// Client-side decision state for one previewed session, and its conversion
// to the SessionDecision the server re-validates.
import { candidatesForType } from "@/lib/import/decisions";
import type { SessionDecision, SessionPreview } from "@/lib/import/types";
import type { ActivityType } from "@/lib/domain/types";

export interface DraftDecision {
  include: boolean;
  type: ActivityType | "";
  /** Empty until confirmed when the day is ambiguous. */
  timezone: string;
  /** "", "keep_both", "link:<id>", or "replace:<id>". */
  duplicate: string;
  keepNote: boolean;
}

/** Splits "link:<id>" on the first colon only; activity ids may contain colons. */
export function parseDuplicateChoice(value: string): { kind: string; id: string } {
  const colon = value.indexOf(":");
  return colon === -1 ? { kind: value, id: "" } : { kind: value.slice(0, colon), id: value.slice(colon + 1) };
}

export function initialDecision(session: SessionPreview): DraftDecision {
  return {
    include: session.status !== "failed",
    type: session.type ?? "",
    timezone: session.requiredConfirmations.includes("timezone") ? "" : (session.timezoneCandidates[0]?.timezone ?? ""),
    duplicate: "",
    keepNote: true,
  };
}

/** What still needs an answer before this session can be saved. */
export function missingAnswers(session: SessionPreview, d: DraftDecision): string[] {
  if (!d.include || session.status === "failed") return [];
  const missing: string[] = [];
  if (!d.type) missing.push("choose the activity type");
  if (!d.timezone) missing.push("confirm the day");
  if (d.type && candidatesForType(session, d.type).length > 0 && !d.duplicate) missing.push("decide about the possible duplicate");
  return missing;
}

export function toSessionDecision(session: SessionPreview, d: DraftDecision): SessionDecision | null {
  if (session.status === "failed") return null;
  if (!d.include) return { key: session.key, action: "skip" };
  const type = d.type as ActivityType;
  const candidates = candidatesForType(session, type);
  let duplicate: Extract<SessionDecision, { action: "import" }>["duplicate"] = null;
  if (candidates.length > 0) {
    const { kind, id } = parseDuplicateChoice(d.duplicate);
    const target = candidates.find((c) => c.activityId === id);
    if (kind === "keep_both") duplicate = { resolution: "keep_both" };
    else if (kind === "link" && target) duplicate = { resolution: "link", activityId: target.activityId, expectedRevision: target.revision };
    else if (kind === "replace" && target) {
      duplicate = { resolution: "replace", activityId: target.activityId, expectedRevision: target.revision, keepNote: d.keepNote };
    }
  }
  return {
    key: session.key,
    action: "import",
    type,
    timezone: d.timezone,
    duplicate,
    reviewedCandidateIds: candidates.map((c) => c.activityId),
  };
}
