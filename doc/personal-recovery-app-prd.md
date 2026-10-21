# Personal Sleep Exercise and Recovery App

Product requirements document • Version 0.2 • October 20, 2026 • For user review

## 1 Product recommendation

Build a private, responsive web app for one person that works in both computer and phone browsers that combines a short morning sleep check-in, an evening activity and symptom check-in, Garmin workout file uploads, and a Monday weekly report. Use simple, explainable rules to help choose between ordinary activity, a lighter day, and recovery. Make the core app useful without any external account connection.

The initial product should support consistent movement and gradual weight-loss habits while respecting disrupted nights, childcare, gout concerns, and ankle discomfort. Success means better-informed daily choices with little logging effort. Achieving every exercise target is secondary to safe, sustainable participation.

**Recommended MVP:** responsive desktop and phone web app with optional installation, managed authentication and database, scheduled check-in notifications and missed-check-in follow-ups, manual logging, TCX and FIT import, deterministic recovery guidance, weekly summaries, optional weight entry, and data export/deletion. Offer browser notifications where supported and enabled, with email as the reliable alternative delivery channel. Automated provider sync, conversational AI, detailed nutrition tracking, and native mobile apps follow later.

**Review requested:** confirm the proposed defaults in Section 15. All numeric product thresholds below are proposed design choices, not medically validated cutoffs or agreed delivery commitments.

## 2 Context and vision

The user wears a Garmin watch for workouts, but does not use it to track sleep. Sleep must therefore remain a first-class manual input. Nighttime baby care can reduce actual sleep and increase fatigue even when time in bed looks sufficient. Workouts may include walking, cycling, and resistance training. Ankle pain and gout concerns can change what feels appropriate on a given day.

The earlier conversation includes an example of 7.5–8 hours of sleep without interruptions and feeling energetic, as well as interrupted nights and short walks. These are examples, not a baseline, diagnosis, or permission to prepopulate actual records.

**Vision:** provide a reliable daily record and a calm weekly reflection that connects sleep, movement, and perceived recovery without pretending to measure medical readiness.

### Goals

- Complete a morning or evening check-in in roughly one minute.
- Keep manual observations and Garmin workouts together without double counting.
- Track the requested weekly targets: walking at least 10 minutes each day, two resistance sessions, and 60 cycling minutes.
- Make missed data visible and explain every suggestion in terms of recorded inputs.
- Support gradual weight-loss habits without calorie compensation or pressure to exercise through pain.

### Non goals for the MVP

Clinical diagnosis, gout treatment, medication advice, injury rehabilitation plans, sleep-stage estimation, continuous heart monitoring, emergency monitoring, food databases, calorie budgets, social features, coach accounts, and automated training-load prescriptions are outside scope. The app will not scrape Garmin accounts or ask for a Garmin password.

## 3 Personas and jobs to be done

| Persona | Context | Primary job | Product implication |
|---|---|---|---|
| Primary user and busy parent | Variable sleep from baby care; little time to log | Decide what is manageable today and record it quickly | Few required fields, drafts, neutral reminders, no punitive streaks |
| Same user managing recovery | Gout concerns, ankle discomfort, occasional fatigue | Adjust plans when symptoms or fatigue change | Symptoms override targets; explainable recovery guidance |
| Same user reviewing progress | Garmin workouts and interest in weight loss | Understand weekly consistency and longer trends | Import provenance, honest coverage, optional weight trend |

These are three modes of one intended user, not separate launch markets. No assumptions are made about age, weight, fitness level, medication, gout diagnosis, or medical clearance.

## 4 User journeys

### First use

Sign in to a private account → confirm timezone and units → review the three activity targets → choose reminder delivery → acknowledge guidance limitations → complete the first check-in. Garmin connection is never required. Explain that uploads require the user to obtain files; the app does not automatically access Garmin Connect.

### Morning at 10 AM

Open the reminder → choose the date of waking → enter actual sleep excluding awake baby-care time → record interruptions, restfulness, and morning fatigue → optionally update ankle symptoms → save → see a brief suggestion with its reasons. An example entry is “7 hours, 3 baby-related interruptions, somewhat rested, mildly tired.”

If current ankle status is unknown, the suggestion remains conditional and asks the user to confirm symptoms before activity. Yesterday's symptom entry is shown with its date, never described as current.

### Evening at 9 PM

Open today's review → inspect any imported activities → add a walk, ride, or resistance session, or explicitly mark no activity → record ankle pain and evening fatigue → save → see progress and a recovery-aware message. Allow multiple activities; do not make the user retype an imported ride. Activities after 9 PM can be added later.

