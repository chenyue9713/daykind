"use client";

import { useActionState, useState, useTransition, type FormEvent } from "react";

import { EditTarget, SaveStatus, initialFormState, useRequestId } from "@/app/check-in/form-parts";
import type { GoalVersion, LocalDate, UserProfile } from "@/lib/domain/types";
import { savePreferences, saveTargets } from "./actions";
import {
  TargetFields,
  TimezoneField,
  UnitFields,
  startsOn,
  targetValuesOf,
  useNextMonday,
  type TargetValues,
} from "./preference-fields";

export function PreferencesForm({ profile, timezones }: { profile: UserProfile; timezones: string[] }) {
  const [state, formAction] = useActionState(savePreferences, initialFormState);
  const [pending, startTransition] = useTransition();
  const nextRequestId = useRequestId();
  const [timezone, setTimezone] = useState(profile.timezone);

  // Submit without React's automatic form reset so choices stay after a failure.
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    data.set("requestId", nextRequestId(state.status));
    startTransition(() => formAction(data));
  };

  return (
    <form className="stack" onSubmit={onSubmit} noValidate>
      {/* The profile revision this form shows; a change from another device is a conflict. */}
      <EditTarget revision={profile.revision} />
      <TimezoneField
        value={timezone}
        onChange={setTimezone}
        saved={profile.timezone}
        confirmed={profile.timezoneConfirmed}
        options={timezones}
        errors={state.errors}
      />
      <UnitFields
        distanceUnit={profile.distanceUnit}
        weightUnit={profile.weightUnit}
        weightTrackingEnabled={profile.weightTrackingEnabled}
        errors={state.errors}
      />
      <div className="stack-sm">
        <SaveStatus state={state} pending={pending} />
        <div className="row">
          <button className="button" type="submit" disabled={pending}>
            {profile.timezoneConfirmed ? "Save time and units" : "Confirm timezone and save"}
          </button>
        </div>
      </div>
    </form>
  );
}

export function TargetsForm({
  current,
  pending: pendingVersion,
  timezone,
  nextMonday,
}: {
  current: GoalVersion;
  pending: GoalVersion | null;
  timezone: string;
  /** Next Monday in the saved timezone, as computed by the server. */
  nextMonday: LocalDate;
}) {
  const [state, formAction] = useActionState(saveTargets, initialFormState);
  const [saving, startTransition] = useTransition();
  const nextRequestId = useRequestId();
  const startDate = useNextMonday(timezone, nextMonday);

  // Show the pending version when there is one. When the saved version
  // changes (after a save here or a reload), reset to what was stored.
  const versionKey = pendingVersion ? `${pendingVersion.id}:${pendingVersion.revision}` : `current:${current.id}`;
  const [shownKey, setShownKey] = useState(versionKey);
  const [values, setValues] = useState<TargetValues>(targetValuesOf(pendingVersion ?? current));
  if (shownKey !== versionKey) {
    setShownKey(versionKey);
    setValues(targetValuesOf(pendingVersion ?? current));
  }

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    if (submitter instanceof HTMLButtonElement && submitter.name === "intent") data.set("intent", submitter.value);
    data.set("requestId", nextRequestId(state.status));
    startTransition(() => formAction(data));
  };

  return (
    <form className="stack" onSubmit={onSubmit} noValidate>
      {/* The pending version being edited, so saving updates it instead of adding another. */}
      <input type="hidden" name="pendingId" value={pendingVersion?.id ?? ""} />
      <input type="hidden" name="pendingRevision" value={pendingVersion?.revision ?? ""} />
      <TargetFields values={values} onChange={setValues} errors={state.errors} />
      <p className="small muted">
        {pendingVersion
          ? `Saving updates the upcoming change instead of adding another. It starts ${startsOn(startDate)}.`
          : `A change starts ${startsOn(startDate)} and doesn't alter this week or earlier weeks.`}
      </p>
      <div className="stack-sm">
        <SaveStatus state={state} pending={saving} />
        <div className="row">
          <button className="button" type="submit" name="intent" value="save" disabled={saving}>
            {pendingVersion ? "Update upcoming targets" : `Save for ${startsOn(startDate)}`}
          </button>
          {pendingVersion ? (
            <button className="button button-secondary" type="submit" name="intent" value="discard" disabled={saving}>
              Cancel upcoming change
            </button>
          ) : null}
        </div>
      </div>
    </form>
  );
}
