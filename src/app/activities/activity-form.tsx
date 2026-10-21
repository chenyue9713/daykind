"use client";

import { useActionState, useTransition, type FormEvent } from "react";

import { EditTarget, FieldError, SaveStatus, initialFormState, useRequestId } from "@/app/check-in/form-parts";
import type { Activity, DistanceUnit } from "@/lib/domain/types";
import { saveActivity } from "./actions";

export interface ActivityFormValues {
  localDate: string;
  startTime: string;
  durationMinutes: string;
  distance: string;
}

/**
 * Add or edit an activity. For activities imported from a device file, the
 * measured values are shown read-only and only type, effort, and note change.
 */
export function ActivityForm({
  existing,
  measured,
  values,
  today,
  distanceUnit,
  measuredSummary,
}: {
  existing: Activity | null;
  measured: boolean;
  values: ActivityFormValues;
  today: string;
  distanceUnit: DistanceUnit;
  measuredSummary: string | null;
}) {
  const [state, formAction] = useActionState(saveActivity, initialFormState);
  const [pending, startTransition] = useTransition();
  const nextRequestId = useRequestId();
  const errors = state.errors;

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    data.set("requestId", nextRequestId(state.status));
    startTransition(() => formAction(data));
  };

  return (
    <form className="stack" onSubmit={onSubmit} noValidate>
      <EditTarget id={existing?.id} revision={existing?.revision} />
      <section className="card stack">
        <div className="field">
          <label htmlFor="type">Type</label>
          <select id="type" name="type" defaultValue={existing?.type ?? "walking"}>
            <option value="walking">Walk</option>
            <option value="cycling">Ride (indoor counts)</option>
            <option value="resistance">Resistance session</option>
            <option value="other">Other</option>
          </select>
          <FieldError errors={errors} name="type" />
        </div>

        {measured ? (
          <p className="notice small">{measuredSummary} These values came from your device file and can&apos;t be edited here.</p>
        ) : (
          <>
            <div className="inline-inputs">
              <div className="field">
                <label htmlFor="localDate">Date</label>
                <input
                  id="localDate"
                  name="localDate"
                  type="date"
                  max={today}
                  defaultValue={values.localDate}
                  aria-invalid={errors.localDate ? true : undefined}
                />
              </div>
              <div className="field">
                <label htmlFor="startTime">Start time (optional)</label>
                <input id="startTime" name="startTime" type="time" defaultValue={values.startTime} />
              </div>
            </div>
            <FieldError errors={errors} name="localDate" />
            <FieldError errors={errors} name="startTime" />
            <p className="field-hint">An activity that crosses midnight belongs to the day it started.</p>
            <div className="inline-inputs">
              <div className="field">
                <label htmlFor="durationMinutes">Minutes</label>
                <input
                  id="durationMinutes"
                  name="durationMinutes"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  defaultValue={values.durationMinutes}
                  aria-invalid={errors.durationMinutes ? true : undefined}
                />
              </div>
              <div className="field">
                <label htmlFor="distance">Distance in {distanceUnit === "mi" ? "miles" : "km"} (optional)</label>
                <input
                  id="distance"
                  name="distance"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  defaultValue={values.distance}
                  aria-invalid={errors.distance ? true : undefined}
                />
              </div>
            </div>
            <FieldError errors={errors} name="durationMinutes" />
            <FieldError errors={errors} name="distance" />
          </>
        )}

        <div className="field">
          <label htmlFor="intensity">Effort</label>
          <select id="intensity" name="intensity" defaultValue={existing?.intensity ?? "easy"}>
            <option value="easy">Easy</option>
            <option value="moderate">Moderate</option>
            <option value="hard">Hard</option>
            <option value="unknown">Not sure</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="note">Note (optional)</label>
          <textarea id="note" name="note" maxLength={500} defaultValue={existing?.note ?? ""} />
          <FieldError errors={errors} name="note" />
        </div>
        <FieldError errors={errors} name="form" />
      </section>

      <div className="form-actions">
        <SaveStatus state={state} pending={pending} />
        <button className="button button-block" type="submit" disabled={pending}>
          {existing ? "Save changes" : "Add activity"}
        </button>
      </div>
    </form>
  );
}
