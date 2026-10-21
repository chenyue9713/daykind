import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader, PageSkeleton, SampleBadge } from "@/components/ui";
import { WeeklyProgressCard } from "@/components/weekly-progress";
import { formatRange } from "@/lib/domain/dates";
import { fatigueLabel, formatDuration, formatWeight, restfulnessLabel } from "@/lib/domain/format";
import type { TargetStatus, WeeklyReport } from "@/lib/domain/report";
import { loadWeeklyReport } from "@/lib/views/loaders";

export const metadata: Metadata = { title: "Weekly report" };

export default function ReportPage() {
  return (
    <>
      <PageHeader title="Weekly report" description="Last completed week, Monday through Sunday." />
      <Suspense fallback={<PageSkeleton blocks={5} />}>
        <ReportContent />
      </Suspense>
    </>
  );
}

const statusLabel: Record<TargetStatus, string> = {
  achieved: "Achieved",
  not_yet: "Not reached",
  incomplete: "Incomplete data",
};

function Distribution<T extends string>({
  title,
  counts,
  labels,
}: {
  title: string;
  counts: Record<T, number>;
  labels: Record<T, string>;
}) {
  const total = Object.values<number>(counts).reduce((a, b) => a + b, 0);
  return (
    <div className="stack-sm">
      <h3>{title}</h3>
      {total === 0 ? (
        <p className="small muted">No entries.</p>
      ) : (
        <div className="distribution">
          {(Object.keys(counts) as T[]).map((key) => (
            <div key={key} style={{ display: "contents" }}>
              <span>{labels[key]}</span>
              <div className="meter" aria-hidden="true">
                <span style={{ width: `${(counts[key] / total) * 100}%` }} />
              </div>
              <span>
                {counts[key]}
                <span className="visually-hidden"> of {total}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WeightSummary({ weight, unit }: { weight: WeeklyReport["weight"]; unit: "kg" | "lb" }) {
  if (weight.sampleCount === 0) return <p className="muted">No weight entries this week. Weight tracking is optional.</p>;
  return (
    <dl className="kv">
      <dt>Average this week</dt>
      <dd>
        {formatWeight(weight.meanKg!, unit)} (n={weight.sampleCount})
      </dd>
      <dt>Average the week before</dt>
      <dd>
        {weight.previousWeekMeanKg === null
          ? "No entries"
          : `${formatWeight(weight.previousWeekMeanKg, unit)} (n=${weight.previousWeekSampleCount})`}
      </dd>
    </dl>
  );
}

async function ReportContent() {
  const { report, profile, isSample } = await loadWeeklyReport();
  const { coverage, sleep, targetStatus, symptoms } = report;

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2>{formatRange(report.range)}</h2>
        {isSample ? <SampleBadge /> : null}
      </div>

      <section className="card" aria-labelledby="coverage-heading">
        <h2 id="coverage-heading" style={{ marginBottom: 12 }}>
          Logging coverage
        </h2>
        <dl className="kv">
          <dt>Morning check-ins</dt>
          <dd>
            {coverage.morningComplete} of {coverage.days}
          </dd>
          <dt>Evening check-ins</dt>
          <dd>
            {coverage.eveningComplete} of {coverage.days}
          </dd>
          <dt>Days with known activity status</dt>
          <dd>
            {coverage.knownActivityDays} of {coverage.days}
          </dd>
        </dl>
        {coverage.knownActivityDays < coverage.days ? (
          <p className="small muted" style={{ marginTop: 12 }}>
            {coverage.days - coverage.knownActivityDays} day(s) were not logged. Totals below are a lower bound.
          </p>
        ) : null}
      </section>

      <div className="grid-2">
        <section className="card stack" aria-labelledby="sleep-heading">
          <h2 id="sleep-heading">Sleep</h2>
          <dl className="kv">
            <dt>Average actual sleep</dt>
            <dd>
              {sleep.averageSeconds === null ? "No entries" : formatDuration(sleep.averageSeconds)}
              {sleep.includesEstimates ? " (estimate)" : ""}
            </dd>
            <dt>Nights recorded</dt>
            <dd>{sleep.sampleCount}</dd>
            <dt>Baby-care wake-ups</dt>
            <dd>
              {sleep.babyInterruptionsTotal === null
                ? "Unknown"
                : `${sleep.babyInterruptionsTotal} over ${sleep.babyInterruptionsKnownNights} night(s)`}
            </dd>
          </dl>
          <Distribution title="Restfulness" counts={report.restfulness} labels={restfulnessLabel} />
          <Distribution title="Morning fatigue" counts={report.morningFatigue} labels={fatigueLabel} />
          <Distribution title="Evening fatigue" counts={report.eveningFatigue} labels={fatigueLabel} />
        </section>

        <div className="stack">
          <section className="card" aria-labelledby="targets-heading">
            <h2 id="targets-heading" style={{ marginBottom: 12 }}>
              Target status
            </h2>
            <dl className="kv">
              <dt>Walking every day</dt>
              <dd>{statusLabel[targetStatus.walking]}</dd>
              <dt>Resistance sessions</dt>
              <dd>{statusLabel[targetStatus.resistance]}</dd>
              <dt>Cycling minutes</dt>
              <dd>{statusLabel[targetStatus.cycling]}</dd>
            </dl>
          </section>

          <section className="card" aria-labelledby="symptoms-heading">
            <h2 id="symptoms-heading" style={{ marginBottom: 12 }}>
              Ankle and recovery
            </h2>
            <dl className="kv">
              <dt>Days with ankle pain</dt>
              <dd>
                {symptoms.daysWithPain} of {symptoms.daysWithKnownPain} known
              </dd>
              <dt>Highest pain recorded</dt>
              <dd>{symptoms.maxPain === null ? "Unknown" : `${symptoms.maxPain}/10`}</dd>
              <dt>Days with symptom flags</dt>
              <dd>{symptoms.flagDays}</dd>
              <dt>Recovery days</dt>
              <dd>{report.progress.recoveryDays.length}</dd>
            </dl>
          </section>

          <section className="card" aria-labelledby="weight-heading">
            <h2 id="weight-heading" style={{ marginBottom: 12 }}>
              Weight (optional)
            </h2>
            <WeightSummary weight={report.weight} unit={profile.weightUnit} />
          </section>
        </div>
      </div>

      <WeeklyProgressCard progress={report.progress} title="Activity by target" />

      <section className="card stack-sm" aria-labelledby="focus-heading">
        <h2 id="focus-heading">One focus for this week</h2>
        <p>{report.focusSuggestion}</p>
        <div className="row">
          <button type="button" className="button" disabled aria-describedby="focus-later">
            Save as my focus
          </button>
        </div>
        <p id="focus-later" className="small muted">
          Saving a focus will be available once storage is connected.
        </p>
      </section>

      <p className="small muted">
        These are patterns in what was recorded, not causes. Report rules {report.ruleVersion}. The scheduled Monday
        report and its notification are not set up yet; this page is calculated when you open it.
      </p>
    </div>
  );
}
