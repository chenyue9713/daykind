import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { supabaseConfig } from "./config";

/**
 * A Supabase client for the current request, authenticated by the session
 * cookies. Create one per request; never share it between users.
 */
export async function createSupabaseServerClient() {
  const { url, publishableKey } = supabaseConfig();
  const cookieStore = await cookies();
  return createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Server Components cannot set cookies. The proxy refreshes the
          // session on navigation, so a refreshed token is written there.
        }
      },
    },
  });
}