### Garmin workout import

Select a TCX or FIT file → validate and parse → preview recognized activities, dates, duration, and available heart rate → resolve suspected duplicates → confirm → save canonical activities. Missing heart rate remains unknown. An unsupported file offers a manual-entry path without affecting existing data.

### Monday at 9 AM

Open a report covering the previous Monday through Sunday → review logging coverage, sleep and fatigue patterns, activity targets, symptoms, and optional weight trend → choose one manageable focus for the coming week. Late entries can update the report with a visible revised timestamp.

### A painful or unusually tiring day

Record symptoms or high fatigue → receive conservative guidance → mark an intentional recovery day if desired. The original target and actual progress remain visible; a recovery day does not silently count as a completed walk or failed personal commitment.

## 5 Scope and roadmap

| Stage | Included | Exit gate |
|---|---|---|
| MVP A daily loop | Authentication, settings, both check-ins, manual activities, targets, guidance, scheduled notifications and missed-check-in follow-ups, weekly report, weight, export/delete | Core calculation, privacy, and reminder acceptance criteria pass |
| MVP B upload completion | TCX and FIT parsing, preview, duplicate review, provenance, error handling | Representative user files import correctly; failed files leave no partial data |
| Later integration | Strava OAuth and authorized data ingestion; Garmin Activity API only if eligible and approved | Provider access, terms, scopes, deletion behavior, and duplicate handling validated |
| Later experience | Additional notification controls, offline entry queue, richer resistance logs, optional habit prompts and charts | Personal use demonstrates value and identifies actual friction |
| Optional expansion | Native app, additional health sources, clinician-reviewed guidance content | Separate scope, consent, and safety review |

The proposed MVP is complete only after both A and B. If FIT decoding takes longer, pilot A with manual entry while completing B; do not present the pilot as satisfying the full upload requirement. Do not attach a committed timeline until the build platform and sample files are known.

## 6 Functional requirements

Priority P0 means required for the MVP; P1 means a later enhancement.

### FR01 Account and preferences P0

Use a single private account with managed sign-in. Store an IANA timezone, initially America/Los_Angeles and explicitly confirmed at onboarding; preferred distance and weight units; reminder settings; and effective-dated targets. Permit skipping weight tracking. The app must not expose a public registration flow for other users during the personal pilot.

### FR01A Desktop and phone web experience P0

Provide the same account and core features in a computer browser and a phone browser, with layouts adapted to each screen. Support check-ins, file uploads, history, weekly reports, settings, export, and deletion on both. Installation must be optional for ordinary web use. Saved changes synchronize through the backend and appear on the other device after refresh or refetch; show unsaved or failed changes clearly. Do not require a native app. Test the actual desktop and phone browser combination selected by the user, including file selection and notification setup.

### FR02 Morning sleep check-in P0

One canonical sleep entry per waking date, editable later. Required to complete the check-in: actual sleep duration, interruption count or explicit unknown, baby-related interruption count or unknown, restfulness, and morning fatigue. Fields may be omitted in a draft. Duration accepts minutes, with hours/minutes controls and an optional approximate range; for 7.5–8 hours store 450–480 minutes and label derived averages as estimates. Do not subtract interruptions again from actual sleep. Time in bed and optional awake minutes are contextual fields, not required calculations.

Interruption counts are nonnegative integers; baby-related count cannot exceed total when both are known. Unknown differs from zero. Restfulness uses well rested / somewhat rested / poorly rested; fatigue uses energetic / mildly tired / very tired. Include an optional short note and symptom update. Manual sleep remains authoritative unless a future source is explicitly selected by the user.

### FR03 Activity and evening check-in P0

Activities have a type, date/start time, duration, source, optional distance, perceived intensity (easy/moderate/hard/unknown), average and maximum heart rate where available, and notes. Types include walking, cycling, resistance, and other. Indoor cycling counts as cycling. Each resistance entry represents one session, with an explicit session merge option for fragmented records.

Evening check-in requires a review of today's activity status (logged activity / confirmed none / unknown), ankle status, and evening fatigue. Ankle status includes pain 0–10 or unknown, optional side, and quick flags for new/worsening pain, swelling/redness/heat, and difficulty bearing weight. Ask about fever/feeling unwell when relevant to a joint-symptom warning. No symptom field is inferred from heart rate or exercise performance. Keep morning and evening fatigue separate.

