import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PageHeader, PageSkeleton, SampleBadge } from "@/components/ui";
import { formatLocalDate, formatTime } from "@/lib/domain/dates";
import {
  activityTypeLabel,
  durationBasisLabel,
  fatigueLabel,
  formatCount,
  formatDuration,
  formatSleepDuration,
  formatWeight,
  intensityLabel,
  restfulnessLabel,
} from "@/lib/domain/format";
import { goalSeconds } from "@/lib/domain/targets";
import { formatDistance } from "@/lib/domain/units";
import type { Activity, SymptomEntry } from "@/lib/domain/types";
import { HISTORY_DAYS, loadHistory } from "@/lib/views/loaders";
import { RecordActions } from "./record-actions";

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

const sourceLabel: Record<Activity["source"], string> = {
  sample: "Sample",
  manual: "Manual",
  tcx: "Garmin TCX",
  fit: "Garmin FIT",
};

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
        {isSample
          ? "All entries below are sample data and can't be edited or deleted."
          : "Edit or delete any entry. Changes show on your other devices after they refresh."}
      </p>
      {isSample ? null : (
        <p className="row small">
          <Link href="/activities/new">Add activity</Link>
          <Link href="/symptoms/new">Add ankle update</Link>
        </p>
      )}
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
              <p className="muted">
                Nothing logged.
                {isSample ? null : (
                  <>
                    {" "}
                    <Link href={`/check-in/morning?date=${day.date}`}>Add sleep</Link> ·{" "}
                    <Link href={`/check-in/evening?date=${day.date}`}>Add evening review</Link>
                  </>
                )}
              </p>
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
                    <RecordActions
                      label="sleep entry"
                      kind="sleep"
                      id={day.sleep.id}
                      revision={day.sleep.revision}
                      editHref={`/check-in/morning?date=${day.date}`}
                      disabled={isSample}
                    />
                  </li>
                ) : (
                  <li className="small muted">
                    No sleep check-in.
                    {isSample ? null : (
                      <>
                        {" "}
                        <Link href={`/check-in/morning?date=${day.date}`}>Add it</Link>
                      </>
                    )}
                  </li>
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
                          {formatTime(a.startedAt, a.timezone)}
                          {a.timezone !== tz && a.startedAt !== null ? ` (${a.timezone.replaceAll("_", " ")} time)` : ""} ·{" "}
                          {a.distanceMeters === null ? "" : `${formatDistance(a.distanceMeters, profile.distanceUnit)} · `}
                          {intensityLabel[a.intensity]} · {durationBasisLabel[basis]}
                          {basis === "active" && a.elapsedSeconds !== null && a.activeSeconds !== a.elapsedSeconds
                            ? ` (${formatDuration(a.elapsedSeconds)} elapsed)`
                            : ""}{" "}
                          · Heart rate {a.avgHeartRateBpm === null ? "not recorded" : `${a.avgHeartRateBpm} bpm avg`}
                        </p>
                        {a.note ? <p className="small">{a.note}</p> : null}
                        <p className="small">
                          {a.source === "sample" ? <SampleBadge /> : <span className="badge">{sourceLabel[a.source]}</span>}{" "}
                          {a.canonicalStatus === "linked" ? (
                            <span className="badge">Replaced by an import · not counted</span>
                          ) : null}
                        </p>
                      </div>
                      <RecordActions
                        label={`${activityTypeLabel[a.type]} activity`}
                        kind="activity"
                        id={a.id}
                        revision={a.revision}
                        editHref={`/activities/edit?id=${a.id}`}
                        disabled={isSample}
                      />
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
                    <RecordActions
                      label="symptom entry"
                      kind="symptom"
                      id={s.id}
                      revision={s.revision}
                      editHref={`/symptoms/edit?id=${s.id}`}
                      disabled={isSample}
                    />
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
                    <RecordActions
                      label="evening review"
                      kind="evening"
                      id={day.evening.id}
                      revision={day.evening.revision}
                      editHref={`/check-in/evening?date=${day.date}`}
                      disabled={isSample}
                    />
                  </li>
                ) : (
                  <li className="small muted">
                    No evening check-in — activity status unknown.
                    {isSample ? null : (
                      <>
                        {" "}
                        <Link href={`/check-in/evening?date=${day.date}`}>Add it</Link>
                      </>
                    )}
                  </li>
                )}

                {day.weights.map((w) => (
                  <li key={w.id} className="entry">
                    <div className="entry-main">
                      <strong>Weight · {formatWeight(w.weightKg, profile.weightUnit)}</strong>
                      <p className="small muted">{formatTime(w.measuredAt, tz)}</p>
                    </div>
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
