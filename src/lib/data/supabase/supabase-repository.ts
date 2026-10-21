import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { isSuspectedDuplicate, validateActivityDraft, type ActivityDraft } from "@/lib/domain/activity";
import { addDays, localDateOf } from "@/lib/domain/dates";
import { DEFAULT_GOALS } from "@/lib/domain/targets";
import type { DateRange, Instant, UserProfile } from "@/lib/domain/types";
import type { DayKindRepository, DeleteInput, ImportSaveResult, MutationResult } from "../repository";
import {
  draftToRow,
  eveningPayload,
  importPayload,
  morningPayload,
  symptomPayload,
  toActivity,
  toActivitySource,
  toEveningEntry,
  toGoalVersion,
  toProfile,
  toSleepEntry,
  toSymptomEntry,
} from "./mapping";

type Row = Record<string, unknown>;
type RpcResult = { status: string; record?: Row; reason?: string } & Row;

interface Options {
  client: SupabaseClient;
  userId: string;
}

const SAVE_FAILED = "The server could not save this. Check your connection and try again.";

/**
 * Logs a database error without health values: Postgres "details" can echo
 * the failing row, so only the operation and the error code are recorded.
 */
function logError(operation: string, error: { code?: string } | null | unknown) {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "unknown";
  console.error(`[daykind] ${operation} failed (code ${code})`);
}

function rangeFilter<T extends { gte: (c: string, v: string) => T; lte: (c: string, v: string) => T }>(
  query: T,
  column: string,
  range: DateRange,
): T {
  return query.gte(column, range.start).lte(column, range.end);
}

/**
 * Repository backed by Supabase. Every query runs with the user's session, so
 * the database's row-level security decides what is visible; `userId` only
 * narrows queries that row-level security would allow anyway.
 */