Permit adding records outside check-in hours. Editing a check-in must not create a second copy of its activities. “No activity” conflicts with existing activity and requires correction or explicit confirmation that existing entries are being removed.

### FR04 Upload and normalization P0

Accept individual .tcx and .fit files up to a proposed 20 MB each. Validate actual content, not just extension; reject archives and unsupported content. Disable XML external entities, bound parsing memory/time, and isolate binary decoding. Treat filenames, metadata, and notes as untrusted text. A file can contain more than one session; show each session separately in the preview.

Extract source identifiers, sport/subsport, start time, elapsed/timer duration, distance, and available heart-rate summaries. Store durations in seconds and distances in meters. Use timer/active duration for goals when present, otherwise elapsed duration with a visible fallback label. Keep pause behavior visible. Never manufacture missing sensor values; preserve field provenance. Do not present an unweighted average of sparse heart-rate points as a reliable workout average. Prefer provided summaries or calculate from valid time-weighted samples with a coverage label.

Require confirmation of missing timezone or ambiguous sport/date. Exact file hashes block repeated imports for that user. Suspected matches across different files or manual records use type, start time (proposed ±2 minutes), and duration (proposed ±10 percent); show a review rather than silently merge. Permit keep both, replace, or link to an existing canonical activity. A linked manual record may retain subjective notes while the imported source supplies measured fields. Preview changes before replacement. One canonical activity contributes once to goals.

Discard GPS tracks, raw sensor streams, and unnecessary device identifiers after extracting permitted summaries. Delete raw files after successful confirmation or cancellation and within 24 hours for abandoned/failed uploads. Retain only a file hash, parse status, source metadata, and summary provenance. A future reparse requires re-upload. Report each failed session; use an atomic confirmed import so failures cannot leave hidden partial totals.

### FR05 Targets and progress P0

Default week is Monday 00:00 through the next Monday 00:00 in the configured timezone. Proposed walking rule: daily accumulated walking duration of at least 600 seconds qualifies; show qualified days out of seven and each day's minutes. It is not a weekly 70-minute substitute. Two five-minute walks qualify under this default; a single continuous ten-minute requirement remains a review decision.

Resistance target is two distinct completed sessions per week, regardless of duration in the MVP; duration is still recorded. No minimum was supplied, so do not invent one. Cycling target is 3,600 active seconds per week across rides. Other exercise does not substitute automatically. Explicit recovery days appear alongside targets but do not change denominators. Future target edits take effect next Monday by default and do not rewrite past reports.

Assign each workout to its local start date, including workouts crossing midnight; explain this rule in details. Sleep is assigned to waking date. Freeze historical record dates using the timezone captured when entered/imported; confirm date corrections separately after travel. Compare raw seconds to thresholds before rounding for display.

### FR06 Explainable recovery guidance P0

Use a versioned rules engine and a small library of reviewed text. Do not calculate a medical readiness score. Re-evaluate after check-in edits or a symptom change. Show input date/time and the specific reason for the suggestion. The strictest applicable rule wins:

1. **Joint symptom warning:** sudden joint pain and swelling with worsening pain, fever/shivering, or feeling sick triggers advice to seek urgent medical assessment; do not diagnose gout or infection. Disable exercise encouragement in this state. First-time suspected gout or symptoms not improving should prompt contacting a healthcare professional. Localize care wording without assuming a UK phone number.
2. **Recovery priority:** a self-reported flare, new/worsening ankle pain, difficulty bearing weight, or very tired fatigue suppresses strenuous activity and target catch-up prompts. Encourage rest from painful loading and following the user's existing care plan. A flare overrides an otherwise energetic morning.
3. **Lighter day:** poorly rested, actual sleep under a proposed six hours, mildly tired, or any reported ankle discomfort yields a lower-demand suggestion. A short easy walk is suggested only if the user reports that walking is comfortable; cycling is not automatically safe for a painful ankle. Stop an activity if symptoms worsen.
4. **Ordinary day:** adequate recorded sleep, well rested/energetic, and current symptom-free status permits the user's usual modest plan, such as the ten-minute walk or a planned resistance session. This is not medical clearance or an instruction to increase intensity.
5. **Incomplete data:** missing sleep, fatigue, or current symptoms produces an explicit limited-information message and a request to complete the record. Never show an unconditional all-clear. Symptom warning rules still apply when other data are missing.

For sleep ranges spanning a threshold, use the lower bound conservatively and show uncertainty. Six hours is a proposed product heuristic requiring review, not a clinical boundary. Restlessness and interruptions inform explanations; interruption count alone does not diagnose poor recovery. Repeated symptoms should prompt professional advice rather than repeated automated training adjustments. Heart rate is descriptive in MVP; do not infer personalized zones, arrhythmias, fitness, or gout from it.

