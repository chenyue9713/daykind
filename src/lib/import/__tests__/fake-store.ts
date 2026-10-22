// An in-memory ActivityStore that follows doc/activity-contract.md closely
// enough to test the import workflow: all-or-nothing saves, idempotent
// requestIds, exact-file blocking, optimistic revisions, and link/replace.
import { isSuspectedDuplicate, validateActivityDraft, type ActivityDraft } from "@/lib/domain/activity";
import type { ConfirmedImport, ImportSaveResult } from "@/lib/data/repository";
import type { Activity, ActivitySource } from "@/lib/domain/types";
import type { ImportStore } from "../service";

export interface FakeStore extends ImportStore {
  activities: Activity[];
  sources: ActivitySource[];
  files: Map<string, string>;
  saveCalls: ConfirmedImport[];
  /** Replace the next save with this result (or throw it if it is an Error). */
  nextSave: ImportSaveResult | Error | null;
}

const NOW = "2026-10-20T17:00:00.000Z";

export function createFakeStore(initial: Activity[] = []): FakeStore {
  const results = new Map<string, ImportSaveResult>();
  let ids = 0;

  const store: FakeStore = {
    activities: initial.map((a) => ({ ...a })),
    sources: [],
    files: new Map(),
    saveCalls: [],
    nextSave: null,

    async findImportedFile(sha256) {
      const at = store.files.get(sha256);
      return at ? { fileHash: sha256, fileKind: "fit", importedAt: at, activityIds: [] } : null;
    },

    async findDuplicateCandidates(probe) {
      return store.activities.filter((a) => isSuspectedDuplicate(probe, a)).map((a) => ({ ...a }));
    },

    async saveConfirmedImport(input) {
      store.saveCalls.push(structuredClone(input));
      if (store.nextSave) {
        const next = store.nextSave;
        store.nextSave = null;
        if (next instanceof Error) throw next;
        return next;
      }
      const previous = results.get(input.requestId);
      if (previous) return previous;
      if (store.files.has(input.file.sha256)) {
        return { status: "duplicate_file", reason: "already imported", importedAt: store.files.get(input.file.sha256)! };
      }

      // Work on copies; commit only if every session succeeds.
      const activities = store.activities.map((a) => ({ ...a }));
      const sources = [...store.sources];
      const created: string[] = [];
      for (const [i, session] of input.sessions.entries()) {
        const errors = validateActivityDraft(session.draft);
        if (Object.keys(errors).length) return { status: "invalid", reason: "invalid", sessionIndex: i, errors };
        if (session.source.providerId && sources.some((s) => s.providerId === session.source.providerId && s.sourceKind === session.source.sourceKind)) {
          return { status: "duplicate_file", reason: "provider id exists", importedAt: NOW };
        }
        const make = (draft: ActivityDraft): Activity => ({
          ...draft,
          id: `imported-${++ids}`,
          userId: "test-user",
          createdAt: NOW,
          updatedAt: NOW,
          revision: 1,
          source: session.source.sourceKind,
          canonicalStatus: "canonical",
          linkedActivityId: null,
        });
        let activityId: string;
        const r = session.resolution;
        if (r.kind === "create") {
          const a = make(session.draft);
          activities.push(a);
          activityId = a.id;
        } else {
          const target = activities.find((a) => a.id === r.activityId);
          if (!target || target.canonicalStatus !== "canonical" || target.revision !== r.expectedRevision) {
            return { status: "conflict", reason: "changed", activityId: r.activityId };
          }
          if (r.kind === "link") {
            const d = session.draft;
            Object.assign(target, {
              startedAt: d.startedAt,
              localDate: d.localDate,
              timezone: d.timezone,
              elapsedSeconds: d.elapsedSeconds,
              activeSeconds: d.activeSeconds,
              distanceMeters: d.distanceMeters,
              avgHeartRateBpm: d.avgHeartRateBpm,
              maxHeartRateBpm: d.maxHeartRateBpm,
              durationBasis: d.durationBasis,
              intensity: target.intensity === "unknown" ? d.intensity : target.intensity,
              revision: target.revision + 1,
            });
            activityId = target.id;
          } else {
            const a = make(session.draft);
            activities.push(a);
            target.canonicalStatus = "linked";
            target.linkedActivityId = a.id;
            target.revision += 1;
            activityId = a.id;
          }
        }
        sources.push({
          id: `src-${++ids}`,
          userId: "test-user",
          activityId,
          createdAt: NOW,
          sourceKind: session.source.sourceKind,
          providerId: session.source.providerId,
          fileHash: input.file.sha256,
          importedSummary: session.source.importedSummary,
          fieldProvenance: session.draft.fieldProvenance,
          decoderVersion: session.source.decoderVersion,
        });
        created.push(activityId);
      }

      store.activities = activities;
      store.sources = sources;
      store.files.set(input.file.sha256, NOW);
      const result: ImportSaveResult = { status: "saved", savedAt: NOW, activityIds: created };
      results.set(input.requestId, result);
      return result;
    },
  };
  return store;
}
