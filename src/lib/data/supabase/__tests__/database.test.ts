// Database-level tests: the real migrations in an in-process Postgres.
// Covers ownership (AC16), save/edit without duplicates (AC01–AC03, AC08),
// atomic import, and date handling.
import { beforeAll, describe, expect, it } from "vitest";

import type { ActivityDraft } from "@/lib/domain/activity";
import type { EveningCheckIn, MorningCheckIn } from "@/lib/domain/checkins";
import type { ConfirmedImport } from "../../repository";
import { draftToRow, eveningPayload, importPayload, morningPayload } from "../mapping";
import { createTestDb, type TestDb } from "./pg-harness";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const OUTSIDER = "00000000-0000-4000-8000-0000000000cc";
const TZ = "America/Los_Angeles";

let t: TestDb;
let n = 0;
const uuid = () => `11111111-1111-4111-8111-${String(++n).padStart(12, "0")}`;
const meta = (expectedRevision: number | null = null) => ({ requestId: uuid(), expectedRevision });

const morning = (overrides: Partial<MorningCheckIn> = {}): MorningCheckIn => ({
  wakingDate: "2026-10-20",
  durationMinSeconds: 450 * 60,
  durationMaxSeconds: 480 * 60,
  approximate: true,
  totalInterruptions: 0,
  babyInterruptions: null,
  restfulness: "well_rested",
  morningFatigue: "energetic",
  note: null,
  symptom: null,
  ...overrides,
});

const ankle = {
  anklePain: 0,
  side: null,
  flareReported: false,
  newOrWorsening: false,
  swellingHeatRedness: false,
  weightBearingDifficulty: false,
  feverOrUnwell: null,
};

const evening = (overrides: Partial<EveningCheckIn> = {}): EveningCheckIn => ({
  localDate: "2026-10-20",
  activityStatus: "logged",
  newActivities: [],
  confirmRemoveExisting: false,
  seenActivityIds: [],
  eveningFatigue: "mildly_tired",
  recoveryDay: false,
  symptom: ankle,
  ...overrides,
});

const walk = (minutes = 15) => ({
  requestId: uuid(),
  type: "walking" as const,
  durationMinutes: minutes,
  intensity: "easy" as const,
  startTime: "18:30",
});

function rideDraft(overrides: Partial<ActivityDraft> = {}): ActivityDraft {
  return {
    type: "cycling",
    startedAt: "2026-10-19T01:40:00.000Z", // 6:40 PM Oct 18 in Los Angeles
    localDate: "2026-10-18",
    timezone: TZ,
    elapsedSeconds: 3480,
    activeSeconds: 3360,
    reportedSeconds: null,
    durationBasis: "active",
    distanceMeters: 21500,
    avgHeartRateBpm: 128,
    maxHeartRateBpm: null,
    intensity: "unknown",
    note: null,
    fieldProvenance: { activeSeconds: { source: "fit", kind: "measured" } },
    ...overrides,
  };
}

function fitImport(
  sha: string,
  resolution: ConfirmedImport["sessions"][number]["resolution"] = { kind: "create" },
  draft = rideDraft(),
): ConfirmedImport {
  return {
    requestId: uuid(),
    file: { sha256: sha, kind: "fit", filenameSanitized: "ride.fit" },
    sessions: [
      { draft, source: { sourceKind: "fit", providerId: null, importedSummary: { sport: "cycling" }, decoderVersion: "test-1" }, resolution },
    ],
  };
}
const sha = (c: string) => c.repeat(64);

async function selectAs(user: string | null, sql: string, params: unknown[] = []) {
  return t.as(user, async () => (await t.db.query<Record<string, unknown>>(sql, params)).rows);
}

beforeAll(async () => {
  t = await createTestDb();
  await t.createUser(A);
  await t.createUser(B);
  await t.createUser(OUTSIDER, false);
}, 60_000);