### FR07 Schedules and delivery P0

Create reminder occurrences at 10 AM and 9 PM daily and a report occurrence Monday at 9 AM in the user's configured timezone. Use local civil time so daylight saving changes preserve those wall-clock times. Offer opt-in browser notifications on supported and enabled devices, plus generic email links as an alternative. Confirm notification capability and setup on the user's actual phone and desktop during the technical spike; explain any installation or browser permission steps in the interface. The report itself remains in-app. Let the user choose one primary notification device/channel to avoid duplicate desktop and phone alerts, test delivery, disable each reminder, change timezone, and view delivery status. In-app due cards remain available even if external notifications are disabled or fail. Never describe notifications as guaranteed to be seen.

Suppress the corresponding reminder if that day's check-in is already complete at dispatch; a draft does not suppress it. If a check-in is still incomplete 60 minutes after its scheduled time, send one follow-up: 11 AM for the morning check-in and 10 PM for the evening check-in by default. Recheck completion immediately before sending; completing it on either computer or phone cancels the pending follow-up across devices. A draft remains incomplete. Let the user enable or disable these follow-ups and adjust the delay and quiet hours; propose quiet hours of 10:30 PM to 8 AM. Skip a follow-up that falls in quiet hours rather than carrying it into the next morning. Limit proactive notifications to one initial reminder and one follow-up per check-in; transport retries must not create extra alerts. Proposed snooze is 30 or 60 minutes, initiated in the app; it replaces a pending follow-up rather than adding another one. Do not send follow-ups for a missed weekly report review in the MVP. Do not send missed daily reminders more than two hours late after an outage; still create the due card. Generate a delayed weekly report once service resumes, clearly timestamped. Use a unique user/type/local-date/stage occurrence key, where stage distinguishes initial reminder from follow-up. Retry transient delivery failures up to three times within the allowed window, and avoid duplicate sends. “Delivered” means accepted by the mail service, not read by the user or guaranteed inbox arrival.

Travel does not silently change timezone. Prompt for confirmation and rebuild future unsent occurrences without repeating already sent ones for the same local date/type/stage. Report generation is independent of whether its notification succeeds. These are product requirements; this PRD does not create real reminders or automations.

### FR08 Monday weekly report P0

Cover the completed prior week only. Include: morning and evening completion counts out of seven each; days with known activity status; average actual sleep across valid entries, sample count, estimated-range flag; baby interruption summary where known; restfulness and fatigue distributions; walking qualifying days; resistance session count; cycling minutes; pain trend and recovery days; optional weight observations; and one conservative focus for next week.

Show “not logged” separately from “confirmed no activity.” With missing activity days, show recorded totals as a lower bound and label target status incomplete where appropriate. A confirmed achieved target can remain achieved despite unrelated missing days. Do not claim causal relationships between sleep, childcare, pain, weight, and performance. Compare to a prior week only with both coverage counts visible. No automated training escalation based on one week.

Store report versions with input cutoff and rule version. Late edits mark the old report stale, recalculate it, and display revised status; do not send a second email automatically. A zero-data week still produces an honest empty report with an invitation to log.

### FR09 Weight-loss support P0

Offer optional dated weight entries with kg/lb conversion and a simple weekly mean where measurements exist, always showing sample count. Require at least two nonempty weekly windows before describing change; do not extrapolate a rate from sparse readings. No target weight is prefilled. Focus on movement consistency, sleep awareness, and optional user-chosen habits. Do not promise weight loss, infer calorie deficit from Garmin calories, prescribe rapid loss, or recommend crash diets. A food diary and personalized nutrition advice are later decisions.

### FR10 History and control P0

Provide a dated timeline, entry editing/deletion, report refresh, and download of normalized data as JSON plus readable CSV tables. Include units, provenance, null values, and schema version. Offer account deletion and reminder shutdown. Imported data deletion removes its contribution to reports; reports must recalculate or be removed accordingly. P1 adds offline drafts and provider disconnect controls when connectors exist.

## 7 Data model

All user-owned rows carry user_id, UUID, created_at, updated_at, and revision. Store UTC instants plus relevant IANA timezone and local date; use null for unknown and explicit enumerations for “none.” Enforce ownership in the database, not only in the interface.

