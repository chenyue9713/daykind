# Workout file import (TCX and FIT)

Implements PRD FR04 (upload and normalization) and the "Import review" screen, using the shared [activity contract](activity-contract.md) for persistence. Route: `/import`.

## Flow

1. **Select** one `.tcx` or `.fit` file (up to 20 MB) on desktop or phone.
2. **Preview** (`POST /import/preview`): the server checks the size while the upload streams in, detects the real format from the bytes, parses with bounds, computes a SHA-256, and stops early if `findImportedFile` says this exact file was already imported. It then normalizes each session and asks `findDuplicateCandidates` for possible matches. Nothing is stored.
3. **Review**: each session shows sport, date and timezone, the duration basis (active/timer, or a labeled elapsed fallback with paused time shown), distance, heart rate with its basis and coverage, and the source. The user must answer every ambiguity: the sport when the file can't say, the day when the timezone is unknown or the watch disagrees with the profile, and keep both / link / replace for every suspected duplicate. A link or replace shows a before/after table.
4. **Confirm** (`POST /import/confirm`): the browser sends the same file again with the decisions. The server re-parses it and checks that the hash matches. It rebuilds duplicate candidates and rejects the save if a new candidate appeared or a target's revision changed. It then calls `saveConfirmedImport` once, so every selected session saves or none does.

The preview is **stateless**: there is no pending-import table or raw-upload bucket, and nothing needs cleaning up after a cancel or failure.

## Code

| Path | Role |
|---|---|
| `src/lib/import/parsers/` | Format adapters. `fit.ts` is a dependency-free bounded FIT decoder; `tcx.ts` streams TCX through `xml.ts`, a strict tokenizer that rejects any DTD. Both return the normalized `ParsedFile` in `types.ts`. |
| `src/lib/import/sniff.ts`, `limits.ts` | Content detection (archives, images, extension mismatches), filename sanitizing, and all size, structure, and time bounds. |
| `src/lib/import/normalize.ts` | Sport mapping, timezone candidates, duration basis, missing and implausible values, and per-field provenance. |
| `src/lib/import/decisions.ts` | Validates untrusted decisions against the rebuilt preview and builds the contract's `ConfirmedImport` (drafts pass `validateActivityDraft`). |
| `src/lib/import/service.ts` | Preview and confirm workflow over `ActivityStore` (only `findImportedFile`, `findDuplicateCandidates`, `saveConfirmedImport`). |
| `src/lib/import/server.ts` | Route-handler glue: same-origin check, byte-capped body reader, multipart parsing, `getRepository()`. |
| `src/app/import/` | Page, route handlers, client UI. Styles live in a CSS module, so `globals.css` is unchanged. |

Route handlers are used instead of Server Actions because actions cap bodies at 1 MB, and raising that would mean changing the shared `next.config.ts`.

## Rules and their sources

| Rule | Behavior |
|---|---|
| Duration basis | `measuredDurationBasis(activeSeconds)` from the contract: timer time when present, otherwise elapsed time labeled as a fallback. A timer longer than elapsed is rejected and the elapsed fallback is used. Both values are kept, so pauses stay visible. |
| TCX duration | Lap `TotalTimeSeconds` sum is timer time. Elapsed is derived from the first lap start to the last trackpoint (or lap end) and is marked `derived`. |
| Heart rate | Uses the device's summary when present (TCX laps are weighted by lap time). Otherwise it is time-weighted from samples, each counted for at most 10 s, so gaps are never filled. An average is shown only at ≥ 80 % coverage, and coverage is always shown. Values outside 25–250 bpm are ignored. |
| Distance | Meters. A device-reported 0 is stored as unknown (`null`), because it means "no sensor". |
| Sport | FIT cycling, e-biking, and indoor cycling map to cycling. Walking and indoor, casual, or speed walking map to walking. Training or fitness equipment with strength training maps to resistance. Generic or missing sports, hiking, and every TCX `Running`/`Other` need a user choice, with a suggestion from pace when it looks like walking. TCX `Biking` maps to cycling. |
| Date and timezone | The local date always equals `localDateOf(startedAt, timezone)`, so a correction is a timezone choice. FIT's `local_timestamp` gives the device offset. If it matches the profile zone, the date is confident. If it gives a different date, the user chooses between the profile zone and the watch's zone (`Etc/GMT±N`, or an IANA zone with that offset). Files without an offset (TCX) and floating TCX times (no `Z`) always ask for confirmation. |
| Exact repeats | SHA-256 of the bytes, scoped to the user by `findImportedFile` and the `(user_id, file_hash)` unique constraint. Renaming the file doesn't matter. |
| Suspected duplicates | The contract's `isSuspectedDuplicate`: same type, start within ±120 s, duration within ±10 %. A manual entry without a start time matches on the same local date. Ambiguous sports query all four types and filter by the user's choice. Nothing merges silently. |
| Link / replace | Link keeps the existing activity, note, and effort; the file supplies measured fields. Replace saves the import and marks the old activity `linked`. "Keep my note and effort" copies them (from the server's copy, never the client's) with `reported` provenance. |
| Retention | Raw bytes exist only in memory during a request. Kept per source: hash, sanitized filename, decoder version, provider ID (manufacturer, product, and creation time; never the serial number), and a summary in canonical units. GPS positions, altitude, cadence, sensor streams, TCX notes, and serial numbers are never read into the output. |
| Safety | Any DTD is rejected, which blocks external entities and entity expansion. Undeclared entities are errors. Limits: XML depth 64, element and FIT message caps, 5 s parse budget, 50 sessions per file, chained FIT files capped, CRCs verified. Filenames are sanitized, and errors never echo file contents. Cross-origin POSTs return 403. |

## Testing

`npm test` covers parsing, unit normalization, pause semantics, missing data, invalid and malicious files, time budgets, duplicate decisions (keep both, link, replace, stale and new candidates), tampered decisions, and every `ImportSaveResult` status. Duplicate decisions and save results run against an in-memory store that follows the contract (`src/lib/import/__tests__/fake-store.ts`).

Fixtures in `src/lib/import/__tests__/fixtures/` are **synthetic, Garmin-shaped files**, generated by `fixture-specs.ts` (a test fails if they drift: `UPDATE_FIXTURES=1 npx vitest run src/lib/import/__tests__/fixtures.test.ts`). The FIT fixtures were also decoded with Garmin's official `@garmin/fitsdk` 21.218 outside the project, and its CRC checks and values matched. That SDK can't read compressed timestamps, so `walk-compressed-timestamps.fit` is checked only by this decoder.

**Not yet validated against the user's own Garmin exports.** Before release (PRD MVP B gate), import one walking, one cycling, and one strength export in both formats, including a paused and a no-HR case, and compare each preview with Garmin Connect's summary.

## Known limitations

- Parsing runs in the request process with cooperative time and structure bounds, not in a separate worker with a hard memory limit.
- One file at a time. The file is uploaded twice (preview and confirm); typical Garmin files are well under 1 MB.
- A TCX file has no timezone. If the profile timezone gives the wrong day (travel), the user is told to add the workout manually; there is no free timezone picker.
- No pending-import or parse-error history (the PRD's `ImportJob`), because nothing is stored before confirmation.
- In sample mode, saving returns "not persisted", exactly as the contract's sample repository does.
