import Link from "next/link";
import { Suspense } from "react";

import { GuidanceCard } from "@/components/guidance-card";
import { PageHeader, PageSkeleton, SampleBadge } from "@/components/ui";
import { WeeklyProgressCard } from "@/components/weekly-progress";
import { formatLocalDate, formatTime } from "@/lib/domain/dates";
import {
  activityTypeLabel,
  durationBasisLabel,
  formatDuration,
  formatSleepDuration,
  intensityLabel,
} from "@/lib/domain/format";
import { goalSeconds } from "@/lib/domain/targets";
import { loadToday } from "@/lib/views/loaders";

export default function TodayPage() {
  return (
    <>
      <PageHeader title="Today" description="What's due, what you've recorded, and a suggestion based on it." />
      <Suspense fallback={<PageSkeleton blocks={4} />}>
        <TodayContent />
      </Suspense>
    </>
  );
}

async function TodayContent() {
  const view = await loadToday();
  const { profile, sleepToday, eveningToday, guidance } = view;
  const morningDone = sleepToday?.completionState === "complete";
  const eveningDone = eveningToday?.completionState === "complete";

  return (
    <div className="stack">
      <p className="muted">{formatLocalDate(view.today, "long")}</p>

      <section className="card stack-sm" aria-labelledby="due-heading">
        <div className="card-header">
          <h2 id="due-heading">Check-ins</h2>
          {view.isSample ? <SampleBadge /> : null}
        </div>
        <ul className="list-plain divided">
          <li className="entry">
            <div className="entry-main">
              <strong>Morning sleep check-in</strong>
              <p className="small muted">
                {morningDone
                  ? `Done at ${formatTime(sleepToday!.updatedAt, profile.timezone)} · ${formatSleepDuration(
                      sleepToday!.durationMinSeconds,
                      sleepToday!.durationMaxSeconds,
                    )}`
                  : "Due from 10 AM"}
              </p>
            </div>
            {morningDone ? (
              <span className="badge badge-done">Done</span>
            ) : (
              <span className="badge badge-due">Due</span>
            )}
          </li>
          <li className="entry">
            <div className="entry-main">
              <strong>Evening check-in</strong>
              <p className="small muted">
                {eveningDone
                  ? `Done at ${formatTime(eveningToday!.updatedAt, profile.timezone)}`
                  : "Due from 9 PM · review activity, ankle, and fatigue"}
              </p>
            </div>
            {eveningDone ? (
              <span className="badge badge-done">Done</span>
            ) : (
              <span className="badge badge-due">Due</span>
            )}
          </li>
        </ul>
        <Link className="button button-block" href={morningDone ? "/check-in/evening" : "/check-in/morning"}>
          {morningDone ? "Start evening check-in" : "Start morning check-in"}
        </Link>
        <p className="small muted">Reminders are not set up yet; check-ins appear here when due.</p>
        {view.isSample ? null : (
          <p className="small muted">
            Saved check-ins appear on your other devices after they refresh this page.
          </p>
        )}
      </section>

      <GuidanceCard guidance={guidance} timezone={profile.timezone} />

      <section className="card" aria-labelledby="activity-heading">
        <div className="card-header">
          <h2 id="activity-heading">Today&apos;s activity</h2>
          <Link href="/activities/new" className="small">
            Add activity
          </Link>
        </div>
        {view.activitiesToday.length === 0 ? (
          <p className="muted">
            {eveningToday?.activityStatus === "confirmed_none"
              ? "You confirmed no activity today."
              : "Nothing recorded yet today. Not logged is different from no activity."}
          </p>
        ) : (
          <ul className="list-plain divided">
            {view.activitiesToday.map((a) => {
              const { seconds, basis } = goalSeconds(a);
              return (
                <li key={a.id} className="entry">
                  <div className="entry-main">
                    <strong>{activityTypeLabel[a.type]}</strong>
                    <p className="small muted">
                      {formatTime(a.startedAt, a.timezone)} · {formatDuration(seconds)} {durationBasisLabel[basis]} ·{" "}
                      {intensityLabel[a.intensity]}
                    </p>
                  </div>
                  {a.source === "sample" ? <SampleBadge /> : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <WeeklyProgressCard
        progress={view.progress}
        today={view.today}
        showSuppressedNote={guidance.suppressActivityPrompts}
      />
    </div>
  );
}
