"use client";

import { useRef, useState } from "react";

import type { FieldErrors } from "@/lib/domain/checkins";
import { newUuid } from "@/lib/uuid";
import type { CheckInFormState } from "./actions";

/**
 * One request id per save attempt. After a failure whose outcome is unknown
 * (for example a dropped connection), the retry reuses the same id so the
 * server returns the first result instead of saving twice. Any definite
 * outcome starts a new attempt.
 */
export function useRequestId() {
  const current = useRef<string | null>(null);
  return (lastStatus: CheckInFormState["status"]) => {
    if (current.current === null || lastStatus !== "failed") current.current = newUuid();
    return current.current;
  };
}

/** Hidden fields that identify the record being edited and its revision. */
export function EditTarget({ id, revision }: { id?: string | null; revision?: number | null }) {
  return (
    <>
      <input type="hidden" name="entryId" value={id ?? ""} />
      <input type="hidden" name="expectedRevision" value={revision ?? ""} />
    </>
  );
}

export function FieldError({ id, errors, name }: { id?: string; errors: FieldErrors; name: string }) {
  const message = errors[name];
  if (!message) return null;
  return (
    <p className="field-error" id={id ?? `${name}-error`} role="alert">
      {message}
    </p>
  );
}

export function ChoiceGroup<T extends string>({
  name,
  legend,
  options,
  defaultValue,
  errors,
  columns = 3,
}: {
  name: string;
  legend: string;
  options: { value: T; label: string }[];
  defaultValue?: T | null;
  errors: FieldErrors;
  columns?: 1 | 3;
}) {
  return (
    <fieldset aria-describedby={errors[name] ? `${name}-error` : undefined}>
      <legend>{legend}</legend>
      <div className={`choice-group${columns === 3 ? " cols-3" : ""}`}>
        {options.map((option) => (
          <label key={option.value} className="choice">
            <input type="radio" name={name} value={option.value} defaultChecked={defaultValue === option.value} />
            {option.label}
          </label>
        ))}
      </div>
      <FieldError errors={errors} name={name} />
    </fieldset>
  );
}

/** A count that can be explicitly unknown. Unknown is different from zero. */
export function CountOrUnknown({
  name,
  label,
  hint,
  defaultValue,
  errors,
}: {
  name: string;
  label: string;
  hint?: string;
  defaultValue?: number | null;
  errors: FieldErrors;
}) {
  const [unknown, setUnknown] = useState(defaultValue === null);
  const errorId = `${name}-error`;
  return (
    <div className="field">
      <label htmlFor={name}>
        {label}
        {hint ? <span className="field-hint"> · {hint}</span> : null}
      </label>
      <div className="inline-inputs">
        <div className="field">
          <input
            id={name}
            name={name}
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            disabled={unknown}
            defaultValue={defaultValue ?? undefined}
            aria-invalid={errors[name] ? true : undefined}
            aria-describedby={errors[name] ? errorId : undefined}
          />
        </div>
        <label className="choice">
          <input
            type="checkbox"
            name={`${name}Unknown`}
            checked={unknown}
            onChange={(e) => setUnknown(e.target.checked)}
          />
          Unknown
        </label>
      </div>
      <FieldError errors={errors} name={name} />
    </div>
  );
}

export interface SymptomDefaults {
  anklePain: number | null;
  side: string | null;
  flareReported: boolean;
  newOrWorsening: boolean;
  swellingHeatRedness: boolean;
  weightBearingDifficulty: boolean;
  feverOrUnwell?: boolean | null;
}

export function AnkleFields({ errors, defaults }: { errors: FieldErrors; defaults?: SymptomDefaults | null }) {
  const [swelling, setSwelling] = useState(defaults?.swellingHeatRedness ?? false);
  const painDefault = defaults ? (defaults.anklePain === null ? "unknown" : String(defaults.anklePain)) : undefined;

  return (
    <div className="stack">
      <fieldset aria-describedby={errors.anklePain ? "anklePain-error" : undefined}>
        <legend>
          Ankle pain right now <span className="field-hint">· 0 is none, 10 is the worst</span>
        </legend>
        <div className="pain-scale">
          {Array.from({ length: 11 }, (_, n) => (
            <label key={n} className="choice">
              <input type="radio" name="anklePain" value={n} defaultChecked={painDefault === String(n)} />
              {n}
            </label>
          ))}
        </div>
        <label className="choice" style={{ marginTop: 8 }}>
          <input type="radio" name="anklePain" value="unknown" defaultChecked={painDefault === "unknown"} />
          Not sure / prefer not to say
        </label>
        <FieldError errors={errors} name="anklePain" />
      </fieldset>

      <div className="field">
        <label htmlFor="side">Which ankle (optional)</label>
        <select id="side" name="side" defaultValue={defaults?.side ?? ""}>
          <option value="">Not specified</option>
          <option value="left">Left</option>
          <option value="right">Right</option>
          <option value="both">Both</option>
        </select>
      </div>

      <fieldset>
        <legend>Anything else? (tick any that apply)</legend>
        <div className="choice-group">
          <label className="choice">
            <input type="checkbox" name="flareReported" defaultChecked={defaults?.flareReported} />
            I think I&apos;m having a flare
          </label>
          <label className="choice">
            <input type="checkbox" name="newOrWorsening" defaultChecked={defaults?.newOrWorsening} />
            Pain is new or getting worse
          </label>
          <label className="choice">
            <input
              type="checkbox"
              name="swellingHeatRedness"
              checked={swelling}
              onChange={(e) => setSwelling(e.target.checked)}
            />
            Swelling, heat, or redness
          </label>
          <label className="choice">
            <input type="checkbox" name="weightBearingDifficulty" defaultChecked={defaults?.weightBearingDifficulty} />
            Difficulty putting weight on it
          </label>
        </div>
      </fieldset>

      {swelling ? (
        <fieldset>
          <legend>Do you have a fever, shivering, or feel generally unwell?</legend>
          <div className="choice-group cols-3">
            <label className="choice">
              <input type="radio" name="feverOrUnwell" value="yes" defaultChecked={defaults?.feverOrUnwell === true} />
              Yes
            </label>
            <label className="choice">
              <input type="radio" name="feverOrUnwell" value="no" defaultChecked={defaults?.feverOrUnwell === false} />
              No
            </label>
            <label className="choice">
              <input
                type="radio"
                name="feverOrUnwell"
                value=""
                defaultChecked={defaults?.feverOrUnwell === null || defaults?.feverOrUnwell === undefined}
              />
              Not sure
            </label>
          </div>
        </fieldset>
      ) : null}
    </div>
  );
}

export function SaveStatus({ state, pending }: { state: CheckInFormState; pending: boolean }) {
  if (pending) return <p className="notice small" role="status">Saving…</p>;
  if (state.status === "idle") return null;
  const tone =
    state.status === "saved" ? "notice-success" : state.status === "not_persisted" ? "notice-info" : "notice-error";
  return (
    <p className={`notice small ${tone}`} role={state.status === "saved" || state.status === "not_persisted" ? "status" : "alert"}>
      {state.message}
    </p>
  );
}

export const initialFormState: CheckInFormState = { status: "idle", message: null, errors: {} };