export function createSupabaseRepository({ client, userId }: Options): DayKindRepository {
  let profile: Promise<UserProfile> | null = null;

  const getProfile = () => {
    profile ??= (async () => {
      const found = await client.from("profiles").select("*").eq("user_id", userId).maybeSingle();
      if (found.error) throw new Error(`Could not load profile (code ${found.error.code}).`);
      if (found.data) return toProfile(found.data);
      // First sign-in: create the profile with the PRD defaults (timezone to be confirmed).
      const created = await client.from("profiles").insert({ user_id: userId }).select("*").single();
      if (!created.error) return toProfile(created.data);
      // Another request (or device) created it first.
      const again = await client.from("profiles").select("*").eq("user_id", userId).single();
      if (again.error) throw new Error(`Could not create profile (code ${created.error.code}).`);
      return toProfile(again.data);
    })();
    return profile;
  };

  const select = async (operation: string, query: PromiseLike<{ data: Row[] | null; error: unknown }>) => {
    const { data, error } = await query;
    if (error) {
      logError(operation, error);
      throw new Error(`Could not load ${operation}.`);
    }
    return data ?? [];
  };

  async function rpc<T>(name: string, payload: unknown, map: (row: Row) => T): Promise<MutationResult<T>> {
    const { data, error } = await client.rpc(name, { p: payload });
    if (error) {
      logError(name, error);
      return { status: "failed", reason: SAVE_FAILED };
    }
    const result = data as RpcResult;
    switch (result.status) {
      case "saved":
        return { status: "saved", savedAt: (result.record?.updated_at as Instant) ?? new Date().toISOString(), record: map(result.record!) };
      case "conflict":
      case "not_found":
        return { status: result.status, reason: result.reason ?? "This record changed elsewhere." };
      default:
        return { status: "failed", reason: result.reason ?? SAVE_FAILED };
    }
  }

  async function remove(table: string, { id, expectedRevision }: DeleteInput): Promise<MutationResult<null>> {
    const { data, error } = await client.from(table).delete().eq("id", id).eq("revision", expectedRevision).select("id");
    if (error) {
      logError(`delete ${table}`, error);
      return { status: "failed", reason: "The server could not delete this. Try again." };
    }
    if (data.length > 0) return { status: "saved", savedAt: new Date().toISOString(), record: null };
    const still = await client.from(table).select("id").eq("id", id).maybeSingle();
    if (still.data) {
      return { status: "conflict", reason: "This record was changed on another device. Reload before deleting it." };
    }
    // Already gone (e.g. deleted on another device, or a repeated request).
    return { status: "saved", savedAt: new Date().toISOString(), record: null };
  }

  function invalidDraft(draft: ActivityDraft) {
    const errors = validateActivityDraft(draft);
    const first = Object.values(errors)[0];
    return first ? { errors, reason: first } : null;
  }

  return {
    kind: "supabase",
    isSample: false,

    getProfile,
    async getGoalVersions() {
      const rows = await select("targets", client.from("goal_versions").select("*").order("effective_from"));
      return rows.length > 0 ? rows.map(toGoalVersion) : [DEFAULT_GOALS];
    },
    async getToday() {
      return localDateOf(new Date(), (await getProfile()).timezone);
    },

    async listSleepEntries(range) {
      const rows = await select("sleep entries", rangeFilter(client.from("sleep_entries").select("*"), "waking_date", range).order("waking_date"));
      return rows.map(toSleepEntry);
    },
    async listEveningEntries(range) {
      const rows = await select("evening entries", rangeFilter(client.from("evening_entries").select("*"), "local_date", range).order("local_date"));
      return rows.map(toEveningEntry);
    },
    async listSymptomEntries(range) {
      const rows = await select("symptoms", rangeFilter(client.from("symptom_entries").select("*"), "local_date", range).order("observed_at"));
      return rows.map(toSymptomEntry);
    },
    async listActivities(range) {
      const rows = await select(
        "activities",
        rangeFilter(client.from("activities").select("*"), "local_date", range).order("local_date").order("started_at"),
      );
      return rows.map(toActivity);
    },
    // Weight entries are a later task; there is no table yet.
    listWeightEntries: async () => [],

    async getActivity(id) {
      const { data, error } = await client.from("activities").select("*, activity_sources(*)").eq("id", id).maybeSingle();
      if (error) {
        logError("get activity", error);
        throw new Error("Could not load the activity.");
      }
      if (!data) return null;
      const { activity_sources: sources, ...row } = data as Row & { activity_sources: Row[] };
      return { activity: toActivity(row), sources: (sources ?? []).map(toActivitySource) };
    },

    async findDuplicateCandidates(probe) {
      // Narrow by type and nearby dates in SQL, then apply the exact rule.
      const range = { start: addDays(probe.localDate, -1), end: addDays(probe.localDate, 1) };
      const rows = await select(
        "duplicate candidates",
        rangeFilter(client.from("activities").select("*").eq("type", probe.type).eq("canonical_status", "canonical"), "local_date", range),
      );
      return rows.map(toActivity).filter((a) => isSuspectedDuplicate(probe, a));
    },

    async findImportedFile(sha256) {
      const { data, error } = await client
        .from("import_files")
        .select("file_hash, file_kind, imported_at, activity_sources(activity_id)")
        .eq("file_hash", sha256.toLowerCase())
        .maybeSingle();
      if (error) {
        logError("find imported file", error);
        throw new Error("Could not check earlier imports.");
      }
      if (!data) return null;
      const row = data as Row & { activity_sources: { activity_id: string }[] };
      return {
        fileHash: String(row.file_hash),
        fileKind: row.file_kind as "tcx" | "fit",
        importedAt: new Date(String(row.imported_at)).toISOString(),
        activityIds: [...new Set(row.activity_sources.map((s) => s.activity_id))],
      };
    },

    async saveConfirmedImport(input): Promise<ImportSaveResult> {
      for (const [sessionIndex, session] of input.sessions.entries()) {
        const invalid = invalidDraft(session.draft);
        if (invalid) return { status: "invalid", sessionIndex, ...invalid };
      }
      if (!/^[0-9a-f]{64}$/i.test(input.file.sha256)) {
        return { status: "invalid", sessionIndex: 0, reason: "The file hash is not a SHA-256 value.", errors: {} };
      }
      const { data, error } = await client.rpc("import_confirmed_activities", { p: importPayload(input) });
      if (error) {
        logError("import_confirmed_activities", error);
        return { status: "failed", reason: SAVE_FAILED };
      }
      const r = data as RpcResult;
      switch (r.status) {
        case "saved":
          return { status: "saved", savedAt: new Date(String(r.saved_at)).toISOString(), activityIds: r.activity_ids as string[] };
        case "duplicate_file":
          return { status: "duplicate_file", reason: String(r.reason), importedAt: new Date(String(r.imported_at)).toISOString() };
        case "conflict":
          return { status: "conflict", reason: String(r.reason), activityId: String(r.activity_id) };
        case "invalid":
          return { status: "invalid", reason: "A workout has values the database does not accept.", sessionIndex: Number(r.session_index), errors: {} };
        default:
          return { status: "failed", reason: SAVE_FAILED };
      }
    },

    async createActivity(draft, meta) {
      const invalid = invalidDraft(draft);
      if (invalid) return { status: "failed", reason: invalid.reason };
      return rpc("create_manual_activity", { request_id: meta.requestId, draft: draftToRow(draft) }, toActivity);
    },
    async updateActivity(id, draft, meta) {
      const invalid = invalidDraft(draft);
      if (invalid) return { status: "failed", reason: invalid.reason };
      if (meta.expectedRevision === null) return { status: "conflict", reason: "Reload the activity before editing it." };
      return rpc(
        "update_activity",
        { id, expected_revision: meta.expectedRevision, request_id: meta.requestId, draft: draftToRow(draft) },
        toActivity,
      );
    },
    deleteActivity: (input) => remove("activities", input),

    async saveMorningCheckIn(input, meta) {
      const { timezone } = await getProfile();
      return rpc("save_morning_check_in", morningPayload(input, meta, timezone), toSleepEntry);
    },
    async saveEveningCheckIn(input, meta) {
      const { timezone } = await getProfile();
      return rpc("save_evening_check_in", eveningPayload(input, meta, timezone), toEveningEntry);
    },
    deleteSleepEntry: (input) => remove("sleep_entries", input),
    deleteEveningEntry: (input) => remove("evening_entries", input),

    async getSymptomEntry(id) {
      const { data, error } = await client.from("symptom_entries").select("*").eq("id", id).maybeSingle();
      if (error) {
        logError("get symptom", error);
        throw new Error("Could not load the symptom entry.");
      }
      return data ? toSymptomEntry(data) : null;
    },
    async saveSymptomEntry(id, { localDate, observedAt, symptom }, meta) {
      const { timezone } = await getProfile();
      const values = { ...symptomPayload(symptom), local_date: localDate, observed_at: observedAt, last_request_id: meta.requestId };
      if (id === null) {
        const inserted = await client
          .from("symptom_entries")
          .insert({ ...values, timezone, context: "standalone", created_request_id: meta.requestId })
          .select("*")
          .single();
        if (!inserted.error) return { status: "saved", savedAt: String(inserted.data.updated_at), record: toSymptomEntry(inserted.data) };
        if (inserted.error.code !== "23505") {
          logError("insert symptom", inserted.error);
          return { status: "failed", reason: SAVE_FAILED };
        }
        // Repeated request: return what the first one saved.
        const prior = await client.from("symptom_entries").select("*").eq("created_request_id", meta.requestId).single();
        return prior.error
          ? { status: "failed", reason: SAVE_FAILED }
          : { status: "saved", savedAt: String(prior.data.updated_at), record: toSymptomEntry(prior.data) };
      }

      const current = await client.from("symptom_entries").select("*").eq("id", id).maybeSingle();
      if (current.error) return { status: "failed", reason: SAVE_FAILED };
      if (!current.data) return { status: "not_found", reason: "This symptom entry no longer exists." };
      if (current.data.last_request_id === meta.requestId) {
        return { status: "saved", savedAt: String(current.data.updated_at), record: toSymptomEntry(current.data) };
      }
      const updated = await client
        .from("symptom_entries")
        .update(values)
        .eq("id", id)
        .eq("revision", meta.expectedRevision ?? -1)
        .select("*");
      if (updated.error) {
        logError("update symptom", updated.error);
        return { status: "failed", reason: SAVE_FAILED };
      }
      if (updated.data.length === 0) {
        return { status: "conflict", reason: "This symptom entry was changed on another device. Reload to see the latest version." };
      }
      return { status: "saved", savedAt: String(updated.data[0].updated_at), record: toSymptomEntry(updated.data[0]) };
    },
    deleteSymptomEntry: (input) => remove("symptom_entries", input),
  };
}
