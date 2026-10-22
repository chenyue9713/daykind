"use client";

import { formatLocalDate, formatTime } from "@/lib/domain/dates";
import { activityTypeLabel, formatDuration, intensityLabel } from "@/lib/domain/format";
import type { ActivityType, DistanceUnit, Intensity } from "@/lib/domain/types";
import { candidatesForType } from "@/lib/import/decisions";
import { dateConfidenceLabel, describeDuration, describeHeartRate, formatDistance } from "@/lib/import/format";
import type { DuplicateCandidate, ImportPreview, SessionPreview } from "@/lib/import/types";
import { missingAnswers, parseDuplicateChoice, type DraftDecision } from "./decision-state";
import styles from "./import.module.css";

const TYPE_OPTIONS: ActivityType[] = ["walking", "cycling", "resistance", "other"];

const sourceLabel = (source: string) =>
  source === "manual" ? "Entered manually" : source === "fit" ? "FIT import" : source === "tcx" ? "TCX import" : source === "sample" ? "Sample" : source;

function describeCandidate(c: DuplicateCandidate, timezone: string, unit: DistanceUnit) {
  const when = c.startedAt ? `${formatLocalDate(c.localDate)} · ${formatTime(c.startedAt, timezone)}` : `${formatLocalDate(c.localDate)} · no start time`;
  const basis = c.durationBasis === "reported" ? "reported" : c.durationBasis === "active" ? "active" : "elapsed";
  return {
    when,
    duration: `${formatDuration(c.goalSeconds)} ${basis}`,
    distance: formatDistance(c.distanceMeters, unit),
    hr: c.avgHeartRateBpm !== null ? `${c.avgHeartRateBpm} bpm avg` : "Not recorded",
  };
}

function ChangePreview({
  session,
  candidate,
  mode,
  keepNote,
  timezone,
  unit,
}: {
  session: SessionPreview;
  candidate: DuplicateCandidate;
  mode: "link" | "replace";
  keepNote: boolean;
  timezone: string;
  unit: DistanceUnit;
}) {
  const before = describeCandidate(candidate, timezone, unit);
  const duration = describeDuration(session);
  const keepsSubjective = mode === "link" || keepNote;
  const effortAfter = keepsSubjective && candidate.intensity !== "unknown" ? candidate.intensity : "unknown";
  const rows: [string, string, string][] = [
    ["Start", before.when, session.startedAt ? `${formatLocalDate(session.localDate!)} · ${formatTime(session.startedAt, timezone)}` : "—"],
    ["Duration", before.duration, duration.main],
    ["Distance", before.distance, formatDistance(session.distanceMeters, unit)],
    ["Heart rate", before.hr, describeHeartRate(session.heartRate).main],
    ["Effort", intensityLabel[candidate.intensity as Intensity] ?? candidate.intensity, intensityLabel[effortAfter as Intensity]],
    ["Note", candidate.note ?? "None", keepsSubjective ? (candidate.note ?? "None") : "None"],
  ];
  return (
    <div className={styles.changeTable} role="table" aria-label={mode === "link" ? "What linking changes" : "What replacing changes"}>
      <div role="row" className={styles.changeHead}>
        <span role="columnheader">Field</span>
        <span role="columnheader">Now</span>
        <span role="columnheader">After saving</span>
      </div>
      {rows.map(([label, a, b]) => (
        <div role="row" key={label} className={styles.changeRow} data-changed={a !== b ? "true" : undefined}>
          <span role="rowheader">{label}</span>
          <span role="cell">{a}</span>
          <span role="cell">{b}</span>
        </div>
      ))}
      <p className="small muted">
        {mode === "link"
          ? "Linking keeps one activity: your note and effort stay, and the file supplies the measured time, distance, and heart rate. It counts once."
          : "Replacing saves the imported workout as the activity that counts. The old entry is kept in history but no longer counts."}
      </p>
    </div>
  );
}

