"use client";

import Link from "next/link";
import { useId, useRef, useState, type ChangeEvent } from "react";

import type { DistanceUnit } from "@/lib/domain/types";
import type { ConfirmOutcome, PreviewOutcome } from "@/lib/import/service";
import type { ImportError, ImportPreview } from "@/lib/import/types";
import { initialDecision, missingAnswers, toSessionDecision, type DraftDecision } from "./decision-state";
import styles from "./import.module.css";
import { SessionCard } from "./session-card";

type Phase = "idle" | "reading" | "preview" | "saving";

interface Notice {
  tone: "success" | "info" | "error";
  text: string;
}

const NETWORK_ERROR: ImportError = {
  code: "storage_failed",
  message: "DayKind couldn't be reached. Check your connection and try again. Nothing was saved.",
};

async function post<T>(url: string, body: FormData): Promise<T | { ok: false; status: "error"; error: ImportError }> {
  try {
    const response = await fetch(url, { method: "POST", body, credentials: "same-origin" });
    return (await response.json()) as T;
  } catch {
    return { ok: false, status: "error", error: NETWORK_ERROR };
  }
}

export function ImportClient({
  isSample,
  timezone,
  distanceUnit,
  maxBytes,
  maxLabel,
}: {
  isSample: boolean;
  timezone: string;
  distanceUnit: DistanceUnit;
  maxBytes: number;
  maxLabel: string;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [decisions, setDecisions] = useState<Record<string, DraftDecision>>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const [savedIds, setSavedIds] = useState<string[] | null>(null);

  const showPreview = (next: ImportPreview) => {
    setPreview(next);
    setDecisions(Object.fromEntries(next.sessions.map((s) => [s.key, initialDecision(s)])));
    setPhase("preview");
  };

  const reset = (message: Notice | null) => {
    setFile(null);
    setPreview(null);
    setDecisions({});
    setPhase("idle");
    setNotice(message);
    if (inputRef.current) inputRef.current.value = "";
  };

  const onSelect = async (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0] ?? null;
    setSavedIds(null);
    setPreview(null);
    if (!selected) return;
    // Quick checks for instant feedback; the server checks the actual contents.
    if (!/\.(fit|tcx)$/i.test(selected.name)) {
      reset({ tone: "error", text: "Select a .fit or .tcx file. A Garmin “Export Original” .zip must be opened first; select the .fit file inside it." });
      return;
    }
    if (selected.size > maxBytes) {
      reset({ tone: "error", text: `This file is larger than ${maxLabel}. Export a single workout instead.` });
      return;
    }
    setFile(selected);
    setNotice(null);
    setPhase("reading");
    const body = new FormData();
    body.set("file", selected);
    const result = await post<PreviewOutcome>("/import/preview", body);
    if ("ok" in result && result.ok) {
      showPreview(result.preview);
    } else {
      setPhase("idle");
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      setNotice({ tone: "error", text: result.error.message });
    }
  };

  const sessions = preview?.sessions ?? [];
  const importable = sessions.filter((s) => s.status !== "failed");
  const chosen = importable.filter((s) => decisions[s.key]?.include);
  const outstanding = chosen.flatMap((s) => missingAnswers(s, decisions[s.key]).map((m) => `Session ${s.index + 1}: ${m}`));
  const canSave = phase === "preview" && chosen.length > 0 && outstanding.length === 0;

  const onSave = async () => {
    if (!preview || !file || !canSave) return;
    setPhase("saving");
    setNotice(null);
    const body = new FormData();
    body.set("file", file);
    body.set("requestId", preview.requestId);
    body.set("expectedHash", preview.fileHash);
    body.set("decisions", JSON.stringify(sessions.map((s) => toSessionDecision(s, decisions[s.key])).filter(Boolean)));
    const result = await post<ConfirmOutcome>("/import/confirm", body);
    if (!("status" in result)) {
      setPhase("preview");
      setNotice({ tone: "error", text: NETWORK_ERROR.message });
      return;
    }
    if (result.status === "saved") {
      const count = result.activityIds.length;
      setSavedIds(result.activityIds);
      reset({ tone: "success", text: `Saved ${count} ${count === 1 ? "activity" : "activities"}. The file itself was not kept.` });
    } else if (result.status === "not_persisted") {
      setPhase("preview");
      setNotice({ tone: "info", text: `Checked but not saved: ${result.message}` });
    } else {
      if ("preview" in result && result.preview) showPreview(result.preview);
      else setPhase("preview");
      setNotice({ tone: "error", text: result.error.message });
    }
  };

  const busy = phase === "reading" || phase === "saving";

  return (
    <div className="stack">
      {isSample ? (
        <p className="notice notice-info small" role="note">
          <strong>Saving is not connected yet.</strong> In sample mode you can check how DayKind reads your real files, but
          confirmed imports are not stored. Possible duplicates are compared with the sample activities.
        </p>
      ) : null}

      <section className="card stack-sm" aria-labelledby="choose-heading">
        <h2 id="choose-heading">Choose a file</h2>
        <p className="small muted">
          In Garmin Connect, open the activity, then use the gear menu: <em>Export to TCX</em>, or <em>Export Original</em> for FIT
          (that one downloads a .zip, so open it first). One workout file at a time, up to {maxLabel}. DayKind never asks for
          your Garmin password.
        </p>
        <div className={styles.picker}>
          {/* No `accept` filter: some phone browsers grey out .fit/.tcx files they don't recognize. The server checks contents. */}
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            className={styles.fileInput}
            onChange={onSelect}
            disabled={busy}
            aria-describedby={`${inputId}-hint`}
          />
          <label htmlFor={inputId} className={`button ${preview ? "button-secondary" : ""} ${styles.pickerButton}`} aria-disabled={busy || undefined}>
            {preview ? "Choose a different file" : "Choose TCX or FIT file"}
          </label>
          <span id={`${inputId}-hint`} className={`small muted ${styles.fileName}`}>
            {file ? file.name : "No file selected"}
          </span>
        </div>
        <p className="small muted">
          Only summaries are kept: GPS routes and second-by-second sensor data are discarded, and the file itself is never stored.
        </p>
      </section>

      <div aria-live="polite" className="stack-sm">
        {phase === "reading" ? (
          <p className="notice small" role="status">
            Reading the file…
          </p>
        ) : null}
        {notice ? (
          <div className={`notice small notice-${notice.tone} stack-sm`} role={notice.tone === "error" ? "alert" : "status"}>
            <p>{notice.text}</p>
            {notice.tone === "error" ? (
              <p>
                <Link href="/check-in/evening">Add the workout manually instead</Link>
              </p>
            ) : null}
            {notice.tone === "success" && savedIds ? (
              <p>
                <Link href="/history">See it in History</Link>
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      {preview ? (
        <>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2>
              {sessions.length === 1 ? "1 session found" : `${sessions.length} sessions found`}
              {sessions.length !== importable.length ? ` · ${sessions.length - importable.length} can't be imported` : ""}
            </h2>
            <span className="small muted">Times shown in {timezone} unless you choose otherwise</span>
          </div>
          {preview.warnings.map((w) => (
            <p key={w} className="notice small">
              {w}
            </p>
          ))}
          {sessions.map((s) => (
            <SessionCard
              key={`${preview.requestId}-${s.key}`}
              preview={preview}
              session={s}
              decision={decisions[s.key]}
              onChange={(next) => setDecisions((all) => ({ ...all, [s.key]: next }))}
              distanceUnit={distanceUnit}
              disabled={busy}
            />
          ))}

          <div className="form-actions">
            {outstanding.length > 0 ? (
              <p className="small" id="import-outstanding">
                {outstanding.length === 1 ? outstanding[0] : `${outstanding.length} answers needed before saving.`}
              </p>
            ) : chosen.length === 0 ? (
              <p className="small">Select at least one session to import, or cancel.</p>
            ) : (
              <p className="small muted">
                {chosen.length === 1 ? "1 activity" : `${chosen.length} activities`} will be saved together. If anything fails, nothing is saved.
              </p>
            )}
            <div className="row">
              <button type="button" className="button" onClick={onSave} disabled={!canSave} aria-describedby={outstanding.length ? "import-outstanding" : undefined}>
                {phase === "saving" ? "Saving…" : chosen.length > 1 ? `Save ${chosen.length} activities` : "Save activity"}
              </button>
              <button
                type="button"
                className="button button-secondary"
                disabled={phase === "saving"}
                onClick={() => reset({ tone: "info", text: "Import cancelled. Nothing was saved, and the file was not kept." })}
              >
                Cancel
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