| Entity | Main fields | Relationship and invariant |
|---|---|---|
| UserProfile | timezone, units, consent timestamps, reminder preferences | One profile per account; do not collect baby's identity |
| GoalVersion | effective_from, walking_seconds_per_day, resistance_sessions_per_week, cycling_seconds_per_week | Historical versions retained for past reports |
| SleepEntry | waking_date, timezone, duration_min_seconds, duration_max_seconds, approximate, total_interruptions, baby_interruptions, restfulness, morning_fatigue, note, completion_state | Unique user and waking_date; min equals max for point estimates |
| EveningEntry | local_date, activity_status, evening_fatigue, completion_state | Unique user and local_date; activities exist independently |
| SymptomEntry | observed_at, local_date, context, ankle_pain, side, flare_reported, worsening, swelling_heat_redness, weight_bearing_difficulty, fever_unwell | Many observations per day; retain timing and source check-in |
| Activity | type, started_at, local_date, timezone, elapsed_seconds, active_seconds, goal_seconds, duration_basis, distance_m, avg_hr_bpm, max_hr_bpm, intensity, note, canonical_status | Only canonical, nondeleted activities count toward totals |
| ActivitySource | activity_id, source_kind, provider_id, file_hash, imported_summary, field_provenance, decoder_version | Multiple sources may link to one activity; provider IDs unique per user/provider when present |
| ImportJob | hash, filename_sanitized, status, parse_errors, session_count, expires_at | References preview/confirmed sources; raw payload is temporary |
| WeightEntry | measured_at, local_date, weight_kg, entered_unit | Multiple observations allowed; exact duplicate submission guarded |
| GuidanceResult | input_revisions, rule_version, category, reasons, created_at | Recompute on relevant edits; not a clinical score |
| WeeklyReport | week_start, timezone, goal_version, coverage, aggregate_values, focus, revision, input_cutoff, stale | One logical report with versioned snapshots |
| ReminderOccurrence | type, local_date, scheduled_at, timezone, stage, delivery_target, status, attempts, provider_message_id | Include stage, parent_check_in_date, and chosen delivery target; unique occurrence key supports idempotency |
| Connection P1 | provider, granted_scopes, encrypted_token_ref, status, last_sync, revoked_at | Future connector only; credentials never in client storage |

Use database constraints for nonnegative durations/counts, plausible positive weights, pain range, and valid enums. Flag suspicious values for confirmation instead of silently correcting them. Validate heart-rate summaries and impossible dates; allow missing heart rate. Derived aggregates must be reproducible from source records and rule versions.

## 8 Key screens

| Screen | Required content | Primary action |
|---|---|---|
| Today | Due check-ins, today's recorded activity, current guidance with timestamps, target progress | Complete the next check-in |
| Morning | Sleep duration/range, interruptions including baby care, restfulness, fatigue, optional symptoms | Save sleep check-in |
| Evening | Existing workouts, quick-add activities, no-activity option, ankle symptoms, fatigue | Confirm today's record |
| Import review | Parsed sessions, source, duration basis, missing fields, duplicate candidates, errors | Confirm selected records |
| History and activity detail | Timeline, editable records, source labels and measured versus reported values | Edit or delete |
| Weekly report | Explicit date range, coverage, goals, trends, recovery context, one next step | Review and save focus |
| Weight | Optional entries and sample-aware weekly trend | Add measurement |
| Settings and data | Timezone, goals, delivery preferences, missed-check-in follow-ups, quiet hours, notification test, privacy, export/delete; future integration status | Change preferences |

Use large tap targets, visible labels, keyboard access, screen-reader names, and text alternatives to colors. Validate forms inline without erasing entries. Design for a one-handed phone interaction; avoid large free-text requirements. Display an empty state, loading state, validation state, and retry state for each data-dependent screen.

## 9 Architecture options

| Option | Advantages | Costs and limitations | Fit |
|---|---|---|---|
| Local-only web app with browser storage | Few services; health data stays on one device | Browser closure limits scheduling; storage loss and backups become user responsibilities | Prototype only if reminders are optional |
| Web app with managed backend | One interface for phone/desktop; reliable server jobs; simple normalized database and export | Requires secure hosting, authentication, email service, backups | Recommended MVP |
| Native mobile app with local notifications | Strong device integration and offline experience | More release work; sync and Garmin access still separate problems | Later if web limitations matter |

**Recommended implementation shape:** a TypeScript responsive desktop and phone web app/PWA with managed authentication and PostgreSQL (for example, a Next.js app with Supabase), plus server-side scheduler/worker and transactional email provider. This is an architecture proposal, not a claim that a specific host plan has the necessary scheduling guarantees or pricing. Confirm provider capabilities during a short technical spike.

