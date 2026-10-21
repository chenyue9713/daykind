# Activity contract

Status: **v1, shared contract** between the check-ins feature (owns types, persistence, migrations, and authentication) and the workout-import feature (owns TCX/FIT parsing and the import preview). Source of truth in code:

| What | Where |
|---|---|
| Canonical types (`Activity`, `ActivitySource`, `FieldProvenanceMap`, enums) | `src/lib/domain/types.ts` |
| Writable shape, validation, goal duration, duplicate rule | `src/lib/domain/activity.ts` |
| Persistence interface (`ActivityStore`, `ConfirmedImport`, results) | `src/lib/data/repository.ts` |

Requirements come from the PRD: FR03 (activities), FR04 (upload and normalization), FR05 (targets and dates), Section 7 (data model).

## 1 Canonical activity

One `Activity` row is one real-world workout. It counts toward goals at most once, and only while `canonicalStatus` is `"canonical"`.

| Field | Type | Unit and meaning |
|---|---|---|
| `id`, `userId` | UUID | Owner is enforced by the database (row-level security), not by callers. |
| `createdAt`, `updatedAt` | ISO 8601 UTC instant | Set by the database. |
| `revision` | integer ≥ 1 | Incremented by the database on every update. Used for optimistic concurrency. |
| `source` | `"manual" \| "tcx" \| "fit" \| "sample"` | Source that created the activity. Per-field origin is in `fieldProvenance`. |
| `type` | `"walking" \| "cycling" \| "resistance" \| "other"` | Indoor cycling is `"cycling"`. One resistance entry is one session. |
| `startedAt` | UTC instant or `null` | `null` only for a manual entry without a start time. |
| `localDate` | `YYYY-MM-DD` | Local **start** date in `timezone`. A ride crossing midnight belongs to its start date. Must equal `localDateOf(startedAt, timezone)` when `startedAt` is set. |
| `timezone` | IANA name | Captured at entry or import and then frozen. Later timezone changes never move the record. |
| `elapsedSeconds` | integer seconds or `null` | Measured wall-clock duration, including pauses. |
| `activeSeconds` | integer seconds or `null` | Measured timer or moving duration, excluding pauses. |
| `reportedSeconds` | integer seconds or `null` | Duration typed by the user for a manual entry. |
| `durationBasis` | `"active" \| "elapsed" \| "reported"` | Names the field that counts toward goals. That field must be non-null and > 0. |
| `distanceMeters` | number ≥ 0 or `null` | Meters. Display units come from the profile. |
| `avgHeartRateBpm`, `maxHeartRateBpm` | integer 25–250 or `null` | Beats per minute. **Never manufactured.** Missing means unknown. |
| `intensity` | `"easy" \| "moderate" \| "hard" \| "unknown"` | Perceived effort. Imports use `"unknown"` unless the user sets it. |
| `note` | string ≤ 500 or `null` | Untrusted text. Escaped on output. |
| `canonicalStatus` | `"canonical" \| "linked"` | `"linked"` means it was replaced by `linkedActivityId` and is kept for history only. (`"deleted"` exists only in sample data.) |
| `linkedActivityId` | UUID or `null` | Set if and only if the status is `"linked"`. |
| `fieldProvenance` | `{ [field]: { source, kind } }` | `kind` is `"measured"` (device file), `"reported"` (typed by the user), or `"derived"` (for example, time-weighted heart rate from samples). |

### Duration rules

- Goal seconds are `goalSecondsOf(activity)`, the field named by `durationBasis`. Raw seconds are compared to thresholds before any display rounding.
- For imports, use `measuredDurationBasis(activeSeconds)`. It returns `"active"` when timer duration exists and `"elapsed"` otherwise. Screens label `"elapsed"` as a fallback. Keep both values when both exist, so pause behavior stays visible.
- Manual entries use `"reported"`, with `reportedSeconds = minutes × 60`. Elapsed and active stay `null`, because they were not measured.

### Duplicate rule

`isSuspectedDuplicate(probe, existing)` is true when all of these hold:

- Both activities are canonical and have the same `type`.
- Both starts are known and within **±120 s**. If either start is unknown, both must have the same `localDate`.
- Goal durations are within **±10 %** of the larger of the two.

A match triggers a review in the preview and **never merges silently**. These thresholds are proposed PRD values and exported as constants.

## 2 Activity sources and import files

| Table | Purpose and invariant |
|---|---|
| `activity_sources` | One row per origin attached to an activity: `source_kind`, `provider_id`, `file_hash`, `imported_summary` (jsonb, canonical units, no GPS or raw streams), `field_provenance`, `decoder_version`. `(user_id, source_kind, provider_id)` is unique when `provider_id` is set. Deleted with its activity. |
| `import_files` | One row per imported file: `(user_id, file_hash)` is unique. It blocks re-importing an identical file. It is removed automatically when its last source is deleted, so a file whose activities were all deleted can be imported again. |

