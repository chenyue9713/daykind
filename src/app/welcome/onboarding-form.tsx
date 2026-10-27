"use client";

import { useActionState, useState, useTransition, type FormEvent } from "react";

import { EditTarget, FieldError, SaveStatus, initialFormState, useRequestId } from "@/app/check-in/form-parts";
import { GuidanceLimits } from "@/app/settings/guidance-limits";
import { completeOnboarding } from "@/app/settings/actions";
import {
  TargetFields,
  TimezoneField,
  UnitFields,
  startsOn,
  targetValuesOf,
  useNextMonday,
  type TargetValues,
} from "@/app/settings/preference-fields";
import type { GoalVersion, LocalDate, UserProfile } from "@/lib/domain/types";

/**
 * First-use setup on one page, so nothing is lost between steps and a failed
 * save keeps every answer. Everything is saved together when finished.
 */
export function OnboardingForm({
  profile,
  timezones,
  current,
  pending,
  nextMonday,
  ruleVersion,
}: {
  profile: UserProfile;
  timezones: string[];
  current: GoalVersion;
  pending: GoalVersion | null;
  nextMonday: LocalDate;
  ruleVersion: string;
}) {
  const [state, formAction] = useActionState(completeOnboarding, initialFormState);
  const [saving, startTransition] = useTransition();
  const nextRequestId = useRequestId();
  const [timezone, setTimezone] = useState(profile.timezone);
  const [targets, setTargets] = useState<TargetValues>(targetValuesOf(pending ?? current));
  const startDate = useNextMonday(timezone, nextMonday);
  const initial = targetValuesOf(current);
  const changed =
    targets.walkingMinutes !== initial.walkingMinutes ||
    targets.resistanceSessions !== initial.resistanceSessions ||
    targets.cyclingMinutes !== initial.cyclingMinutes;
  const errors = state.errors;

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    data.set("requestId", nextRequestId(state.status));
    startTransition(() => formAction(data));
  };

  return (
    <form className="stack" onSubmit={onSubmit} noValidate>
      <EditTarget revision={profile.revision} />
      <input type="hidden" name="pendingId" value={pending?.id ?? ""} />
      <input type="hidden" name="pendingRevision" value={pending?.revision ?? ""} />

      <section className="card stack" aria-labelledby="step-time">
        <h2 id="step-time">1 · Confirm your timezone</h2>
        <p className="small">
          It decides what &ldquo;today&rdquo; is and when each Monday–Sunday week starts. DayKind suggests your
          device&apos;s timezone but never changes it on its own, even when you travel.
        </p>
        <TimezoneField
          value={timezone}
          onChange={setTimezone}
          saved={profile.timezone}
          confirmed={profile.timezoneConfirmed}
          options={timezones}
          errors={errors}
        />
      </section>

      <section className="card stack" aria-labelledby="step-units">
        <h2 id="step-units">2 · Units</h2>
        <UnitFields
          distanceUnit={profile.distanceUnit}
          weightUnit={profile.weightUnit}
          weightTrackingEnabled={profile.weightTrackingEnabled}
          errors={errors}
        />
      </section>

      <section className="card stack" aria-labelledby="step-targets">
        <h2 id="step-targets">3 · Review your activity targets</h2>
        <p className="small">
          These are starting points you can change any time in Settings. Feeling well comes first: a recovery day or a
          missed target is fine.
        </p>
        <TargetFields values={targets} onChange={setTargets} errors={errors} />
        {changed ? (
          <p className="notice notice-info small">
            Your new targets start {startsOn(startDate)}. Until then, this week uses the current targets, so its
            progress isn&apos;t rewritten.
          </p>
        ) : null}
      </section>

      <section className="card stack" aria-labelledby="step-guidance">
        <h2 id="step-guidance">4 · How the guidance works</h2>
        <GuidanceLimits ruleVersion={ruleVersion} />
        <label className="choice">
          <input
            type="checkbox"
            name="acknowledgeGuidance"
            aria-invalid={errors.acknowledgeGuidance ? true : undefined}
            aria-describedby={errors.acknowledgeGuidance ? "acknowledgeGuidance-error" : undefined}
          />
          I understand the suggestions are draft, general information and not medical advice.
        </label>
        <FieldError errors={errors} name="acknowledgeGuidance" />
      </section>

      <section className="card stack-sm" aria-labelledby="step-next">
        <h2 id="step-next">Good to know</h2>
        <ul className="small">
          <li>
            Workouts can be entered by hand or imported from Garmin TCX or FIT files you export. DayKind never connects
            to your Garmin account or asks for its password.
          </li>
          <li>Reminders aren&apos;t available yet. Check-ins that are due appear on the Today screen.</li>
        </ul>
      </section>

      <div className="form-actions">
        <SaveStatus state={state} pending={saving} />
        <button className="button button-block" type="submit" disabled={saving}>
          Finish setup
        </button>
      </div>
    </form>
  );
}
