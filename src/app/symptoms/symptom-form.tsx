"use client";

import { useActionState, useTransition, type FormEvent } from "react";

import {
  AnkleFields,
  EditTarget,
  FieldError,
  SaveStatus,
  initialFormState,
  useRequestId,
} from "@/app/check-in/form-parts";
import type { SymptomEntry } from "@/lib/domain/types";
import { saveSymptom } from "./actions";

export function SymptomForm({ existing, today }: { existing: SymptomEntry | null; today: string }) {
  const [state, formAction] = useActionState(saveSymptom, initialFormState);
  const [pending, startTransition] = useTransition();
  const nextRequestId = useRequestId();

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    data.set("requestId", nextRequestId(state.status));
    startTransition(() => formAction(data));
  };

  return (
    <form className="stack" onSubmit={onSubmit} noValidate>
      <EditTarget id={existing?.id} revision={existing?.revision} />
      {existing ? null : <input type="hidden" name="localDate" value={today} />}
      <section className="card stack">
        <AnkleFields errors={state.errors} defaults={existing} />
        <FieldError errors={state.errors} name="localDate" />
      </section>
      <div className="form-actions">
        <SaveStatus state={state} pending={pending} />
        <button className="button button-block" type="submit" disabled={pending}>
          {existing ? "Save changes" : "Save ankle update"}
        </button>
      </div>
    </form>
  );
}
