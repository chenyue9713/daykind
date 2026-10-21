import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader, PageSkeleton, SampleBadge } from "@/components/ui";
import { formatLocalDate, formatTime } from "@/lib/domain/dates";
import {
  activityTypeLabel,
  fatigueLabel,
  formatCount,
  formatDuration,
  formatSleepDuration,
  formatWeight,
  intensityLabel,
  restfulnessLabel,
} from "@/lib/domain/format";
import { goalSeconds } from "@/lib/domain/targets";
import type { SymptomEntry } from "@/lib/domain/types";
import { HISTORY_DAYS, loadHistory } from "@/lib/views/loaders";

export const metadata: Metadata = { title: "History" };

export default function HistoryPage() {
  return (
    <>
      <PageHeader title="History" description={`Your last ${HISTORY_DAYS} days, newest first.`} />
      <Suspense fallback={<PageSkeleton blocks={5} />}>
        <HistoryContent />
      </Suspense>
    </>
  );
}

function EntryActions({ label }: { label: string }) {
  return (
    <div className="entry-actions">
      <button type="button" className="button button-secondary" disabled aria-label={`Edit ${label} (available once storage is connected)`}>
        Edit
      </button>
      <button type="button" className="button button-secondary" disabled aria-label={`Delete ${label} (available once storage is connected)`}>
        Delete
      </button>
    </div>
  );
}

function describeSymptom(s: SymptomEntry): string {
  const parts = [s.anklePain === null ? "Ankle pain unknown" : `Ankle pain ${s.anklePain}/10`];
  if (s.side) parts.push(s.side);
  if (s.flareReported) parts.push("flare reported");
  if (s.newOrWorsening) parts.push("new or worsening");
  if (s.swellingHeatRedness) parts.push("swelling/heat/redness");
  if (s.weightBearingDifficulty) parts.push("difficulty bearing weight");
  return parts.join(" · ");
}

async function HistoryContent() {
  const { days, profile, isSample } = await loadHistory();
  const tz = profile.timezone;

  return (
    <div className="stack">
      <p className="small muted">
        Editing and deleting records will be available once account storage is connected.
        {isSample ? " All entries below are sample data." : ""}
      </p>
      {days.map((day) => {
        const empty =
          !day.sleep && !day.evening && day.activities.length === 0 && day.symptoms.length === 0 && day.weights.length === 0;
        return (
          <section key={day.date} className="card timeline-day" aria-labelledby={`day-${day.date}`}>
            <div className="card-header">
              <h2 id={`day-${day.date}`}>{formatLocalDate(day.date, "long")}</h2>
              {day.evening?.recoveryDay ? <span className="badge">Recovery day</span> : null}
            </div>
            {empty ? (
              <p className="muted">Nothing logged.</p>
            ) : (
              <ul className="list-plain divided">
                {day.sleep ? (
                  <li className="entry">
                    <div className="entry-main">
                      <strong>Sleep · {formatSleepDuration(day.sleep.durationMinSeconds, day.sleep.durationMaxSeconds)}</strong>
                      <p className="small muted">
                        Woke {formatCount(day.sleep.totalInterruptions)} times ({formatCount(day.sleep.babyInterruptions)} for
                        baby care) ·{" "}
                        {day.sleep.restfulness ? restfulnessLabel[day.sleep.restfulness] : "Restfulness not recorded"} ·{" "}
                        {day.sleep.morningFatigue ? fatigueLabel[day.sleep.morningFatigue] : "Fatigue not recorded"}
                      </p>
                    </div>
                    <EntryActions label="sleep entry" />
                  </li>
                ) : (
                  <li className="small muted">No sleep check-in.</li>
                )}

                {day.activities.map((a) => {
                  const { seconds, basis } = goalSeconds(a);
                  return (
                    <li key={a.id} className="entry">
                      <div className="entry-main">
                        <strong>
                          {activityTypeLabel[a.type]} · {formatDuration(seconds)}
                        </strong>
                        <p className="small muted">
                          {formatTime(a.startedAt, tz)} · {intensityLabel[a.intensity]} ·{" "}
                          {basis === "active" ? "active time" : "elapsed time"}
                          {a.activeSeconds !== null && a.activeSeconds !== a.elapsedSeconds
                            ? ` (${formatDuration(a.elapsedSeconds)} elapsed)`
                            : ""}{" "}
                          · Heart rate {a.avgHeartRateBpm === null ? "not recorded" : `${a.avgHeartRateBpm} bpm avg`}
                        </p>
                        <p className="small">{a.source === "sample" ? <SampleBadge /> : <span className="badge">Manual</span>}</p>
                      </div>
                      <EntryActions label={`${activityTypeLabel[a.type]} activity`} />
                    </li>
                  );
                })}

                {day.symptoms.map((s) => (
                  <li key={s.id} className="entry">
                    <div className="entry-main">
                      <strong>Symptoms · {s.context}</strong>
                      <p className="small muted">
                        {formatTime(s.observedAt, tz)} · {describeSymptom(s)}
                      </p>
                    </div>
                    <EntryActions label="symptom entry" />
                  </li>
                ))}

                {day.evening ? (
                  <li className="entry">
                    <div className="entry-main">
                      <strong>Evening review</strong>
                      <p className="small muted">
                        {day.evening.activityStatus === "confirmed_none"
                          ? "Confirmed no activity"
                          : day.evening.activityStatus === "logged"
                            ? "Activity logged"
                            : "Activity status unknown"}{" "}
                        · {day.evening.eveningFatigue ? fatigueLabel[day.evening.eveningFatigue] : "Fatigue not recorded"}
                      </p>
                    </div>
                    <EntryActions label="evening entry" />
                  </li>
                ) : (
                  <li className="small muted">No evening check-in — activity status unknown.</li>
                )}

                {day.weights.map((w) => (
                  <li key={w.id} className="entry">
                    <div className="entry-main">
                      <strong>Weight · {formatWeight(w.weightKg, profile.weightUnit)}</strong>
                      <p className="small muted">{formatTime(w.measuredAt, tz)}</p>
                    </div>
                    <EntryActions label="weight entry" />
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
