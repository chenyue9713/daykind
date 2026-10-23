// Database-level tests for onboarding and preferences: the real migrations in
// an in-process Postgres. Covers onboarding persistence, timezone validation,
// next-Monday target versions, pending-version edits, preservation of targets
// already in effect and of record dates, and ownership.
import { beforeAll, describe, expect, it } from "vitest";

import type { MorningCheckIn } from "@/lib/domain/checkins";
import type { PreferencesWrite } from "../../repository";
import { morningPayload, preferencesPayload, targetsPayload } from "../mapping";
import { createTestDb, type TestDb } from "./pg-harness";

const A = "00000000-0000-4000-8000-00000000001a";
const B = "00000000-0000-4000-8000-00000000001b";
const C = "00000000-0000-4000-8000-00000000001c";
const OUTSIDER = "00000000-0000-4000-8000-0000000001cc";

let t: TestDb;
let n = 0;
const uuid = () => `22222222-2222-4222-8222-${String(++n).padStart(12, "0")}`;

const DEFAULTS = { walkingSecondsPerDay: 600, resistanceSessionsPerWeek: 2, cyclingSecondsPerWeek: 3600 };

function setup(overrides: Partial<PreferencesWrite> = {}): PreferencesWrite {
  return {
    preferences: { timezone: "America/Los_Angeles", distanceUnit: "km", weightUnit: "kg", weightTrackingEnabled: true },
    acknowledgeGuidance: true,
    completeOnboarding: true,
    targets: { values: DEFAULTS, pendingId: null, expectedRevision: null },
    ...overrides,
  };
}

async function rows(user: string | null, sql: string, params: unknown[] = []) {
  return t.as(user, async () => (await t.db.query<Record<string, unknown>>(sql, params)).rows);
}

async function profile(user: string) {
  return (await rows(user, "select * from public.profiles"))[0];
}

/** Today in the user's saved timezone and the Monday after it, computed by Postgres. */
async function localDates(user: string) {
  const [r] = await rows(
    user,
    `select to_char(daykind_private.local_today($1), 'YYYY-MM-DD') as today,
            to_char(daykind_private.next_monday(daykind_private.local_today($1)), 'YYYY-MM-DD') as next`,
    [user],
  );
  return r as { today: string; next: string };
}

async function goals(user: string) {
  return rows(
    user,
    `select id, to_char(effective_from, 'YYYY-MM-DD') as effective_from, walking_seconds_per_day, revision
       from public.goal_versions order by effective_from`,
  );
}

beforeAll(async () => {
  t = await createTestDb();
  for (const user of [A, B, C]) {
    await t.createUser(user);
    await rows(user, "insert into public.profiles default values");
  }
  await t.createUser(OUTSIDER, false);
}, 60_000);

describe("next Monday in SQL", () => {
  it("matches the app's rule", async () => {
    const [r] = await rows(
      A,
      `select to_char(daykind_private.next_monday('2026-10-21'), 'YYYY-MM-DD') as wed,
              to_char(daykind_private.next_monday('2026-10-25'), 'YYYY-MM-DD') as sun,
              to_char(daykind_private.next_monday('2026-10-26'), 'YYYY-MM-DD') as mon`,
    );
    expect(r).toEqual({ wed: "2026-10-26", sun: "2026-10-26", mon: "2026-11-02" });
  });
});

