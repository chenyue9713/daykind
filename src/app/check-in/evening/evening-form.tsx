"use client";

import Link from "next/link";
import { useActionState, useId, useState, useTransition, type FormEvent } from "react";

import type { QuickActivityInput } from "@/lib/domain/checkins";
import { activityTypeLabel, intensityLabel } from "@/lib/domain/format";
import type { ActivityStatus, ActivityType, EveningEntry, Intensity, SymptomEntry } from "@/lib/domain/types";
import { newUuid } from "@/lib/uuid";
import { submitEveningCheckIn, type CheckInFormState } from "../actions";
import {
  AnkleFields,
  ChoiceGroup,
  EditTarget,
  FieldError,
  SaveStatus,
  initialFormState,
  useRequestId,
} from "../form-parts";

export interface ExistingActivityView {
  id: string;
  title: string;
  detail: string;
  isSample: boolean;
}

interface PendingActivity extends QuickActivityInput {
  key: string;
}

export function EveningForm({
  date,
  existingActivities,
  existing,
  symptom,
}: {
  date: string;
  existingActivities: ExistingActivityView[];
  existing: EveningEntry | null;
  /** The ankle observation saved with this check-in, if any. */
  symptom: SymptomEntry | null;
}) {
  const [added, setAdded] = useState<PendingActivity[]>([]);
  const [state, formAction] = useActionState(async (prev: CheckInFormState, data: FormData) => {
    const result = await submitEveningCheckIn(prev, data);
    // Saved quick-adds now come back from the server as recorded activities.
    if (result.status === "saved") setAdded([]);
    return result;
  }, initialFormState);
  const [pending, startTransition] = useTransition();
  const nextRequestId = useRequestId();
  const [status, setStatus] = useState<ActivityStatus | null>(
    existing?.activityStatus ?? (existingActivities.length > 0 ? "logged" : null),
  );
  const [draftType, setDraftType] = useState<ActivityType>("walking");
  const [draftMinutes, setDraftMinutes] = useState("");
  const [draftIntensity, setDraftIntensity] = useState<Intensity>("easy");
  const [draftStart, setDraftStart] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);
  const idPrefix = useId();
  const errors = state.errors;

  const addActivity = () => {
    const minutes = Number(draftMinutes);
    if (!Number.isInteger(minutes) || minutes <= 0) {
      setDraftError("Enter the duration in whole minutes.");
      return;
    }
    setDraftError(null);
    setAdded((list) => [
      ...list,
      {
        key: `${idPrefix}-${list.length}-${Date.now()}`,
        requestId: newUuid(),
        type: draftType,
        durationMinutes: minutes,
        intensity: draftIntensity,
        startTime: draftStart || null,
      },
    ]);
    setDraftMinutes("");
    setDraftStart("");
    setStatus("logged");
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    data.set(
      "activities",
      JSON.stringify(
        added.map(({ requestId, type, durationMinutes, intensity, startTime }) => ({
          requestId,
          type,
          durationMinutes,
          intensity,
          startTime,
        })),
      ),
    );
    data.set("requestId", nextRequestId(state.status));
    startTransition(() => formAction(data));
  };

  const totalActivities = existingActivities.length + added.length;

  return (
    <form className="stack" onSubmit={onSubmit} noValidate>
      <input type="hidden" name="localDate" value={date} />
      <input type="hidden" name="seenActivityIds" value={existingActivities.map((a) => a.id).join(",")} />
      <EditTarget id={existing?.id} revision={existing?.revision} />

      <section className="card stack" aria-labelledby="activities-heading">
        <h2 id="activities-heading">Activity</h2>

        {totalActivities === 0 ? (
          <p className="muted">No activities recorded yet for this day.</p>
        ) : (
          <ul className="list-plain divided">
            {existingActivities.map((a) => (
              <li key={a.id} className="entry">
                <div className="entry-main">
                  <strong>{a.title}</strong>
                  <p className="small muted">{a.detail}</p>
                </div>
                <span className={`badge ${a.isSample ? "badge-sample" : ""}`}>{a.isSample ? "Sample" : "Recorded"}</span>
              </li>
            ))}
            {added.map((a) => (
              <li key={a.key} className="entry">
                <div className="entry-main">
                  <strong>{activityTypeLabel[a.type]}</strong>
                  <p className="small muted">
                    {a.startTime ? `${a.startTime} · ` : ""}
                    {a.durationMinutes} min · {intensityLabel[a.intensity]} · added now, not saved yet
                  </p>
                </div>
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => setAdded((list) => list.filter((x) => x.key !== a.key))}
                  aria-label={`Remove ${activityTypeLabel[a.type]} of ${a.durationMinutes} minutes`}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        <fieldset className="stack-sm">
          <legend>Quick add</legend>
          <div className="inline-inputs">
            <div className="field">
              <label htmlFor="draftType" className="small">
                Type
              </label>
              <select id="draftType" value={draftType} onChange={(e) => setDraftType(e.target.value as ActivityType)}>
                <option value="walking">Walk</option>
                <option value="cycling">Ride (indoor counts)</option>
                <option value="resistance">Resistance session</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="draftMinutes" className="small">
                Minutes
              </label>
              <input
                id="draftMinutes"
                type="number"
                inputMode="numeric"
                min={1}
                value={draftMinutes}
                onChange={(e) => setDraftMinutes(e.target.value)}
                aria-invalid={draftError ? true : undefined}
              />
            </div>
            <div className="field">
              <label htmlFor="draftStart" className="small">
                Start (optional)
              </label>
              <input id="draftStart" type="time" value={draftStart} onChange={(e) => setDraftStart(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="draftIntensity" className="small">
                Effort
              </label>
              <select id="draftIntensity" value={draftIntensity} onChange={(e) => setDraftIntensity(e.target.value as Intensity)}>
                <option value="easy">Easy</option>
                <option value="moderate">Moderate</option>
                <option value="hard">Hard</option>
                <option value="unknown">Not sure</option>
              </select>
            </div>
          </div>
          {draftError ? (
            <p className="field-error" role="alert">
              {draftError}
            </p>
          ) : null}
          <FieldError errors={errors} name="activities" />
          <div className="row">
            <button type="button" className="button button-secondary" onClick={addActivity}>
              Add activity
            </button>
            <Link href="/import" className="button button-secondary" aria-describedby="import-note">
              Import Garmin file
            </Link>
          </div>
          <p id="import-note" className="small muted">
            Imports open on their own page. Save this check-in first; unsaved answers here are not kept.
          </p>
        </fieldset>

        <fieldset aria-describedby={errors.activityStatus ? "activityStatus-error" : undefined}>
          <legend>Is today&apos;s activity complete?</legend>
          <div className="choice-group cols-3">
            {(
              [
                ["logged", "I was active today"],
                ["confirmed_none", "No activity today"],
                ["unknown", "Not sure yet"],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="choice">
                <input
                  type="radio"
                  name="activityStatus"
                  value={value}
                  checked={status === value}
                  onChange={() => setStatus(value)}
                />
                {label}
              </label>
            ))}
          </div>
          <FieldError errors={errors} name="activityStatus" />
        </fieldset>

        {status === "confirmed_none" && existingActivities.length > 0 ? (
          <div className="notice notice-error stack-sm">
            <p>
              Today already has {existingActivities.length} recorded{" "}
              {existingActivities.length === 1 ? "activity" : "activities"}. “No activity” would conflict with
              {existingActivities.length === 1 ? " it" : " them"}.
            </p>
            <label className="choice">
              <input type="checkbox" name="confirmRemoveExisting" />
              Remove today&apos;s recorded activities
            </label>
            <FieldError errors={errors} name="confirmRemoveExisting" />
          </div>
        ) : null}
      </section>

      <section className="card stack" aria-labelledby="ankle-heading">
        <h2 id="ankle-heading">Ankle</h2>
        <AnkleFields errors={errors} defaults={symptom} />
      </section>

      <section className="card stack">
        <ChoiceGroup
          name="eveningFatigue"
          legend="How tired do you feel this evening?"
          defaultValue={existing?.eveningFatigue}
          errors={errors}
          options={[
            { value: "energetic", label: "Energetic" },
            { value: "mildly_tired", label: "Mildly tired" },
            { value: "very_tired", label: "Very tired" },
          ]}
        />
        <label className="choice">
          <input type="checkbox" name="recoveryDay" defaultChecked={existing?.recoveryDay} />
          Mark today as an intentional recovery day
        </label>
        <p className="field-hint">A recovery day is shown alongside your targets. It doesn&apos;t change them.</p>
      </section>

      <div className="form-actions">
        <SaveStatus state={state} pending={pending} />
        <button className="button button-block" type="submit" disabled={pending}>
          {existing ? "Update this day's record" : "Confirm this day's record"}
        </button>
      </div>
    </form>
  );
}
