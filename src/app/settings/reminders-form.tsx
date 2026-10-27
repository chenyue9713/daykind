"use client";

import { useActionState, useState, useTransition, type FormEvent } from "react";

import { EditTarget, FieldError, SaveStatus, initialFormState, useRequestId } from "@/app/check-in/form-parts";
import { followUpsInQuietHours, type ReminderChannel, type ReminderSettings } from "@/lib/domain/reminders";
import { saveReminderSettings, sendTestReminder } from "./reminder-actions";

export function RemindersForm({
  settings,
  email,
  timezone,
  pushDeviceLabel,
}: {
  settings: ReminderSettings;
  email: string | null;
  timezone: string;
  /** The registered browser, if any. */
  pushDeviceLabel: string | null;
}) {
  const [state, formAction] = useActionState(saveReminderSettings, initialFormState);
  const [pending, startTransition] = useTransition();
  const nextRequestId = useRequestId();
  const [quiet, setQuiet] = useState({
    quietHoursEnabled: settings.quietHoursEnabled,
    quietStart: settings.quietStart,
    quietEnd: settings.quietEnd,
  });
  const valid = /^\d{2}:\d{2}$/.test(quiet.quietStart) && /^\d{2}:\d{2}$/.test(quiet.quietEnd);
  const skipped = valid ? followUpsInQuietHours(quiet) : [];

  // Submit without React's automatic form reset so choices stay after a failure.
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    data.set("requestId", nextRequestId(state.status));
    startTransition(() => formAction(data));
  };

  return (
    <form className="stack" onSubmit={onSubmit} noValidate>
      <EditTarget revision={settings.revision} />
      <fieldset className="stack-sm">
        <legend>Delivery</legend>
        <label className="choice">
          <input type="checkbox" name="deliveryEnabled" defaultChecked={settings.deliveryEnabled} />
          Send me check-in reminders
        </label>
        <p className="field-hint">
          Nothing is sent until you turn this on. Reminders say only which check-in is open and link to DayKind,
          where you sign in as usual.
        </p>
      </fieldset>

      <fieldset className="stack-sm">
        <legend>Send them by</legend>
        <div className="choice-group">
          <label className="choice">
            <input type="radio" name="channel" value="email" defaultChecked={settings.channel === "email"} />
            Email{email ? ` to ${email}` : null}
          </label>
          <label className="choice">
            <input type="radio" name="channel" value="push" defaultChecked={settings.channel === "push"} />
            Browser notification on {pushDeviceLabel ?? "the browser you register below"}
          </label>
        </div>
        <p className="field-hint">One channel and one browser, so the same reminder never arrives twice.</p>
        <FieldError errors={state.errors} name="channel" />
      </fieldset>

      <fieldset className="stack-sm">
        <legend>Reminders</legend>
        <label className="choice">
          <input type="checkbox" name="morningEnabled" defaultChecked={settings.morningEnabled} />
          Morning check-in at 10 AM
        </label>
        <label className="choice">
          <input type="checkbox" name="eveningEnabled" defaultChecked={settings.eveningEnabled} />
          Evening check-in at 9 PM
        </label>
        <label className="choice">
          <input type="checkbox" name="followUpsEnabled" defaultChecked={settings.followUpsEnabled} />
          One follow-up an hour later (11 AM, 10 PM) if the check-in is still open
        </label>
        <p className="field-hint">
          Times are in {timezone.replaceAll("_", " ")} and stay the same across daylight saving changes. A check-in
          you&apos;ve finished on any device cancels its reminder and follow-up. A reminder more than two hours late
          is skipped.
        </p>
      </fieldset>

      <fieldset className="stack-sm">
        <legend>Quiet hours</legend>
        <label className="choice">
          <input
            type="checkbox"
            name="quietHoursEnabled"
            checked={quiet.quietHoursEnabled}
            onChange={(e) => setQuiet({ ...quiet, quietHoursEnabled: e.target.checked })}
          />
          Skip follow-ups during quiet hours
        </label>
        <div className="inline-inputs">
          <div className="field">
            <label htmlFor="quietStart">From</label>
            <input
              id="quietStart"
              name="quietStart"
              type="time"
              value={quiet.quietStart}
              onChange={(e) => setQuiet({ ...quiet, quietStart: e.target.value })}
              aria-invalid={state.errors.quietStart ? true : undefined}
            />
            <FieldError errors={state.errors} name="quietStart" />
          </div>
          <div className="field">
            <label htmlFor="quietEnd">Until</label>
            <input
              id="quietEnd"
              name="quietEnd"
              type="time"
              value={quiet.quietEnd}
              onChange={(e) => setQuiet({ ...quiet, quietEnd: e.target.value })}
              aria-invalid={state.errors.quietEnd ? true : undefined}
            />
            <FieldError errors={state.errors} name="quietEnd" />
          </div>
        </div>
        <p className="field-hint">
          A follow-up that falls in quiet hours is skipped, not moved to later. The 10 AM and 9 PM reminders are not
          affected; turn them off above if you don&apos;t want them.
          {skipped.length > 0
            ? ` With these hours, the ${skipped.map((k) => (k === "morning" ? "11 AM" : "10 PM")).join(" and ")} follow-up is skipped.`
            : null}
        </p>
      </fieldset>

      <div className="stack-sm">
        <SaveStatus state={state} pending={pending} />
        <div className="row">
          <button className="button" type="submit" disabled={pending}>
            Save reminder settings
          </button>
        </div>
      </div>
    </form>
  );
}

export function TestNotification({
  channel,
  label,
  disabled,
}: {
  channel: ReminderChannel;
  label: string;
  disabled: boolean;
}) {
  const [state, formAction] = useActionState(sendTestReminder, initialFormState);
  const [pending, startTransition] = useTransition();
  const nextRequestId = useRequestId();

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData();
    data.set("requestId", nextRequestId(state.status));
    data.set("channel", channel);
    startTransition(() => formAction(data));
  };

  return (
    <form className="stack-sm" onSubmit={onSubmit}>
      {pending ? (
        <p className="notice small" role="status">
          Sending…
        </p>
      ) : (
        <SaveStatus state={state} pending={false} />
      )}
      <div className="row">
        <button className="button button-secondary" type="submit" disabled={pending || disabled}>
          {label}
        </button>
      </div>
    </form>
  );
}
