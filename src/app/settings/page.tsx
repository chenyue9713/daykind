import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";

import { LaterBadge, PageHeader, PageSkeleton, SampleBadge } from "@/components/ui";
import { formatDuration } from "@/lib/domain/format";
import { GUIDANCE_RULE_VERSION } from "@/lib/domain/guidance";
import { loadSettings } from "@/lib/views/loaders";
import { signOut } from "../sign-in/actions";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" description="Preferences, targets, reminders, and your data." />
      <Suspense fallback={<PageSkeleton blocks={5} />}>
        <SettingsContent />
      </Suspense>
    </>
  );
}

function LaterSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="card stack-sm" aria-labelledby={id}>
      <div className="card-header" style={{ marginBottom: 0 }}>
        <h2 id={id}>{title}</h2>
        <LaterBadge />
      </div>
      {children}
    </section>
  );
}

async function SettingsContent() {
  const { profile, goals, isSample, dataSource, email } = await loadSettings();

  return (
    <div className="stack">
      <section className="card stack-sm" aria-labelledby="account-heading">
        <div className="card-header" style={{ marginBottom: 0 }}>
          <h2 id="account-heading">Account</h2>
          {isSample ? <SampleBadge /> : null}
        </div>
        <dl className="kv">
          <dt>Signed in as</dt>
          <dd>{email ?? profile.displayName}</dd>
          <dt>Data source</dt>
          <dd>{dataSource === "sample" ? "Sample data (read-only)" : "Private Supabase database"}</dd>
        </dl>
        {isSample ? (
          <p className="small muted">
            Sign-in and private storage are off in sample mode. Every visitor sees the same sample data.
          </p>
        ) : (
          <form action={signOut}>
            <button className="button button-secondary" type="submit">
              Sign out
            </button>
          </form>
        )}
      </section>

      <section className="card stack-sm" aria-labelledby="prefs-heading">
        <h2 id="prefs-heading">Time and units</h2>
        <dl className="kv">
          <dt>Timezone</dt>
          <dd>
            {profile.timezone}
            {profile.timezoneConfirmed ? "" : " (not yet confirmed)"}
          </dd>
          <dt>Distance</dt>
          <dd>{profile.distanceUnit === "mi" ? "Miles" : "Kilometers"}</dd>
          <dt>Weight</dt>
          <dd>
            {profile.weightTrackingEnabled ? (profile.weightUnit === "lb" ? "Pounds" : "Kilograms") : "Not tracked"}
          </dd>
        </dl>
        <p className="small muted">
          Editing preferences is a later task.
          {isSample || profile.timezoneConfirmed ? "" : " Dates use this timezone until you can confirm or change it."}
        </p>
      </section>

      <section className="card stack-sm" aria-labelledby="goals-heading">
        <h2 id="goals-heading">Weekly targets</h2>
        <dl className="kv">
          <dt>Walking</dt>
          <dd>{formatDuration(goals.walkingSecondsPerDay)} each day (can be split)</dd>
          <dt>Resistance</dt>
          <dd>{goals.resistanceSessionsPerWeek} sessions per week</dd>
          <dt>Cycling</dt>
          <dd>{formatDuration(goals.cyclingSecondsPerWeek)} per week</dd>
        </dl>
        <p className="small muted">
          Weeks run Monday to Sunday. Changes will take effect the following Monday and won&apos;t rewrite past reports.
        </p>
      </section>

      <LaterSection id="reminders-heading" title="Reminders and notifications">
        <p className="small">
          Planned: a 10 AM morning reminder, a 9 PM evening reminder, one follow-up an hour later if a check-in is
          still incomplete, quiet hours, and a Monday 9 AM report notice — by browser notification or email.
        </p>
        <p className="small muted">
          No reminders are sent today. Due check-ins appear on the Today screen instead.
        </p>
      </LaterSection>

      <section className="card stack-sm" aria-labelledby="integrations-heading">
        <h2 id="integrations-heading">Garmin workout files</h2>
        <p className="small">
          Upload TCX or FIT files exported from Garmin, preview them, and resolve duplicates before saving. DayKind
          will never ask for your Garmin password.
        </p>
        <div className="row">
          <Link href="/import" className="button button-secondary">
            Import a workout file
          </Link>
        </div>
        <p className="small muted">Automatic sync with Garmin Connect is a later task.</p>
      </section>

      <LaterSection id="data-heading" title="Your data">
        <div className="row">
          <button type="button" className="button button-secondary" disabled>
            Export (JSON + CSV)
          </button>
          <button type="button" className="button button-secondary" disabled>
            Delete account and data
          </button>
        </div>
        <p className="small muted">Export and deletion need account storage and will be added with it.</p>
      </LaterSection>

      <section className="card stack-sm" aria-labelledby="limits-heading">
        <h2 id="limits-heading">About the guidance</h2>
        <p className="small">
          Suggestions come from fixed, explainable rules applied to what you record (rule set {GUIDANCE_RULE_VERSION}
          ). They are not a medical readiness score, diagnosis, or treatment plan, and do not replace advice from your
          healthcare professional. The wording is a draft that still needs review.
        </p>
      </section>
    </div>
  );
}
