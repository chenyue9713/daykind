"use client";

import { useState } from "react";

import { ChoiceGroup, FieldError } from "@/app/check-in/form-parts";
import { useBrowserTimezone } from "@/components/timezone-check";
import type { FieldErrors } from "@/lib/domain/checkins";
import { formatLocalDate, localDateOf } from "@/lib/domain/dates";
import { nextMonday, sameTimezone, TARGET_LIMITS } from "@/lib/domain/preferences";
import type { DistanceUnit, GoalVersion, LocalDate, WeightUnit } from "@/lib/domain/types";

/** Next Monday in `timezone`, computed in the browser; `fallback` (from the server) until then. */
export function useNextMonday(timezone: string, fallback: LocalDate): LocalDate {
  const browser = useBrowserTimezone();
  return browser === null ? fallback : nextMonday(localDateOf(new Date(), timezone));
}

const zoneLabel = (zone: string) => zone.replaceAll("_", " ");

function timeIn(zone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short", hour: "numeric", minute: "2-digit" }).format(
    new Date(),
  );
}

export function TimezoneField({
  value,
  onChange,
  saved,
  confirmed,
  options,
  errors,
}: {
  value: string;
  onChange: (zone: string) => void;
  /** The timezone stored in the profile. */
  saved: string;
  confirmed: boolean;
  options: string[];
  errors: FieldErrors;
}) {
  const browser = useBrowserTimezone();
  const zones = browser && !options.includes(browser) ? [...options, browser].sort() : options;
  return (
    <div className="field">
      <label htmlFor="timezone">Timezone</label>
      <select
        id="timezone"
        name="timezone"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={errors.timezone ? true : undefined}
        aria-describedby="timezone-hint"
      >
        {zones.map((zone) => (
          <option key={zone} value={zone}>
            {zoneLabel(zone)}
          </option>
        ))}
      </select>
      <p className="field-hint" id="timezone-hint">
        {browser ? `It's ${timeIn(value)} there. ` : null}
        &ldquo;Today&rdquo;, Monday–Sunday weeks, and new entries use this timezone.
      </p>
      {browser && !sameTimezone(browser, value) ? (
        <div className="notice small stack-sm">
          <span>
            This device is set to <strong>{zoneLabel(browser)}</strong>.
            {sameTimezone(browser, saved) ? " That is your saved timezone." : " DayKind won't switch automatically."}
          </span>
          <div className="row">
            <button type="button" className="button button-secondary" onClick={() => onChange(browser)}>
              Use {zoneLabel(browser)}
            </button>
          </div>
        </div>
      ) : null}
      {confirmed && value !== saved ? (
        <p className="notice notice-info small">
          Changing from {zoneLabel(saved)}: records you already saved keep the date and timezone they were entered
          with. Only new entries and what counts as &ldquo;today&rdquo; change.
        </p>
      ) : null}
      <FieldError errors={errors} name="timezone" />
    </div>
  );
}

export function UnitFields({
  distanceUnit,
  weightUnit,
  weightTrackingEnabled,
  errors,
}: {
  distanceUnit: DistanceUnit;
  weightUnit: WeightUnit;
  weightTrackingEnabled: boolean;
  errors: FieldErrors;
}) {
  const [tracking, setTracking] = useState(weightTrackingEnabled);
  const [unit, setUnit] = useState<WeightUnit>(weightUnit);
  return (
    <div className="stack">
      <ChoiceGroup
        name="distanceUnit"
        legend="Distance"
        defaultValue={distanceUnit}
        errors={errors}
        options={[
          { value: "mi", label: "Miles" },
          { value: "km", label: "Kilometers" },
        ]}
      />
      <fieldset className="stack-sm">
        <legend>Weight (optional)</legend>
        <label className="choice">
          <input type="checkbox" name="weightTracking" checked={tracking} onChange={(e) => setTracking(e.target.checked)} />
          Include weight in my reports
        </label>
        <p className="field-hint">
          You can skip this. No target weight is set. Entering weight is a later feature; this only decides whether
          weight appears and in which unit.
        </p>
      </fieldset>
      {tracking ? (
        <fieldset aria-describedby={errors.weightUnit ? "weightUnit-error" : undefined}>
          <legend>Weight unit</legend>
          <div className="choice-group cols-3">
            {(["lb", "kg"] as const).map((u) => (
              <label key={u} className="choice">
                <input type="radio" name="weightUnit" value={u} checked={unit === u} onChange={() => setUnit(u)} />
                {u === "lb" ? "Pounds" : "Kilograms"}
              </label>
            ))}
          </div>
          <FieldError errors={errors} name="weightUnit" />
        </fieldset>
      ) : (
        <input type="hidden" name="weightUnit" value={unit} />
      )}
    </div>
  );
}

export interface TargetValues {
  walkingMinutes: string;
  resistanceSessions: string;
  cyclingMinutes: string;
}

export function targetValuesOf(goal: GoalVersion): TargetValues {
  return {
    walkingMinutes: String(Math.round(goal.walkingSecondsPerDay / 60)),
    resistanceSessions: String(goal.resistanceSessionsPerWeek),
    cyclingMinutes: String(Math.round(goal.cyclingSecondsPerWeek / 60)),
  };
}

function NumberField({
  name,
  label,
  hint,
  value,
  onChange,
  limits,
  errors,
}: {
  name: keyof TargetValues;
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  limits: { min: number; max: number };
  errors: FieldErrors;
}) {
  return (
    <div className="field">
      <label htmlFor={name}>
        {label}
        <span className="field-hint"> · {hint}</span>
      </label>
      <input
        id={name}
        name={name}
        type="number"
        inputMode="numeric"
        min={limits.min}
        max={limits.max}
        step={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={errors[name] ? true : undefined}
        aria-describedby={errors[name] ? `${name}-error` : undefined}
      />
      <FieldError errors={errors} name={name} />
    </div>
  );
}

/** Controlled so a parent can reset the values after the saved version changes. */
export function TargetFields({
  values,
  onChange,
  errors,
}: {
  values: TargetValues;
  onChange: (values: TargetValues) => void;
  errors: FieldErrors;
}) {
  const set = (key: keyof TargetValues) => (value: string) => onChange({ ...values, [key]: value });
  return (
    <div className="stack">
      <NumberField
        name="walkingMinutes"
        label="Walking minutes each day"
        hint="several short walks add up; default 10"
        value={values.walkingMinutes}
        onChange={set("walkingMinutes")}
        limits={TARGET_LIMITS.walkingMinutesPerDay}
        errors={errors}
      />
      <NumberField
        name="resistanceSessions"
        label="Resistance sessions each week"
        hint="any length counts; default 2"
        value={values.resistanceSessions}
        onChange={set("resistanceSessions")}
        limits={TARGET_LIMITS.resistanceSessionsPerWeek}
        errors={errors}
      />
      <NumberField
        name="cyclingMinutes"
        label="Cycling minutes each week"
        hint="active time across rides, indoor included; default 60"
        value={values.cyclingMinutes}
        onChange={set("cyclingMinutes")}
        limits={TARGET_LIMITS.cyclingMinutesPerWeek}
        errors={errors}
      />
    </div>
  );
}

export function startsOn(date: LocalDate): string {
  return formatLocalDate(date, "long");
}
