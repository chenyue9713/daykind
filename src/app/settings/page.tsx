import type { Metadata } from "next";
import Link from "next/link";
import { Fragment, Suspense, type ReactNode } from "react";

import { LaterBadge, PageHeader, PageSkeleton, SampleBadge } from "@/components/ui";
import { formatLocalDate, formatTime } from "@/lib/domain/dates";
import { formatDuration } from "@/lib/domain/format";
import { GUIDANCE_RULE_VERSION } from "@/lib/domain/guidance";
import { occurrenceLabel, occurrenceStatusText, type ReminderOccurrence } from "@/lib/domain/reminders";
import { DEFAULT_GOALS } from "@/lib/domain/targets";
import type { GoalVersion } from "@/lib/domain/types";
import { loadSettings } from "@/lib/views/loaders";
import { signOut } from "../sign-in/actions";
import { GuidanceLimits } from "./guidance-limits";
import { PreferencesForm, TargetsForm } from "./preferences-form";
import { PushDevice } from "./push-device";
import { RemindersForm, TestNotification } from "./reminders-form";

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

function ReminderStatusList({ occurrences, timezone }: { occurrences: ReminderOccurrence[]; timezone: string }) {
  if (occurrences.length === 0) return <p className="small muted">Nothing sent or skipped yet.</p>;
  return (
    <ul className="list-plain divided">
      {occurrences.map((o) => (
        <li key={o.id} className="entry">
          <div className="entry-main">
            <strong>
              {occurrenceLabel(o)}
              {o.channel ? <span className="muted"> · {o.channel === "push" ? "browser" : "email"}</span> : null}
            </strong>
            <p className="small muted">
              {formatLocalDate(o.localDate)} · {formatTime(o.sentAt ?? o.scheduledAt, o.timezone)}
              {o.timezone === timezone ? null : ` (${o.timezone.replaceAll("_", " ")})`} · {occurrenceStatusText(o)}
            </p>
          </div>
        </li>
      ))}
    </ul>
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
  const { profile, schedule, isSample, dataSource, email, today, timezones, reminders } = await loadSettings();
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

      <section className="card stack" aria-labelledby="reminders-heading">
        <div className="card-header" style={{ marginBottom: 0 }}>
          <h2 id="reminders-heading">Reminders and notifications</h2>
          {isSample ? <SampleBadge /> : null}
        </div>
        {isSample ? (
          <p className="small muted">Sample mode: you can try these settings, but changes are checked and not saved, and nothing is sent.</p>
        ) : reminders.channels.length === 0 ? (
          <p className="notice small">
            Reminder delivery isn&apos;t set up on this server yet, so nothing is sent. You can still choose your
            settings. Setup steps are in doc/reminders.md.
          </p>
        ) : null}
        <RemindersForm
          settings={reminders.settings}
          email={email}
          timezone={profile.timezone}
          pushDeviceLabel={reminders.pushDevice ? (reminders.pushDevice.deviceLabel ?? "your registered browser") : null}
        />
        <div className="stack-sm">
          <h3>Browser for notifications</h3>
          <PushDevice vapidPublicKey={reminders.vapidPublicKey} registered={reminders.pushDevice} disabled={isSample} />
          <p className="small muted">
            Notifications show only which check-in is open. On Android, Chrome must be allowed to show
            notifications; focus modes and battery savers can still hide them.
          </p>
        </div>
        <div className="stack-sm">
          <h3>Test notification</h3>
          <p className="small">Sends one now through the same path as reminders, even if reminders are off.</p>
          <div className="row">
            <TestNotification
              channel="email"
              label="Send a test email"
              disabled={isSample || !reminders.channels.includes("email")}
            />
            <TestNotification
              channel="push"
              label="Send a test browser notification"
              disabled={isSample || !reminders.channels.includes("push") || !reminders.pushDevice}
            />
          </div>
        </div>
        <div className="stack-sm">
          <h3>Recent notifications</h3>
          <ReminderStatusList occurrences={reminders.occurrences} timezone={profile.timezone} />
          <p className="small muted">
            &ldquo;Accepted&rdquo; means the mail or push service took the notification, not that it was shown or
            read. Due check-ins always show on Today, whether or not a reminder was sent.
          </p>
        </div>
        <p className="small muted">The Monday report notice will come with stored weekly reports.</p>
      </section>

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
