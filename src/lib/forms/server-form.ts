import "server-only";

// Shared handling for form-backed server actions: raw form values, write
// metadata (idempotency and edit revision), and user-facing save states.
import { refresh } from "next/cache";

import type { MutationResult, WriteMeta } from "@/lib/data";
import { UUID_PATTERN, type FieldErrors, type RawForm } from "@/lib/domain/checkins";

export interface CheckInFormState {
  status: "idle" | "invalid" | "saved" | "not_persisted" | "conflict" | "failed";
  message: string | null;
  errors: FieldErrors;
}

export function toRaw(formData: FormData): RawForm {
  const raw: RawForm = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") raw[key] = value;
  }
  return raw;
}

/**
 * Idempotency key, the revision being edited (empty when creating), and the
 * edited record's id. The form keeps one request id per save attempt and
 * reuses it on retry, so a repeated submission cannot save twice.
 */
export function writeMeta(raw: RawForm): WriteMeta | null {
  if (!raw.requestId || !UUID_PATTERN.test(raw.requestId)) return null;
  const revision = raw.expectedRevision ? Number(raw.expectedRevision) : NaN;
  return {
    requestId: raw.requestId,
    expectedRevision: Number.isInteger(revision) && revision > 0 ? revision : null,
    id: raw.entryId && UUID_PATTERN.test(raw.entryId) ? raw.entryId : null,
  };
}

export const invalid = (errors: FieldErrors): CheckInFormState => ({
  status: "invalid",
  message: "Some answers need attention. Nothing you entered was cleared.",
  errors,
});

export const staleForm: CheckInFormState = {
  status: "failed",
  message: "Not saved: this form is out of date. Copy anything you need, then reload the page.",
  errors: {},
};

export const serverFailure: CheckInFormState = {
  status: "failed",
  message: "Not saved: the server could not save this check-in. Your answers are still here — try again.",
  errors: {},
};

export function fromResult(result: MutationResult<unknown>): CheckInFormState {
  switch (result.status) {
    case "saved":
      // Re-render the page from the database so it shows what was stored.
      refresh();
      return { status: "saved", message: "Saved. It will show on your other devices after they refresh.", errors: {} };
    case "not_persisted":
      return { status: "not_persisted", message: result.reason, errors: {} };
    case "conflict":
    case "not_found":
      return { status: "conflict", message: `Not saved: ${result.reason} Your answers are still here.`, errors: {} };
    case "failed":
      return { status: "failed", message: `Not saved: ${result.reason} Your answers are still here.`, errors: {} };
  }
}

