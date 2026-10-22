// Supabase settings. Only the project URL and the publishable (anon) key are
// used: every query runs as the signed-in user, so row-level security applies.
// No service-role key is needed or read anywhere in the app.

export interface SupabaseConfig {
  url: string;
  publishableKey: string;
}

export function isSupabaseMode(): boolean {
  return process.env.DAYKIND_DATA_SOURCE === "supabase";
}

export function supabaseConfig(): SupabaseConfig {
  const url = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    throw new Error(
      "DAYKIND_DATA_SOURCE=supabase needs SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY. See .env.example and doc/supabase-setup.md.",
    );
  }
  return { url, publishableKey };
}

/**
 * Emails allowed to use this private app (comma-separated), checked after
 * sign-in. The database allowlist (daykind_private.allowed_users) is the
 * enforcing control; this one gives a clear message and signs others out.
 */
export function allowedEmails(): string[] {
  return (process.env.DAYKIND_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}
