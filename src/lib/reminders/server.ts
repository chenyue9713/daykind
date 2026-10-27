import "server-only";

import { createClient } from "@supabase/supabase-js";

import { supabaseConfig } from "@/lib/supabase/config";
import { reminderEnv, type ReminderEnv } from "./config";
import { runDispatch, type DispatchSummary } from "./dispatcher";
import { createResendSender } from "./email";
import { createDispatchStore } from "./store";

/**
 * Runs the dispatcher with production dependencies. The database is reached
 * with the publishable key and no user session; the dispatch key is what the
 * reminder_* functions accept, and they can do nothing else.
 */
export async function dispatchReminders(env: ReminderEnv, options: { onlyId?: string } = {}): Promise<DispatchSummary> {
  const { url, publishableKey } = supabaseConfig();
  const client = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const store = createDispatchStore(async (name, args) => {
    const { data, error } = await client.rpc(name, args);
    if (error) throw new Error(`${name} failed (code ${error.code || "unknown"})`);
    return data;
  }, env.dispatchSecret);
  const sender = createResendSender({ apiKey: env.resendApiKey, from: env.emailFrom });
  return runDispatch({ store, sender, appUrl: env.appUrl, onlyId: options.onlyId });
}

export { isAuthorizedDispatch } from "./auth";
export { reminderEnv };