export function SessionCard({
  preview,
  session,
  decision,
  onChange,
  distanceUnit,
  disabled,
}: {
  preview: ImportPreview;
  session: SessionPreview;
  decision: DraftDecision;
  onChange: (next: DraftDecision) => void;
  distanceUnit: DistanceUnit;
  disabled: boolean;
}) {
  const id = `session-${session.key}`;
  const total = preview.sessions.length;
  const title = `Session ${session.index + 1}${total > 1 ? ` of ${total}` : ""}`;
  const set = (patch: Partial<DraftDecision>) => onChange({ ...decision, ...patch });
  const chosenZone = decision.timezone || session.timezone;
  const duration = describeDuration(session);
  const hr = describeHeartRate(session.heartRate);
  const candidates = decision.type ? candidatesForType(session, decision.type) : [];
  const missing = missingAnswers(session, decision);
  const { kind: dupKind, id: dupId } = parseDuplicateChoice(decision.duplicate);

  if (session.status === "failed") {
    return (
      <section className={`card stack-sm ${styles.failed}`} aria-labelledby={`${id}-title`}>
        <div className="card-header" style={{ marginBottom: 0 }}>
          <h2 id={`${id}-title`}>{title}</h2>
          <span className="badge badge-later">Can&apos;t import</span>
        </div>
        <ul className={styles.errorList}>
          {session.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
        <p className="small muted">This session will be left out. You can add it manually in the evening check-in.</p>
      </section>
    );
  }

  return (
    <section className="card stack" aria-labelledby={`${id}-title`}>
      <div className="card-header" style={{ marginBottom: 0 }}>
        <h2 id={`${id}-title`}>
          {title}
          {decision.type ? ` · ${activityTypeLabel[decision.type]}` : ""}
        </h2>
        {!decision.include ? (
          <span className="badge badge-later">Skipped</span>
        ) : missing.length > 0 ? (
          <span className="badge badge-due">Needs your answer</span>
        ) : (
          <span className="badge badge-done">Ready</span>
        )}
      </div>

      <label className="choice">
        <input type="checkbox" checked={decision.include} disabled={disabled} onChange={(e) => set({ include: e.target.checked })} />
        Import this session
      </label>

      <dl className={`kv ${styles.details}`}>
        <dt>Sport in file</dt>
        <dd>{session.sportLabel}</dd>
        <dt>Date</dt>
        <dd>
          {session.startedAt && session.localDate ? (
            <>
              {formatLocalDate(session.timezoneCandidates.find((c) => c.timezone === chosenZone)?.localDate ?? session.localDate, "long")}
              <span className={styles.sub}>
                Starts {formatTime(session.startedAt, chosenZone)} · {chosenZone}
              </span>
            </>
          ) : (
            "Unknown"
          )}
        </dd>
        <dt>Duration</dt>
        <dd>
          {duration.main}
          {duration.fallback ? <span className="badge badge-due" style={{ marginLeft: 6 }}>Elapsed-time fallback</span> : null}
          {duration.detail ? <span className={styles.sub}>{duration.detail}</span> : null}
        </dd>
        <dt>Distance</dt>
        <dd>{formatDistance(session.distanceMeters, distanceUnit)}</dd>
        <dt>Heart rate</dt>
        <dd>
          {hr.main}
          {hr.detail ? <span className={styles.sub}>{hr.detail}</span> : null}
        </dd>
        <dt>Source</dt>
        <dd>
          {preview.format.toUpperCase()} file{preview.deviceLabel ? ` · ${preview.deviceLabel}` : ""}
          {preview.fileName ? <span className={`${styles.sub} ${styles.fileName}`}>{preview.fileName}</span> : null}
        </dd>
      </dl>

      {session.warnings.length > 0 ? (
        <ul className={`notice small ${styles.warningList}`}>
          {session.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}

      {decision.include ? (
        <>
          {session.type === null ? (
            <fieldset>
              <legend>What kind of activity was this?</legend>
              <p className="small muted" style={{ marginBottom: 8 }}>
                The file says “{session.sportLabel}”, which DayKind can&apos;t map with confidence.
                {session.typeSuggestionReason ? ` ${session.typeSuggestionReason}` : ""}
              </p>
              <div className="choice-group">
                {TYPE_OPTIONS.map((type) => (
                  <label key={type} className="choice">
                    <input
                      type="radio"
                      name={`${id}-type`}
                      value={type}
                      checked={decision.type === type}
                      disabled={disabled}
                      onChange={() => set({ type, duplicate: "" })}
                    />
                    {activityTypeLabel[type]}
                    {type === session.typeSuggestion ? <span className="field-hint"> · suggested</span> : null}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          {session.timezoneCandidates.length > 1 || session.requiredConfirmations.includes("timezone") ? (
            <fieldset>
              <legend>Which day was this workout?</legend>
              {session.dateConfidence ? (
                <p className="small muted" style={{ marginBottom: 8 }}>
                  {dateConfidenceLabel[session.dateConfidence]}
                </p>
              ) : null}
              <div className="choice-group">
                {session.timezoneCandidates.map((c) => (
                  <label key={c.timezone} className="choice">
                    <input
                      type="radio"
                      name={`${id}-tz`}
                      value={c.timezone}
                      checked={decision.timezone === c.timezone}
                      disabled={disabled}
                      onChange={() => set({ timezone: c.timezone })}
                    />
                    {c.label}
                  </label>
                ))}
              </div>
              {session.timezoneCandidates.length === 1 ? (
                <p className="small muted" style={{ marginTop: 8 }}>
                  If this was recorded while traveling, cancel and add it manually with the right date.
                </p>
              ) : null}
            </fieldset>
          ) : null}

          {candidates.length > 0 ? (
            <fieldset className={`stack-sm ${styles.duplicates}`}>
              <legend>This may already be in DayKind</legend>
              <p className="small">Nothing is merged unless you choose to. Pick what should happen:</p>
              {candidates.map((c) => {
                const info = describeCandidate(c, chosenZone, distanceUnit);
                return (
                  <div key={c.activityId} className={`stack-sm ${styles.candidate}`}>
                    <div>
                      <strong>
                        {activityTypeLabel[c.type]} · {info.duration}
                      </strong>
                      <p className="small muted">
                        {info.when} · {sourceLabel(c.source)}
                        {c.note ? ` · Note: “${c.note}”` : ""}
                      </p>
                      <p className="small muted">{c.reasons.join(" · ")}</p>
                    </div>
                    <label className="choice">
                      <input
                        type="radio"
                        name={`${id}-dup`}
                        checked={dupKind === "link" && dupId === c.activityId}
                        disabled={disabled}
                        onChange={() => set({ duplicate: `link:${c.activityId}` })}
                      />
                      Same workout: link to this entry
                    </label>
                    <label className="choice">
                      <input
                        type="radio"
                        name={`${id}-dup`}
                        checked={dupKind === "replace" && dupId === c.activityId}
                        disabled={disabled}
                        onChange={() => set({ duplicate: `replace:${c.activityId}` })}
                      />
                      Same workout: replace this entry
                    </label>
                    {dupId === c.activityId && (dupKind === "link" || dupKind === "replace") ? (
                      <>
                        {dupKind === "replace" && c.note ? (
                          <label className="choice">
                            <input type="checkbox" checked={decision.keepNote} disabled={disabled} onChange={(e) => set({ keepNote: e.target.checked })} />
                            Keep my note and effort on the imported workout
                          </label>
                        ) : null}
                        <ChangePreview
                          session={session}
                          candidate={c}
                          mode={dupKind}
                          keepNote={decision.keepNote}
                          timezone={chosenZone}
                          unit={distanceUnit}
                        />
                      </>
                    ) : null}
                  </div>
                );
              })}
              <label className="choice">
                <input
                  type="radio"
                  name={`${id}-dup`}
                  checked={decision.duplicate === "keep_both"}
                  disabled={disabled}
                  onChange={() => set({ duplicate: "keep_both" })}
                />
                Different workouts: keep both (both count)
              </label>
            </fieldset>
          ) : null}

          {missing.length > 0 ? (
            <p className="small muted" id={`${id}-missing`}>
              Before saving: {missing.join(", ")}.
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
