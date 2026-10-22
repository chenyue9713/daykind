import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";

import { allowedEmails, isSupabaseMode } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// The data access layer's view of who is signed in. In sample mode there is
// no sign-in and every request is the sample user. In Supabase mode the
// session cookie is verified on every request, and anyone who is not signed
// in, or is not the intended user, is sent to /sign-in.

export interface CurrentUser {
  id: string;
  email: string | null;
  /** True while there is no real authentication (sample mode). */
  isSampleUser: boolean;
}

export const SAMPLE_USER_ID = "sample-user";

export type SignInProblem = "signed_out" | "not_allowed";

/** Verifies the session without redirecting. */
export const readSession = cache(
  async (): Promise<{ user: CurrentUser } | { problem: SignInProblem }> => {
    if (!isSupabaseMode()) return { user: { id: SAMPLE_USER_ID, email: null, isSampleUser: true } };

    const supabase = await createSupabaseServerClient();
    // getClaims verifies the access token (refreshing it if needed); the
    // unverified session object in the cookie is never trusted on its own.
    const { data, error } = await supabase.auth.getClaims();
    const claims = data?.claims;
    if (error || !claims?.sub) return { problem: "signed_out" };

    const email = typeof claims.email === "string" ? claims.email.toLowerCase() : null;
    const allowed = allowedEmails();
    if (allowed.length === 0 || !email || !allowed.includes(email)) return { problem: "not_allowed" };
    return { user: { id: claims.sub, email, isSampleUser: false } };
  },
);

export async function getCurrentUser(): Promise<CurrentUser> {
  const session = await readSession();
  if ("problem" in session) redirect(`/sign-in?reason=${session.problem}`);
  return session.user;
}
