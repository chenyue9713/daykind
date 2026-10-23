import type { Metadata } from "next";
import Link from "next/link";
import { Fragment, Suspense, type ReactNode } from "react";

import { LaterBadge, PageHeader, PageSkeleton, SampleBadge } from "@/components/ui";
import { formatLocalDate } from "@/lib/domain/dates";
import { formatDuration } from "@/lib/domain/format";
import { GUIDANCE_RULE_VERSION } from "@/lib/domain/guidance";
import { DEFAULT_GOALS } from "@/lib/domain/targets";
import type { GoalVersion } from "@/lib/domain/types";
import { loadSettings } from "@/lib/views/loaders";
import { signOut } from "../sign-in/actions";
import { GuidanceLimits } from "./guidance-limits";
import { PreferencesForm, TargetsForm } from "./preferences-form";

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

/** Targets as a list; with `compareTo`, each changed value also shows the one in effect now. */
function TargetList({ goals, compareTo }: { goals: GoalVersion; compareTo?: GoalVersion }) {
  const rows: [string, string, string | null][] = [
    [
      "Walking",
      `${formatDuration(goals.walkingSecondsPerDay)} each day`,
      compareTo && compareTo.walkingSecondsPerDay !== goals.walkingSecondsPerDay
        ? formatDuration(compareTo.walkingSecondsPerDay)
        : null,
    ],
    [
      "Resistance",
      `${goals.resistanceSessionsPerWeek} sessions per week`,
      compareTo && compareTo.resistanceSessionsPerWeek !== goals.resistanceSessionsPerWeek
        ? String(compareTo.resistanceSessionsPerWeek)
        : null,
    ],
    [
      "Cycling",
      `${formatDuration(goals.cyclingSecondsPerWeek)} per week`,
      compareTo && compareTo.cyclingSecondsPerWeek !== goals.cyclingSecondsPerWeek
        ? formatDuration(compareTo.cyclingSecondsPerWeek)
        : null,
    ],
  ];
  return (
    <dl className="kv">
      {rows.map(([label, value, before]) => (
        <Fragment key={label}>
          <dt>{label}</dt>
          <dd>
            {value}
            {before ? <span className="muted"> (now {before})</span> : null}
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}

async function SettingsContent() {
  const { profile, schedule, isSample, dataSource, email, today, timezones } = await loadSettings();
  const { current, pending } = schedule;
  const isDefault = current.effectiveFrom === DEFAULT_GOALS.effectiveFrom;

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

      <section className="card stack" aria-labelledby="prefs-heading">
        <div className="card-header" style={{ marginBottom: 0 }}>
          <h2 id="prefs-heading">Time and units</h2>
          {isSample ? <SampleBadge /> : null}
        </div>
        {profile.timezoneConfirmed ? null : (
          <p className="notice small">
            {profile.timezone.replaceAll("_", " ")} has not been confirmed yet. Dates use it until you confirm or
            change it.
          </p>
        )}
        {isSample ? (
          <p className="small muted">Sample mode: you can try these settings, but changes are checked and not saved.</p>
        ) : null}
        <PreferencesForm profile={profile} timezones={timezones} />
        <p className="small muted">
          DayKind never changes your timezone by itself, for example when you travel. Each saved record keeps the
          date and timezone it was entered with.
        </p>
      </section>

      <section className="card stack" aria-labelledby="goals-heading">
        <div className="card-header" style={{ marginBottom: 0 }}>
          <h2 id="goals-heading">Weekly targets</h2>
          {isSample ? <SampleBadge /> : null}
        </div>
        <div className="stack-sm">
          <h3>This week</h3>
          <TargetList goals={current} />
          <p className="small muted">
            {isDefault
              ? "The default targets."
              : `In effect since ${formatLocalDate(current.effectiveFrom, "long")}.`}{" "}
            Weeks run Monday to Sunday in your timezone (today is {formatLocalDate(today, "long")}).
          </p>
        </div>
        {pending ? (
          <div className="notice notice-info stack-sm" role="note">
            <h3>Upcoming change from {formatLocalDate(pending.effectiveFrom, "long")}</h3>
            <TargetList goals={pending} compareTo={current} />
          </div>
        ) : null}
        <h3>{pending ? "Edit the upcoming change" : "Change targets"}</h3>
        <TargetsForm current={current} pending={pending} timezone={profile.timezone} nextMonday={schedule.nextMonday} />
        <p className="small muted">
          Changes start the following Monday. Past weeks and reports keep the targets that applied then. A recovery
          day never changes a target.
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
        <GuidanceLimits ruleVersion={GUIDANCE_RULE_VERSION} />
        <p className="small muted">
          {profile.guidanceLimitsAcknowledgedAt
            ? `You acknowledged this on ${new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: profile.timezone }).format(new Date(profile.guidanceLimitsAcknowledgedAt))}.`
            : isSample
              ? "Sample mode: there is no acknowledgment to record."
              : "Not acknowledged yet."}
        </p>
        {isSample ? (
          <p className="small">
            <Link href="/welcome">Preview first-use setup</Link>
          </p>
        ) : null}
      </section>
    </div>
  );
}
