"use client";

import { useActionState, useState, useTransition, type FormEvent } from "react";

import type { SleepEntry, SymptomEntry } from "@/lib/domain/types";
import { submitMorningCheckIn } from "../actions";
import {
  AnkleFields,
  ChoiceGroup,
  CountOrUnknown,
  EditTarget,
  FieldError,
  SaveStatus,
  initialFormState,
  useRequestId,
} from "../form-parts";

function split(seconds: number | null | undefined) {
  if (seconds == null) return { h: undefined, m: undefined };
  const minutes = Math.floor(seconds / 60);
  return { h: Math.floor(minutes / 60), m: minutes % 60 };
}

function HoursMinutes({ prefix, label, seconds }: { prefix: string; label: string; seconds?: number | null }) {
  const { h, m } = split(seconds);
  return (
    <div className="inline-inputs" role="group" aria-label={label}>
      <div className="field">
        <label htmlFor={`${prefix}Hours`} className="small">
          {label} hours
        </label>
        <input id={`${prefix}Hours`} name={`${prefix}Hours`} type="number" inputMode="numeric" min={0} max={16} defaultValue={h} />
      </div>
      <div className="field">
        <label htmlFor={`${prefix}Minutes`} className="small">
          {label} minutes
        </label>
        <input id={`${prefix}Minutes`} name={`${prefix}Minutes`} type="number" inputMode="numeric" min={0} max={59} step={5} defaultValue={m} />
      </div>
    </div>
  );
}

export function MorningForm({
  date,
  today,
  existing,
  symptom,
}: {
  date: string;
  today: string;
  existing: SleepEntry | null;
  /** The ankle observation saved with this check-in, if any. */
  symptom: SymptomEntry | null;
}) {
  const [state, formAction] = useActionState(submitMorningCheckIn, initialFormState);
  const [pending, startTransition] = useTransition();
  const nextRequestId = useRequestId();
  const [approximate, setApproximate] = useState(existing?.approximate ?? false);
  const errors = state.errors;

  // Submit without React's automatic form reset so answers stay visible after
  // validation errors or a failed save.
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
          <label htmlFor="wakingDate">Date you woke up</label>
          <input
            id="wakingDate"
            name="wakingDate"
            type="date"
            defaultValue={existing?.wakingDate ?? date}
            max={today}
            aria-invalid={errors.wakingDate ? true : undefined}
          />
          <FieldError errors={errors} name="wakingDate" />
        </div>

        <fieldset className="stack-sm" aria-describedby={errors.sleep ? "sleep-error" : undefined}>
          <legend>How long did you actually sleep?</legend>
          <p className="field-hint">Leave out time you were awake for baby care. It is not subtracted again later.</p>
          {approximate ? (
            <>
              <HoursMinutes prefix="sleepMin" label="At least" seconds={existing?.durationMinSeconds} />
              <HoursMinutes prefix="sleepMax" label="At most" seconds={existing?.durationMaxSeconds} />
            </>
          ) : (
            <HoursMinutes prefix="sleep" label="Sleep" seconds={existing?.durationMinSeconds} />
          )}
          <label className="choice">
            <input
              type="checkbox"
              name="approximate"
              checked={approximate}
              onChange={(e) => setApproximate(e.target.checked)}
            />
            I&apos;m not sure — enter a range
          </label>
          <FieldError errors={errors} name="sleep" />
        </fieldset>
      </section>

      <section className="card stack">
        <h2>Interruptions</h2>
        <CountOrUnknown
          name="totalInterruptions"
          label="Times you woke up"
          defaultValue={existing ? existing.totalInterruptions : undefined}
          errors={errors}
        />
        <CountOrUnknown
          name="babyInterruptions"
          label="Of those, for baby care"
          hint="no details about the baby are stored"
          defaultValue={existing ? existing.babyInterruptions : undefined}
          errors={errors}
        />
      </section>

      <section className="card stack">
        <ChoiceGroup
          name="restfulness"
          legend="How rested do you feel?"
          defaultValue={existing?.restfulness}
          errors={errors}
          options={[
            { value: "well_rested", label: "Well rested" },
            { value: "somewhat_rested", label: "Somewhat rested" },
            { value: "poorly_rested", label: "Poorly rested" },
          ]}
        />
        <ChoiceGroup
          name="morningFatigue"
          legend="How tired do you feel?"
          defaultValue={existing?.morningFatigue}
          errors={errors}
          options={[
            { value: "energetic", label: "Energetic" },
            { value: "mildly_tired", label: "Mildly tired" },
            { value: "very_tired", label: "Very tired" },
          ]}
        />
      </section>

      <section className="card">
        <details>
          <summary>{symptom ? "Ankle symptoms saved with this check-in" : "Update ankle symptoms (optional)"}</summary>
          <div style={{ marginTop: 12 }}>
            <AnkleFields errors={errors} defaults={symptom} />
          </div>
        </details>
      </section>

      <section className="card field">
        <label htmlFor="note">Note (optional)</label>
        <textarea id="note" name="note" maxLength={500} defaultValue={existing?.note ?? ""} />
        <FieldError errors={errors} name="note" />
      </section>

      <div className="form-actions">
        <SaveStatus state={state} pending={pending} />
        <button className="button button-block" type="submit" disabled={pending}>
          {existing ? "Update sleep check-in" : "Save sleep check-in"}
        </button>
      </div>
    </form>
  );
}
