import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { PageHeader, PageSkeleton } from "@/components/ui";
import { GUIDANCE_RULE_VERSION } from "@/lib/domain/guidance";
import { loadWelcome } from "@/lib/views/loaders";
import { signOut } from "../sign-in/actions";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "Welcome" };

export default function WelcomePage() {
  return (
    <>
      <PageHeader
        title="Welcome to DayKind"
        description="A few choices before your first check-in. It takes about a minute."
      />
      <Suspense fallback={<PageSkeleton blocks={4} />}>
        <WelcomeContent />
      </Suspense>
    </>
  );
}

async function WelcomeContent() {
  const { isSample, done, profile, schedule, timezones } = await loadWelcome();
  // Setup happens once; later changes are made in Settings.
  if (done && !isSample) redirect("/settings");

  return (
    <div className="stack">
      {isSample ? (
        <p className="notice notice-info small">
          Sample mode: this is a preview of first-use setup. Your choices are checked but not saved.
        </p>
      ) : null}
      <OnboardingForm
        profile={profile}
        timezones={timezones}
        current={schedule.current}
        pending={schedule.pending}
        nextMonday={schedule.nextMonday}
        ruleVersion={GUIDANCE_RULE_VERSION}
      />
      {isSample ? null : (
        <form action={signOut}>
          <button className="button button-secondary" type="submit">
            Sign out
          </button>
        </form>
      )}
    </div>
  );
}