Raw file storage, `ImportJob` status, parse errors, and the 24-hour cleanup belong to the import feature. If they need tables, add a migration in `supabase/migrations/` with a later timestamp, give every row `user_id uuid not null default auth.uid()`, and enable the same ownership policy (see `daykind_private.owns_row`). Coordinate before changing any table listed here.

## 3 Interface for the import feature

Server-only code gets a repository scoped to the signed-in user:

```ts
import { getRepository } from "@/lib/data";

const repo = await getRepository();          // throws/redirects when signed out
const { timezone } = await repo.getProfile(); // confirm or ask when a file lacks a zone
```

`DayKindRepository` extends `ActivityStore`. The import feature should use only these methods:

```ts
findImportedFile(sha256): Promise<ImportedFileRecord | null>   // exact re-upload → stop early
findDuplicateCandidates(probe: DuplicateProbe): Promise<Activity[]>  // per session, for the preview
getActivity(id): Promise<ActivityDetail | null>               // preview of link/replace targets
listActivities(range): Promise<Activity[]>
saveConfirmedImport(input: ConfirmedImport): Promise<ImportSaveResult>
```

### Saving a confirmed import

```ts
const result = await repo.saveConfirmedImport({
  requestId,                      // UUID created when the preview is shown; reuse it on retry
  file: { sha256, kind: "fit", filenameSanitized },
  sessions: [
    {
      draft: {                    // ActivityDraft — validated with validateActivityDraft()
        type: "cycling",
        startedAt: "2026-10-18T22:40:00.000Z",
        localDate: "2026-10-18",  // localDateOf(startedAt, timezone)
        timezone: "America/Los_Angeles",
        elapsedSeconds: 3480, activeSeconds: 3360, reportedSeconds: null,
        durationBasis: "active",
        distanceMeters: 21500, avgHeartRateBpm: 128, maxHeartRateBpm: null,
        intensity: "unknown", note: null,
        fieldProvenance: {
          startedAt: { source: "fit", kind: "measured" },
          activeSeconds: { source: "fit", kind: "measured" },
          avgHeartRateBpm: { source: "fit", kind: "measured" },
        },
      },
      source: { sourceKind: "fit", providerId: "…", importedSummary: { … }, decoderVersion: "fit-x.y" },
      resolution: { kind: "create" },   // or link/replace with { activityId, expectedRevision }
    },
  ],
});
```

Resolutions, all applied in **one database transaction** (the `import_confirmed_activities` function):

| `resolution.kind` | Effect | Goals |
|---|---|---|
| `create` (also "keep both") | New canonical activity plus its source. | Counts as new. |
| `link` | Attaches the source to the existing activity. Measured fields (`startedAt`, `elapsedSeconds`, `activeSeconds`, `distanceMeters`, heart rate, `durationBasis`) come from the import. The existing `note`, `intensity` (unless `"unknown"`), `reportedSeconds`, and type are kept. `revision` increases. | Still counts once. |
| `replace` | New canonical activity from the import. The existing one becomes `"linked"` to it. | Only the new one counts. |

Results:

| Status | Meaning | Data written |
|---|---|---|
| `saved` | `activityIds` are in session order. Repeating the same `requestId` returns the same result. | All sessions |
| `duplicate_file` | This hash was already imported and still has activities. | Nothing |
| `conflict` | A link or replace target changed (`expectedRevision`) or disappeared since the preview. Re-run the preview. | Nothing |
| `invalid` | A session failed `validateActivityDraft`. `sessionIndex` and field `errors` are included. | Nothing |
| `not_persisted` | Sample mode. | Nothing |
| `failed` | Unexpected error. Show it as unsaved and offer a retry. | Nothing |

Validation runs twice: in TypeScript before the call, and again by database constraints. Exact duplicates across files are also blocked by the unique `(user_id, source_kind, provider_id)` constraint, which returns `duplicate_file`.

## 4 Dates, timezones, and units

- `getToday()` is the civil date in the profile timezone (default `America/Los_Angeles`).
- Records store a UTC instant, the IANA timezone used, and the derived local date. Weeks run Monday 00:00 to the next Monday 00:00 in that timezone.
- Sleep belongs to the waking date. Activities belong to their local start date.
- Canonical units are seconds, meters, beats per minute, and kilograms. Unknown values are `null`. Explicit "none" states use enumerations, such as the evening `activityStatus: "confirmed_none"`.

## 5 Compatibility rules

- Additive changes, such as new optional fields, methods, or statuses, keep `v1` compatible. Callers must treat an unknown result `status` as not saved.
- Renaming or removing a field, changing a unit, or changing resolution semantics requires a new contract version, coordinated with the import feature first.
