// The dispatcher's view of the database: the four reminder_* functions from
// supabase/migrations/20261026120000_reminders.sql. Every call carries the
// dispatch key, which those functions check before doing anything.
import type { PlanningUser, ReminderKind, ReminderSlot, ReminderStage } from "@/lib/domain/reminders";
import type { LocalDate } from "@/lib/domain/types";

export interface DispatchUser extends PlanningUser {
  userId: string;
}

export interface ClaimedReminder {
  id: string;
  claimToken: string;
  email: string;
  kind: ReminderKind | "test";
  stage: ReminderStage;
  localDate: LocalDate;
  attempt: number;
}

export type RecordOutcome = "sent" | "transient" | "permanent";

export interface DispatchStore {
  listUsers(): Promise<DispatchUser[]>;
  plan(slots: (ReminderSlot & { userId: string })[]): Promise<number>;
  /** `now` is for tests; production uses the database clock. */
  claim(options: { now?: Date; limit?: number; onlyId?: string }): Promise<ClaimedReminder[]>;
  record(
    claimed: Pick<ClaimedReminder, "id" | "claimToken">,
    outcome: RecordOutcome,
    detail: string | null,
    now?: Date,
  ): Promise<"sent" | "retry" | "failed" | "stale">;
}

/** Calls one database function with named arguments and returns its result. */
export type RpcCall = (name: string, args: Record<string, unknown>) => Promise<unknown>;

type Row = Record<string, unknown>;

export function createDispatchStore(call: RpcCall, dispatchKey: string): DispatchStore {
  return {
    async listUsers() {
      const rows = ((await call("reminder_dispatch_users", { p_key: dispatchKey })) ?? []) as Row[];
      return rows.map((r) => ({
        userId: String(r.user_id),
        timezone: String(r.timezone),
        emailEnabledAt: r.email_enabled_at ? new Date(String(r.email_enabled_at)).toISOString() : null,
        morningEnabled: Boolean(r.morning_enabled),
        eveningEnabled: Boolean(r.evening_enabled),
        followUpsEnabled: Boolean(r.follow_ups_enabled),
      }));
    },
    async plan(slots) {
      if (slots.length === 0) return 0;
      const payload = slots.map((s) => ({
        user_id: s.userId,
        kind: s.kind,
        local_date: s.localDate,
        stage: s.stage,
        timezone: s.timezone,
        scheduled_at: s.scheduledAt,
      }));
      return Number(await call("reminder_plan", { p_key: dispatchKey, p_slots: payload }));
    },
    async claim({ now, limit = 20, onlyId }) {
      const rows = ((await call("reminder_claim", {
        p_key: dispatchKey,
        p_now: now ? now.toISOString() : null,
        p_limit: limit,
        p_only: onlyId ?? null,
      })) ?? []) as Row[];
      return rows.map((r) => ({
        id: String(r.id),
        claimToken: String(r.claim_token),
        email: String(r.email),
        kind: r.kind as ClaimedReminder["kind"],
        stage: r.stage as ReminderStage,
        localDate: String(r.local_date),
        attempt: Number(r.attempt),
      }));
    },
    async record(claimed, outcome, detail, now) {
      return (await call("reminder_record", {
        p_key: dispatchKey,
        p_id: claimed.id,
        p_claim: claimed.claimToken,
        p_outcome: outcome,
        p_detail: detail,
        p_now: now ? now.toISOString() : null,
      })) as "sent" | "retry" | "failed" | "stale";
    },
  };
}