Flow: authenticated forms or uploads → server validation → normalized database → shared aggregation/rules module → Today and reports. Scheduler → idempotent occurrence worker → report generation and/or email link. A separate bounded parser worker handles files; no large raw files go through an AI model. The browser is never responsible for running a Monday job while closed.

Use a single application codebase, relational tables, and a small job/outbox table. Avoid microservices, a vector database, streaming telemetry, or an LLM dependency for the MVP. Keep parser adapters separate from canonical data so future provider ingestion can reuse duplicate checks and aggregation.

### Nonfunctional requirements

- Target a check-in save response under two seconds at the 95th percentile under normal connectivity for the one-user workload; show save failure clearly and preserve the form.
- Target scheduled job dispatch within five minutes of due time when services are healthy. Track delays, failures, and suppression separately from inbox delivery.
- Support current phone and desktop browsers selected during kickoff; test the user's actual phone and file picker before launch.
- Online use is required for MVP saves; warn on lost connectivity and retain unsaved form state within the open session. Full offline persistence is P1.
- Back up daily with a proposed recovery point of 24 hours and recovery time of one business day; perform a restore drill before relying on the pilot.
- Maintain versioned migrations, secret-free logs, and tests for calendar math, import deduplication, rule precedence, and authorization.

## 10 Privacy and security

Treat sleep, symptoms, activity, and weight as sensitive personal data. Collect only necessary fields; baby-related interruption counts do not need names, ages, or other child information. Do not retain GPS routes by default. No public links, advertising trackers, data sales, model training, or third-party AI processing in the MVP.

Require TLS in transit and provider-managed encryption at rest. Enforce user ownership on every read/write and export, private upload buckets with short-lived access, strict file limits, server-side input validation, escaped output, rate limits, and session protections appropriate to the selected authentication system. Keep service credentials server-side. Restrict operational access and keep audit events free of health values and notes. Notifications contain generic text only.

Retain normalized records until the user deletes them. Proposed deletion SLA: remove live account data and pending jobs within 24 hours, then let encrypted backups expire within 30 days; show this distinction before deletion. Restore procedures must reapply deletion records so deleted data does not return. Configure provider retention to match these promises before launch. Export is available before deletion; confirmation is required only for destructive account deletion, with a clear result afterward.

Future sync requires explicit provider consent, minimum scopes, encrypted token storage, revocation, and provider-specific deletion handling. Provider terms may require removing both raw and derived data on disconnect; do not promise indefinite retention of synced records. Do not claim HIPAA compliance or medical-device status. Reassess legal obligations before expanding beyond a private personal tool.

## 11 Success metrics

Run a four-week personal pilot after acceptance checks. These are learning targets, not proof of health benefit. Use first-party operational counts; do not install analytics that capture health content.

| Metric | Definition | Proposed pilot target |
|---|---|---|
| Check-in adherence | Completed morning/evening slots divided by 56 scheduled slots over four weeks | At least 75 percent |
| Logging effort | Median time from opening form to saved completion, excluding idle sessions | At most 60 seconds per check-in |
| Weekly review use | Reports opened within 48 hours of availability | At least three of four |
| Usefulness | Weekly self-rating of “helped me choose a manageable day” | At least 4 out of 5 in three weeks |
| Import correctness | Representative supported files accepted with verified summaries; duplicates reviewed | All agreed fixture cases correct before launch |
| Dispatch reliability | Eligible reminders handed to delivery service within five minutes divided by eligible occurrences | At least 95 percent in pilot; no duplicate occurrence sends |
| Data integrity and privacy | Confirmed duplicate counting, lost saves reported as success, unauthorized access, or content in logs | Zero in release acceptance suite |

Track walking days, resistance sessions, cycling minutes, symptom days, and optional weight as user outcomes, not mandatory adoption goals. Do not set an MVP weight-loss quota, reward pain-day exertion, or infer medical improvement from engagement.

## 12 Dependencies and risks

