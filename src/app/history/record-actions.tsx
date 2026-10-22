"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { deleteRecord, type DeleteState, type RecordKind } from "@/app/check-in/actions";

/** Edit and delete controls for one stored record. Delete asks for confirmation inline. */
export function RecordActions({
  label,
  kind,
  id,
  revision,
  editHref,
  disabled,
}: {
  label: string;
  kind: RecordKind;
  id: string;
  revision: number;
  editHref: string | null;
  /** Sample data cannot be changed. */
  disabled: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, setState] = useState<DeleteState>({ status: "idle", message: null });
  const [pending, startTransition] = useTransition();

  if (disabled) {
    return (
      <div className="entry-actions">
        <button type="button" className="button button-secondary" disabled aria-label={`Edit ${label} (sample data can't be changed)`}>
          Edit
        </button>
        <button type="button" className="button button-secondary" disabled aria-label={`Delete ${label} (sample data can't be changed)`}>
          Delete
        </button>
      </div>
    );
  }

  const remove = () =>
    startTransition(async () => {
      const result = await deleteRecord(kind, { id, expectedRevision: revision });
      setState(result);
      if (result.status !== "deleted") setConfirming(false);
    });

  return (
    <div className="stack-sm">
      <div className="entry-actions">
        {confirming ? (
          <>
            <button type="button" className="button button-danger" onClick={remove} disabled={pending}>
              {pending ? "Deleting…" : `Delete ${label}`}
            </button>
            <button type="button" className="button button-secondary" onClick={() => setConfirming(false)} disabled={pending}>
              Keep
            </button>
          </>
        ) : (
          <>
            {editHref ? (
              <Link className="button button-secondary" href={editHref} aria-label={`Edit ${label}`}>
                Edit
              </Link>
            ) : null}
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setConfirming(true)}
              aria-label={`Delete ${label}`}
            >
              Delete
            </button>
          </>
        )}
      </div>
      {state.message && state.status === "failed" ? (
        <p className="field-error" role="alert">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
