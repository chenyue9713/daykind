import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PageHeader, PageSkeleton } from "@/components/ui";
import { readSession } from "@/lib/auth/session";
import { isSupabaseMode } from "@/lib/supabase/config";
import { signOut } from "./actions";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

const reasons: Record<string, string> = {
  signed_out: "Please sign in to continue.",
  not_allowed: "This account isn't allowed to use this private app. Sign out and use the intended account.",
};

export default function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  return (
    <>
      <PageHeader title="Sign in" description="DayKind is private. Only the intended account can sign in." />
      <Suspense fallback={<PageSkeleton blocks={1} />}>
        <SignInContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function SignInContent({ searchParams }: Pick<PageProps<"/sign-in">, "searchParams">) {
  // Read request data first so this page is always rendered per request.
  const { reason } = await searchParams;
  if (!isSupabaseMode()) {
    return (
      <p className="notice notice-info">
        Sample mode has no sign-in. <Link href="/">Back to Today</Link>
      </p>
    );
  }
  const session = await readSession();
  if ("user" in session) {
    return (
      <p className="notice notice-info">
        You&apos;re signed in. <Link href="/">Go to Today</Link>
      </p>
    );
  }
  return (
    <div className="stack">
      {typeof reason === "string" && reasons[reason] ? <p className="notice small">{reasons[reason]}</p> : null}
      {session.problem === "not_allowed" ? (
        <form action={signOut}>
          <button className="button button-secondary" type="submit">
            Sign out
          </button>
        </form>
      ) : (
        <SignInForm />
      )}
      <p className="small muted">There is no public registration. The account is created by the app&apos;s owner in Supabase.</p>
    </div>
  );
}