| Risk or dependency | Impact | Mitigation or release gate |
|---|---|---|
| Garmin API eligibility and approval | Direct sync may be unavailable to a personal app | MVP uses manual entry/files; verify current program and terms before promising sync |
| Strava access and permitted uses | Scopes, quotas, and policies can constrain ingestion, storage, display, or derived use | Register app, validate intended use and deletion behavior; no sync commitment until reviewed |
| Garmin activity also arrives through Strava | Duplicate goals and distorted report | Canonical activity model with provenance and human review |
| TCX/FIT variation and pause semantics | Wrong dates, sports, heart rate, or counted minutes | Sample real exports, test both formats, show preview and duration basis |
| Email or scheduler outage | Missed check-ins or late reports | Due cards, retries, idempotency, delivery status, delayed report handling |
| Fatigue and symptom self-report are incomplete | Inappropriate confidence in guidance | Freshness labels, missing-data state, conservative precedence; no diagnostic score |
| Guidance mistaken for treatment | User may delay care or exercise through symptoms | Reviewed fixed wording, warning pathway, explicit care boundaries |
| Logging burden during childcare | Abandonment | One-minute forms, unknown options, quick add, easy corrections |
| Weight focus creates pressure | Unhelpful or unsafe behavior | Optional tracking, neutral language, no crash-diet or calorie compensation features |
| Travel, DST, and late edits | Wrong week totals or duplicated reminders | Stored timezones, fixed historical dates, versioned reports, calendar tests |
| Sensitive data exposure or lost storage | Privacy loss or lost history | Access controls, minimal retention, secure backups, export and restore drill |

No sample FIT/TCX files, provider credentials, verified platform preference, or clinician-approved recovery plan have been supplied. These are implementation inputs to obtain, not blockers to reviewing this PRD.

## 13 Acceptance criteria

| ID | Scenario and expected result |
|---|---|
| AC01 Manual sleep | Enter 7.5–8 hours, zero interruptions, well rested, energetic. Save one dated record with 450–480 minutes, zero distinct from unknown, and estimated reporting. Editing does not duplicate it. |
| AC02 Baby care | Enter seven actual sleep hours and three baby-related awakenings. Report seven hours, without subtracting awakenings again. Reject baby count greater than known total. |
| AC03 Evening completeness | Add a 15-minute walk, pain 0, mildly tired. Evening entry and one activity persist. Selecting no activity while that walk remains requires reconciliation. |
| AC04 Walking math | Two five-minute walks qualify under the proposed accumulated rule. A 70-minute Sunday walk qualifies Sunday only. A 599-second day does not round into completion. |
| AC05 Other targets | Two distinct resistance sessions and rides of 25 and 35 active minutes satisfy the requested weekly targets. Paused time is excluded when timer duration is available. |
| AC06 Week boundary | A Sunday 56-minute ride counts in the week ending that Sunday and is excluded from the next week's report. A cross-midnight ride uses local start date with a visible explanation. |
| AC07 Imports | Representative TCX and FIT sessions show correct sport, local date, duration basis, and available HR; a no-HR file displays unknown. Multi-session file preview accounts for every recognized session. |
| AC08 Duplicate prevention | Re-uploading an identical file makes no new activity. A manual entry followed by a similar import presents a match decision; linking preserves notes and counts the workout once. |
| AC09 Invalid upload | Corrupt FIT, malicious/oversized XML, unsupported content, and ambiguous timestamps produce actionable errors or review states. No partial hidden records or raw file retention beyond policy. |
| AC10 Rule precedence | Energetic plus reported flare returns recovery priority. Very tired suppresses strenuous suggestions. Symptom warning flags suppress exercise encouragement. Missing current symptoms never yield an unconditional all-clear. |
| AC11 Schedules | With the chosen notification channel enabled, dispatch 10 AM, 9 PM, and Monday 9 AM occurrences in the confirmed zone, including a DST transition test. Completed check-in suppresses its reminder; retries do not duplicate sends. |
| AC12 Outage and travel | A daily reminder over two hours late is skipped; the due card remains. Delayed report is generated once. Confirming a timezone change updates future jobs without repeating a sent date/type. |
| AC13 Incomplete week | With three valid sleep entries and two unreviewed activity days, report sleep n=3 and those activity days as unknown. No entry is converted to zero sleep or no activity. |
| AC14 Revision | Editing a previous week's ride marks the report stale and produces a revised report with changed totals and timestamp, without another automatic email. |
| AC15 Weight | Weight is optional. kg/lb conversion round-trips within display precision; a single sparse measurement is not presented as a rate of loss. |
| AC16 Ownership and deletion | An unauthenticated request and a different test user's ID cannot read/write entries or files. Export preserves units/nulls/provenance. Deletion disables reminders and follows live/backup retention policy. |
| AC17 Usability and failure | On the user's phone, both check-ins work with keyboard/screen-reader labels and large controls. A failed save remains visibly unsaved and preserves form contents. |
| AC18 Missed check-in | An incomplete morning entry triggers one 11 AM follow-up and an incomplete evening entry one 10 PM follow-up. Completing on either device before dispatch cancels it. Quiet hours, disabled follow-ups, snooze, and retries do not create extra alerts. |
| AC19 Desktop and phone | The same account supports all core screens on desktop and phone with readable layouts and no horizontal page overflow. A saved check-in appears on the other device after refetch and suppresses its pending reminder. Test notification permission, setup, delivery, denial, and email alternative on the selected devices. |

