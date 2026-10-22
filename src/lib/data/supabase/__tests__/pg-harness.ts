// Runs the real Supabase migrations in an in-process Postgres (PGlite) with a
// minimal stand-in for Supabase's auth schema and roles, so row-level security
// and the write functions can be tested without a Supabase project.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

// Mirrors the parts of Supabase that the migrations rely on.
const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth, public to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
`;

export interface TestDb {
  db: PGlite;
  /** Creates an auth user; `allowed` adds them to the DayKind allowlist. */
  createUser(id: string, allowed?: boolean): Promise<void>;
  /** Runs `fn` as the authenticated role with `userId` as the JWT subject (or as anon when null). */
  as<T>(userId: string | null, fn: () => Promise<T>): Promise<T>;
  /** Calls a write function as `userId` and returns its jsonb result. */
  rpc(userId: string, name: string, payload: unknown): Promise<Record<string, unknown>>;
  /** Superuser count, bypassing row-level security. */
  count(table: string, where?: string): Promise<number>;
}

export async function createTestDb(): Promise<TestDb> {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }

  const as: TestDb["as"] = async (userId, fn) => {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? ""]);
    await db.exec(`set role ${userId ? "authenticated" : "anon"}`);
    try {
      return await fn();
    } finally {
      await db.exec("reset role");
    }
  };

  return {
    db,
    as,
    async createUser(id, allowed = true) {
      await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${id}@example.test`]);
      if (allowed) await db.query("insert into daykind_private.allowed_users (user_id) values ($1)", [id]);
    },
    async rpc(userId, name, payload) {
      return as(userId, async () => {
        const r = await db.query<{ result: Record<string, unknown> }>(`select public.${name}($1::jsonb) as result`, [
          JSON.stringify(payload),
        ]);
        return r.rows[0].result;
      });
    },
    async count(table, where = "true") {
      const r = await db.query<{ n: number }>(`select count(*)::int as n from ${table} where ${where}`);
      return r.rows[0].n;
    },
  };
}