describe("onboarding persistence", () => {
  it("starts unconfirmed and not set up", async () => {
    const p = await profile(A);
    expect(p).toMatchObject({ timezone: "America/Los_Angeles", timezone_confirmed: false, onboarding_completed_at: null });
  });

  it("refuses to finish without the guidance acknowledgment, in the function and the table", async () => {
    const p = await profile(A);
    const r = await t.rpc(A, "save_preferences", preferencesPayload(setup({ acknowledgeGuidance: false }), { requestId: uuid(), expectedRevision: Number(p.revision) }));
    expect(r.status).toBe("invalid");
    await expect(rows(A, "update public.profiles set onboarding_completed_at = now(), timezone_confirmed = true")).rejects.toThrow(/check constraint/);
  });

  it("rejects an unknown timezone", async () => {
    const p = await profile(A);
    const bad = setup({ preferences: { ...setup().preferences, timezone: "Mars/Olympus" } });
    const r = await t.rpc(A, "save_preferences", preferencesPayload(bad, { requestId: uuid(), expectedRevision: Number(p.revision) }));
    expect(r.status).toBe("invalid");
    expect((await profile(A)).timezone).toBe("America/Los_Angeles");
  });

  it("saves confirmed preferences and the acknowledgment once, and replays a retry", async () => {
    const before = await profile(A);
    const meta = { requestId: uuid(), expectedRevision: Number(before.revision) };
    const first = await t.rpc(A, "save_preferences", preferencesPayload(setup(), meta));
    expect(first.status).toBe("saved");
    expect(first.goal).toEqual({ status: "unchanged" }); // default targets: no version needed

    const saved = await profile(A);
    expect(saved).toMatchObject({ timezone_confirmed: true, distance_unit: "km", weight_unit: "kg", weight_tracking_enabled: true });
    expect(saved.onboarding_completed_at).not.toBeNull();
    expect(saved.guidance_limits_acknowledged_at).not.toBeNull();
    expect(saved.revision).toBe(Number(before.revision) + 1);

    const retry = await t.rpc(A, "save_preferences", preferencesPayload(setup(), meta));
    expect(retry.status).toBe("saved");
    expect((await profile(A)).revision).toBe(saved.revision);
    expect(await goals(A)).toEqual([]);
  });

  it("rejects a stale revision, e.g. a second device", async () => {
    const r = await t.rpc(A, "save_preferences", preferencesPayload(setup(), { requestId: uuid(), expectedRevision: 1 }));
    expect(r.status).toBe("conflict");
  });

  it("schedules changed targets for next Monday, keeping the defaults for earlier weeks", async () => {
    const p = await profile(B);
    const changed = setup({ targets: { values: { ...DEFAULTS, walkingSecondsPerDay: 900 }, pendingId: null, expectedRevision: null } });
    const r = await t.rpc(B, "save_preferences", preferencesPayload(changed, { requestId: uuid(), expectedRevision: Number(p.revision) }));
    expect(r.status).toBe("saved");
    const { next } = await localDates(B);
    expect(await goals(B)).toMatchObject([
      { effective_from: "1970-01-05", walking_seconds_per_day: 600 },
      { effective_from: next, walking_seconds_per_day: 900 },
    ]);
  });

  it("saves nothing when the targets part conflicts", async () => {
    const p = await profile(C);
    const stale = setup({
      preferences: { ...setup().preferences, timezone: "Europe/Berlin" },
      targets: { values: { ...DEFAULTS, walkingSecondsPerDay: 1200 }, pendingId: uuid(), expectedRevision: 3 },
    });
    // No pending version exists, so this edit of one is stale.
    const r = await t.rpc(C, "save_preferences", preferencesPayload(stale, { requestId: uuid(), expectedRevision: Number(p.revision) }));
    expect(r.status).toBe("conflict");
    expect(await profile(C)).toMatchObject({ timezone: "America/Los_Angeles", onboarding_completed_at: null, revision: p.revision });
    expect(await goals(C)).toEqual([]);
  });
});

describe("target versions", () => {
  const target = (walkingMinutes: number) => ({ ...DEFAULTS, walkingSecondsPerDay: walkingMinutes * 60 });

  it("edits the pending version in place instead of adding another", async () => {
    const [, pending] = await goals(B);
    const r = await t.rpc(B, "save_goal_version", targetsPayload(target(20), {
      requestId: uuid(), id: String(pending.id), expectedRevision: Number(pending.revision),
    }));
    expect(r.status).toBe("saved");
    const after = await goals(B);
    expect(after).toHaveLength(2);
    expect(after[1]).toMatchObject({ id: pending.id, walking_seconds_per_day: 1200, revision: Number(pending.revision) + 1 });
  });

  it("rejects a stale edit and a second new version while one is pending", async () => {
    const [, pending] = await goals(B);
    const stale = await t.rpc(B, "save_goal_version", targetsPayload(target(25), {
      requestId: uuid(), id: String(pending.id), expectedRevision: Number(pending.revision) - 1,
    }));
    expect(stale.status).toBe("conflict");
    const duplicate = await t.rpc(B, "save_goal_version", targetsPayload(target(25), { requestId: uuid(), id: null, expectedRevision: null }));
    expect(duplicate.status).toBe("conflict");
    expect(await goals(B)).toHaveLength(2);
  });

  it("returns the original result for a repeated request", async () => {
    const [, pending] = await goals(B);
    const meta = { requestId: uuid(), id: String(pending.id), expectedRevision: Number(pending.revision) };
    await t.rpc(B, "save_goal_version", targetsPayload(target(30), meta));
    const again = await t.rpc(B, "save_goal_version", targetsPayload(target(30), meta));
    expect(again.status).toBe("saved");
    expect((await goals(B))[1]).toMatchObject({ walking_seconds_per_day: 1800, revision: Number(pending.revision) + 1 });
  });

  it("removes the pending version when set back to the targets in effect", async () => {
    const [, pending] = await goals(B);
    const r = await t.rpc(B, "save_goal_version", targetsPayload(DEFAULTS, {
      requestId: uuid(), id: String(pending.id), expectedRevision: Number(pending.revision),
    }));
    expect(r).toMatchObject({ status: "saved", record: null });
    expect(await goals(B)).toMatchObject([{ effective_from: "1970-01-05" }]);
    const unchanged = await t.rpc(B, "save_goal_version", targetsPayload(DEFAULTS, { requestId: uuid(), id: null, expectedRevision: null }));
    expect(unchanged.status).toBe("unchanged");
  });

  it("requires a confirmed timezone", async () => {
    const r = await t.rpc(C, "save_goal_version", targetsPayload(target(15), { requestId: uuid(), id: null, expectedRevision: null }));
    expect(r.status).toBe("invalid");
  });

  it("enforces target bounds in the database", async () => {
    await expect(t.rpc(A, "save_goal_version", targetsPayload(target(0), { requestId: uuid(), id: null, expectedRevision: null })))
      .rejects.toThrow(/check constraint/);
  });
});