describe("ownership enforced by row-level security (AC16)", () => {
  it("hides one user's rows from another and from anonymous requests", async () => {
    const saved = await t.rpc(A, "save_morning_check_in", morningPayload(morning({ wakingDate: "2026-09-01" }), meta(), TZ));
    expect(saved.status).toBe("saved");
    const id = (saved.record as { id: string }).id;

    expect(await selectAs(B, "select id from public.sleep_entries where id = $1", [id])).toEqual([]);
    await expect(selectAs(null, "select id from public.sleep_entries")).rejects.toThrow(/permission denied/);

    const updated = await selectAs(B, "update public.sleep_entries set note = 'x' where id = $1 returning id", [id]);
    expect(updated).toEqual([]);
    const deleted = await selectAs(B, "delete from public.sleep_entries where id = $1 returning id", [id]);
    expect(deleted).toEqual([]);
    expect(await t.count("public.sleep_entries", `id = '${id}' and note is null`)).toBe(1);
  });

  it("rejects writing a row owned by someone else", async () => {
    await expect(
      selectAs(B, `insert into public.symptom_entries (user_id, observed_at, local_date, timezone, context)
                   values ($1, now(), '2026-10-20', $2, 'standalone')`, [A, TZ]),
    ).rejects.toThrow(/row-level security/);
  });

  it("does not let a user reassign a row to another owner", async () => {
    const [row] = await selectAs(A, `insert into public.symptom_entries (observed_at, local_date, timezone, context)
                                    values (now(), '2026-10-20', $1, 'standalone') returning id`, [TZ]);
    await selectAs(A, "update public.symptom_entries set user_id = $1 where id = $2", [B, row.id]);
    expect(await t.count("public.symptom_entries", `id = '${row.id}' and user_id = '${A}'`)).toBe(1);
  });

  it("gives a signed-in account that is not on the allowlist no access", async () => {
    await expect(
      t.rpc(OUTSIDER, "save_morning_check_in", morningPayload(morning(), meta(), TZ)),
    ).rejects.toThrow(/row-level security/);
    expect(await selectAs(OUTSIDER, "select id from public.sleep_entries")).toEqual([]);
    await expect(selectAs(OUTSIDER, "select * from daykind_private.allowed_users")).rejects.toThrow(/permission denied/);
  });

  it("does not let one user link an import to another user's activity", async () => {
    const own = await t.rpc(A, "import_confirmed_activities", importPayload(fitImport(sha("1"))));
    const activityId = (own.activity_ids as string[])[0];
    const r = await t.rpc(B, "import_confirmed_activities",
      importPayload(fitImport(sha("2"), { kind: "link", activityId, expectedRevision: 1 })));
    expect(r.status).toBe("conflict");
    expect(await t.count("public.import_files", `file_hash = '${sha("2")}'`)).toBe(0);
  });
});