**Release gate:** all acceptance cases pass with representative exported files, reviewed safety wording, confirmed timezone/channel, configured retention, and a successful backup restore. Record failures explicitly; no provider-sync access is required to launch.

## 14 Delivery sequence

1. Confirm Section 15 defaults, target phone, and deployment preference. Obtain one walking, one cycling, and one resistance export where available, including both file formats and a paused/no-HR case.
2. Build the manual daily loop, canonical activity model, and target math. Review a working morning/evening flow with the user before expanding.
3. Add versioned rules, reports, scheduler, and notification states. Exercise timezone and missing-data scenarios.
4. Complete TCX/FIT preview, safe parsing, and reconciliation. Validate real files against their source summaries.
5. Verify access controls, export/delete, retention, restore, and all acceptance cases. Start the four-week pilot.
6. Review actual friction before choosing a connector or native app. Confirm provider access and current terms as a separate gate.

## 15 Open decisions for user review

| Decision | Recommended default | User response |
|---|---|---|
| Platform | Responsive computer and phone web app; optional installation | Confirmed requirement |
| Reminder channel | Browser notifications where supported/enabled; email alternative; one primary delivery target | Channel and device pending |
| Forgotten check-ins | One follow-up after 60 minutes; stop after completion on either device | Requirement confirmed; delay pending |
| Quiet hours | 10:30 PM to 8 AM; skip follow-ups within this window | Pending |
| Timezone and travel | America/Los_Angeles after confirmation; manual travel changes | Pending |
| Walking definition | Ten accumulated minutes each day | Pending |
| Resistance session definition | One user-confirmed session; no minimum duration | Pending |
| Recovery days and goals | Show separately; keep original goals unchanged | Pending |
| Morning pain freshness | Ask for current symptom confirmation before positive activity guidance | Pending |
| Sleep duration | Actual sleep excluding awake childcare; allow approximate ranges | Pending |
| Sleep heuristic | Six-hour lighter-day flag; review with personal care context | Pending |
| Weight support | Optional entries and weekly trend; no calorie targets | Pending |
| Import retention | Delete raw files after processing; summaries only | Pending |
| Goal edits | Apply next Monday unless explicitly backdated | Pending |
| First sync candidate | Evaluate Strava feasibility before Garmin direct sync; files remain supported | Pending |
| Medical constraints | User supplies existing clinician guidance and preferred wording before use | Pending |
| Hosting and spending | Managed backend; choose region and monthly spending cap before deployment | Pending |

**Approval record:** Scope approved by ______ on ______. Changes requested ______. Final platform, delivery channel, and reviewed recovery wording ______.

## 16 Evidence and integration notes

Official sources reviewed October 20, 2026. Recheck before implementation because eligibility, API behavior, and terms can change. Product thresholds and delivery targets in this PRD are proposals.

- [Garmin developer program FAQ](https://developer.garmin.com/gc-developer-program/program-faq/): describes business/enterprise eligibility and an approval process. Personal API access is not assumed; published integration estimates are not a commitment for this project.
- [Garmin developer program overview](https://developer.garmin.com/gc-developer-program/): identifies the Activity API as an integration route, subject to program access.
- [Strava authentication](https://developers.strava.com/docs/authentication/) and [rate limits](https://developers.strava.com/docs/rate-limits/): integration needs an application, user authorization, and quota-aware operation.
- [Strava API policy](https://www.strava.com/legal/api_policy): user consent, access/display restrictions, and deletion obligations require review before sync. Any later AI or sharing feature needs its own permitted-use assessment.
- [NHS gout guidance](https://www.nhs.uk/conditions/gout/): informs conservative wording on painful joints, urgent symptom combinations, avoiding pressure during attacks, and avoiding crash diets. The app does not replace diagnosis or a personal treatment plan; symptom logic requires clinical content review before release.
- [Referenced conversation](chatgpt-conversation://6ad1ab3d-d388-83e8-8234-f5ece9e52183): context for actual sleep excluding childcare wake time, evening review, and Monday-to-Sunday activity accounting. The user's current request is the authority for product scope.