describe("history is preserved", () => {
  it("refuses changes to targets already in effect, and backdated versions", async () => {
    const [baseline] = await goals(B);
    await expect(rows(B, "update public.goal_versions set walking_seconds_per_day = 900 where id = $1", [baseline.id]))
      .rejects.toThrow(/already in effect/);
    await expect(rows(B, "delete from public.goal_versions where id = $1", [baseline.id])).rejects.toThrow(/already in effect/);
    const { today } = await localDates(B);
    await expect(rows(B, `insert into public.goal_versions (effective_from, walking_seconds_per_day, resistance_sessions_per_week, cycling_seconds_per_week)
                          values (date_trunc('week', $1::date)::date, 900, 2, 3600)`, [today])).rejects.toThrow(/start after today/);
    expect(await goals(B)).toMatchObject([{ walking_seconds_per_day: 600, revision: 1 }]);
  });

  it("keeps saved records' dates and timezones when the timezone changes", async () => {
    const checkIn: MorningCheckIn = {
      wakingDate: "2026-10-01",
      durationMinSeconds: 25200,
      durationMaxSeconds: 25200,
      approximate: false,
      totalInterruptions: 1,
      babyInterruptions: 1,
      restfulness: "somewhat_rested",
      morningFatigue: "mildly_tired",
      note: null,
      symptom: null,
    };
    expect((await t.rpc(A, "save_morning_check_in", morningPayload(checkIn, { requestId: uuid(), expectedRevision: null }, "America/Los_Angeles"))).status).toBe("saved");

    const p = await profile(A);
    const tokyo = setup({ preferences: { ...setup().preferences, timezone: "Asia/Tokyo" }, completeOnboarding: false, acknowledgeGuidance: false, targets: null });
    expect((await t.rpc(A, "save_preferences", preferencesPayload(tokyo, { requestId: uuid(), expectedRevision: Number(p.revision) }))).status).toBe("saved");

    expect(await profile(A)).toMatchObject({ timezone: "Asia/Tokyo" });
    expect((await profile(A)).onboarding_completed_at).toEqual(p.onboarding_completed_at);
    expect(await rows(A, "select to_char(waking_date, 'YYYY-MM-DD') as d, timezone from public.sleep_entries")).toEqual([
      { d: "2026-10-01", timezone: "America/Los_Angeles" },
    ]);
  });

  it("schedules in the newly confirmed timezone", async () => {
    const r = await t.rpc(A, "save_goal_version", targetsPayload({ ...DEFAULTS, cyclingSecondsPerWeek: 5400 }, { requestId: uuid(), id: null, expectedRevision: null }));
    expect(r.status).toBe("saved");
    const [r2] = await rows(A, `select to_char(daykind_private.next_monday((now() at time zone 'Asia/Tokyo')::date), 'YYYY-MM-DD') as next`);
    expect((await goals(A)).at(-1)).toMatchObject({ effective_from: r2.next });
  });
});

describe("ownership", () => {
  it("hides other users' profiles and targets, and refuses cross-user writes", async () => {
    expect(await rows(A, "select user_id from public.goal_versions where user_id <> $1", [A])).toEqual([]);
    expect(await rows(A, "select user_id from public.profiles")).toEqual([{ user_id: A }]);
    const updated = await rows(A, "update public.profiles set distance_unit = 'mi' where user_id = $1 returning id", [B]);
    expect(updated).toEqual([]);
    await expect(rows(A, `insert into public.goal_versions (user_id, effective_from, walking_seconds_per_day, resistance_sessions_per_week, cycling_seconds_per_week)
                          values ($1, '2030-01-07', 900, 2, 3600)`, [B])).rejects.toThrow(/row-level security/);
  });

  it("gives an account outside the allowlist, and anonymous requests, no access", async () => {
    await rows(OUTSIDER, "select 1"); // the role itself works
    const r = await t.rpc(OUTSIDER, "save_preferences", preferencesPayload(setup(), { requestId: uuid(), expectedRevision: 1 }));
    expect(r.status).toBe("not_found");
    await expect(rows(null, "select public.save_goal_version('{}'::jsonb)")).rejects.toThrow(/permission denied/);
    await expect(rows(null, "select * from public.goal_versions")).rejects.toThrow(/permission denied/);
  });

  it("still lets account deletion remove every target version", async () => {
    await t.db.query("delete from auth.users where id = $1", [B]);
    expect(await t.count("public.goal_versions", `user_id = '${B}'`)).toBe(0);
    expect(await t.count("public.profiles", `user_id = '${B}'`)).toBe(0);
  });
});