describe("morning check-in persistence (AC01, AC02)", () => {
  it("stores a 7.5–8 h range once, with zero distinct from unknown", async () => {
    const r = await t.rpc(A, "save_morning_check_in", morningPayload(morning(), meta(), TZ));
    expect(r.status).toBe("saved");
    const row = r.record as Record<string, unknown>;
    expect([row.duration_min_seconds, row.duration_max_seconds]).toEqual([27000, 28800]);
    expect(row.total_interruptions).toBe(0);
    expect(row.baby_interruptions).toBeNull();
    expect(row.revision).toBe(1);
  });

  it("returns the original result for a repeated submission", async () => {
    const m = meta();
    const first = await t.rpc(A, "save_morning_check_in", morningPayload(morning({ wakingDate: "2026-10-10" }), m, TZ));
    const again = await t.rpc(A, "save_morning_check_in", morningPayload(morning({ wakingDate: "2026-10-10" }), m, TZ));
    expect(again).toEqual(first);
    expect(await t.count("public.sleep_entries", `user_id = '${A}' and waking_date = '2026-10-10'`)).toBe(1);
  });

  it("refuses a second check-in for the same waking date (e.g. from another device)", async () => {
    const r = await t.rpc(A, "save_morning_check_in", morningPayload(morning({ note: "phone" }), meta(), TZ));
    expect(r.status).toBe("conflict");
    expect(await t.count("public.sleep_entries", `user_id = '${A}' and waking_date = '2026-10-20'`)).toBe(1);
  });

  it("edits in place, bumps the revision, and rejects a stale edit", async () => {
    const edited = await t.rpc(A, "save_morning_check_in",
      morningPayload(morning({ approximate: false, durationMinSeconds: 7 * 3600, durationMaxSeconds: 7 * 3600, totalInterruptions: 3, babyInterruptions: 3 }), meta(1), TZ));
    expect(edited.status).toBe("saved");
    const row = edited.record as Record<string, unknown>;
    expect(row.revision).toBe(2);
    expect(row.duration_min_seconds).toBe(7 * 3600); // awakenings are not subtracted again

    const stale = await t.rpc(A, "save_morning_check_in", morningPayload(morning({ note: "old tab" }), meta(1), TZ));
    expect(stale.status).toBe("conflict");
    expect(await t.count("public.sleep_entries", `user_id = '${A}' and waking_date = '2026-10-20'`)).toBe(1);
  });

  it("updates the check-in's own symptom on edit instead of adding another", async () => {
    const date = "2026-10-11";
    const first = await t.rpc(A, "save_morning_check_in",
      morningPayload(morning({ wakingDate: date, symptom: { ...ankle, anklePain: 3 } }), meta(), TZ));
    await t.rpc(A, "save_morning_check_in",
      morningPayload(morning({ wakingDate: date, symptom: { ...ankle, anklePain: 1 } }), meta(1), TZ, (first.record as { id: string }).id));
    const rows = await selectAs(A, "select ankle_pain from public.symptom_entries where local_date = $1 and context = 'morning'", [date]);
    expect(rows).toEqual([{ ankle_pain: 1 }]);
  });

  it("rejects more baby-care interruptions than total in the database too", async () => {
    await expect(
      t.rpc(A, "save_morning_check_in", morningPayload(morning({ wakingDate: "2026-10-12", totalInterruptions: 2, babyInterruptions: 3 }), meta(), TZ)),
    ).rejects.toThrow(/check constraint/);
  });

  it("reports a deleted entry as not found when edited from another device", async () => {
    const r = await t.rpc(A, "save_morning_check_in", morningPayload(morning({ wakingDate: "2026-10-13" }), meta(), TZ));
    const id = (r.record as { id: string }).id;
    await selectAs(A, "delete from public.sleep_entries where id = $1", [id]);
    const edit = await t.rpc(A, "save_morning_check_in", morningPayload(morning({ wakingDate: "2026-10-13" }), meta(1), TZ, id));
    expect(edit.status).toBe("not_found");
  });
});

describe("evening check-in persistence (AC03)", () => {
  const date = "2026-10-15";

  it("saves the review, the walk, and the symptom together, once", async () => {
    const input = evening({ localDate: date, newActivities: [walk(15)] });
    const m = meta();
    const r = await t.rpc(A, "save_evening_check_in", eveningPayload(input, m, TZ));
    expect(r.status).toBe("saved");
    // Same submission again, then the same quick-add retried inside a new request.
    await t.rpc(A, "save_evening_check_in", eveningPayload(input, m, TZ));
    await t.rpc(A, "save_evening_check_in", eveningPayload(input, meta(1), TZ));

    expect(await t.count("public.evening_entries", `local_date = '${date}'`)).toBe(1);
    expect(await t.count("public.activities", `local_date = '${date}'`)).toBe(1);
    expect(await t.count("public.symptom_entries", `local_date = '${date}' and context = 'evening'`)).toBe(1);
    const [a] = await selectAs(A, "select reported_seconds, duration_basis, goal_seconds, source, started_at from public.activities where local_date = $1", [date]);
    expect(a).toMatchObject({ reported_seconds: 900, duration_basis: "reported", goal_seconds: 900, source: "manual" });
    expect(new Date(a.started_at as string).toISOString()).toBe("2026-10-16T01:30:00.000Z");
    expect(await t.count("public.activity_sources s join public.activities a on a.id = s.activity_id", `a.local_date = '${date}' and s.source_kind = 'manual'`)).toBe(1);
  });

  it("needs the walk's id before “no activity” may remove it", async () => {
    const [row] = await selectAs(A, "select revision from public.evening_entries where local_date = $1", [date]);
    const unconfirmed = await t.rpc(A, "save_evening_check_in",
      eveningPayload(evening({ localDate: date, activityStatus: "confirmed_none" }), meta(row.revision as number), TZ));
    expect(unconfirmed.status).toBe("conflict");
    expect(await t.count("public.activities", `local_date = '${date}'`)).toBe(1);

    const [activity] = await selectAs(A, "select id from public.activities where local_date = $1", [date]);
    const confirmed = await t.rpc(A, "save_evening_check_in", eveningPayload(
      evening({ localDate: date, activityStatus: "confirmed_none", confirmRemoveExisting: true, seenActivityIds: [activity.id as string] }),
      meta(row.revision as number), TZ));
    expect(confirmed.status).toBe("saved");
    expect(await t.count("public.activities", `local_date = '${date}'`)).toBe(0);
  });

  it("refuses “logged” when no activity exists any more", async () => {
    const r = await t.rpc(A, "save_evening_check_in", eveningPayload(evening({ localDate: "2026-10-16" }), meta(), TZ));
    expect(r.status).toBe("conflict");
    expect(await t.count("public.evening_entries", "local_date = '2026-10-16'")).toBe(0);
  });

  it("keeps “unknown” distinct from confirmed none", async () => {
    const r = await t.rpc(A, "save_evening_check_in",
      eveningPayload(evening({ localDate: "2026-10-17", activityStatus: "unknown", symptom: { ...ankle, anklePain: null } }), meta(), TZ));
    expect((r.record as Record<string, unknown>).activity_status).toBe("unknown");
    const [s] = await selectAs(A, "select ankle_pain from public.symptom_entries where local_date = '2026-10-17'");
    expect(s.ankle_pain).toBeNull();
  });
});

describe("confirmed import (AC08)", () => {
  it("saves atomically, blocks an identical file, and replays a retry", async () => {
    const input = fitImport(sha("a"));
    const first = await t.rpc(A, "import_confirmed_activities", importPayload(input));
    expect(first.status).toBe("saved");
    expect(await t.rpc(A, "import_confirmed_activities", importPayload(input))).toMatchObject({
      status: "saved",
      activity_ids: first.activity_ids,
    });
    const again = await t.rpc(A, "import_confirmed_activities", importPayload(fitImport(sha("a"))));
    expect(again.status).toBe("duplicate_file");
    expect(await t.count("public.activities", `id = any('{${(first.activity_ids as string[]).join(",")}}')`)).toBe(1);
  });

  it("links to a manual activity, keeping its note while measured fields come from the file", async () => {
    const created = await t.rpc(A, "create_manual_activity", {
      request_id: uuid(),
      draft: draftToRow(rideDraft({ elapsedSeconds: null, activeSeconds: null, reportedSeconds: 3400, durationBasis: "reported",
        distanceMeters: null, avgHeartRateBpm: null, intensity: "moderate", note: "felt good", startedAt: null, fieldProvenance: {} })),
    });
    const target = created.record as { id: string; revision: number };
    const r = await t.rpc(A, "import_confirmed_activities",
      importPayload(fitImport(sha("b"), { kind: "link", activityId: target.id, expectedRevision: target.revision })));
    expect(r.activity_ids).toEqual([target.id]);
    const [row] = await selectAs(A, "select note, intensity, duration_basis, goal_seconds, avg_heart_rate_bpm, canonical_status from public.activities where id = $1", [target.id]);
    expect(row).toMatchObject({ note: "felt good", intensity: "moderate", duration_basis: "active", goal_seconds: 3360, avg_heart_rate_bpm: 128, canonical_status: "canonical" });
    expect(await t.count("public.activity_sources", `activity_id = '${target.id}'`)).toBe(2);
  });

  it("replace counts the import once, and deleting it restores the original", async () => {
    const created = await t.rpc(A, "create_manual_activity", {
      request_id: uuid(),
      draft: draftToRow(rideDraft({ localDate: "2026-10-05", startedAt: null, activeSeconds: null, elapsedSeconds: null, reportedSeconds: 1800, durationBasis: "reported" })),
    });
    const old = created.record as { id: string };
    const r = await t.rpc(A, "import_confirmed_activities", importPayload(fitImport(sha("c"),
      { kind: "replace", activityId: old.id, expectedRevision: 1 },
      rideDraft({ startedAt: "2026-10-05T17:00:00.000Z", localDate: "2026-10-05" }))));
    const newId = (r.activity_ids as string[])[0];
    expect(await t.count("public.activities", "local_date = '2026-10-05' and canonical_status = 'canonical'")).toBe(1);

    await selectAs(A, "delete from public.activities where id = $1", [newId]);
    const [restored] = await selectAs(A, "select canonical_status, linked_activity_id from public.activities where id = $1", [old.id]);
    expect(restored).toEqual({ canonical_status: "canonical", linked_activity_id: null });
    // The file has no activities left, so it may be imported again.
    expect(await t.count("public.import_files", `file_hash = '${sha("c")}'`)).toBe(0);
  });

  it("writes nothing when a link target changed since the preview", async () => {
    const created = await t.rpc(A, "create_manual_activity", { request_id: uuid(), draft: draftToRow(rideDraft({ localDate: "2026-10-06", startedAt: null })) });
    const target = created.record as { id: string };
    const input = fitImport(sha("d"), { kind: "create" });
    input.sessions.push({ ...input.sessions[0], resolution: { kind: "link", activityId: target.id, expectedRevision: 7 } });
    const r = await t.rpc(A, "import_confirmed_activities", importPayload(input));
    expect(r.status).toBe("conflict");
    expect(await t.count("public.import_files", `file_hash = '${sha("d")}'`)).toBe(0);
    expect(await t.count("public.activity_sources", `file_hash = '${sha("d")}'`)).toBe(0);
  });

  it("reports an invalid session without partial data", async () => {
    const r = await t.rpc(A, "import_confirmed_activities",
      importPayload(fitImport(sha("e"), { kind: "create" }, rideDraft({ activeSeconds: 4000, elapsedSeconds: 3000 }))));
    expect(r).toMatchObject({ status: "invalid", session_index: 0 });
    expect(await t.count("public.import_files", `file_hash = '${sha("e")}'`)).toBe(0);
  });
});

describe("dates and timezones", () => {
  it("rejects an activity whose local date is not its local start date", async () => {
    await expect(t.rpc(A, "create_manual_activity", {
      request_id: uuid(),
      draft: draftToRow(rideDraft({ localDate: "2026-10-19" })), // starts 6:40 PM on the 18th in Los Angeles
    })).rejects.toThrow(/check constraint/);
  });

  it("accepts Etc/GMT zones chosen for a watch's fixed offset", async () => {
    const r = await t.rpc(A, "create_manual_activity", {
      request_id: uuid(),
      draft: draftToRow(rideDraft({ timezone: "Etc/GMT+8", startedAt: "2026-10-19T07:30:00.000Z", localDate: "2026-10-18" })),
    });
    expect(r.status).toBe("saved");
  });

  it("rejects an unknown timezone and goal versions that do not start on a Monday", async () => {
    await expect(t.rpc(A, "create_manual_activity", { request_id: uuid(), draft: draftToRow(rideDraft({ timezone: "Mars/Olympus" })) }))
      .rejects.toThrow(/check constraint|time zone/);
    const imported = await t.rpc(A, "import_confirmed_activities",
      importPayload(fitImport(sha("f"), { kind: "create" }, rideDraft({ timezone: "Mars/Olympus" }))));
    expect(imported.status).toBe("invalid");
    await expect(selectAs(A, `insert into public.goal_versions (effective_from, walking_seconds_per_day, resistance_sessions_per_week, cycling_seconds_per_week)
                              values ('2026-10-20', 600, 2, 3600)`)).rejects.toThrow(/check constraint/);
  });
});
