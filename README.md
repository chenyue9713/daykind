# DayKind

A private, responsive web app for one person that keeps sleep, activity, and ankle and recovery check-ins together, with explainable daily guidance and a weekly report. The product requirements are in [`doc/personal-recovery-app-prd.md`](doc/personal-recovery-app-prd.md).

> **Status: daily check-ins, workout import, editable preferences, and check-in reminders by email or browser notification, with private storage.** By default the app runs in **sample mode**, with clearly labeled, invented, read-only data and no sign-in. With `DAYKIND_DATA_SOURCE=supabase`, it signs in one intended user, walks them through first-use setup (timezone, units, targets, guidance limits), and stores check-ins, activities, ankle entries, preferences, and effective-dated targets in Supabase, with ownership enforced by row-level security. Setup: [`doc/supabase-setup.md`](doc/supabase-setup.md). Reminders (10 AM, 9 PM, one follow-up, quiet hours) are sent by a server-side scheduler, by email or as a browser notification, once they are configured and turned on: see [`doc/reminders.md`](doc/reminders.md). Weekly report storage is not built yet (see [What's not built yet](#whats-not-built-yet)).

## Local setup

Requirements: Node.js 22.13 or later on the 22 line, 24, or 26 and later (developed on Node 22), and npm. Node 20 and 25 are not supported: the test runner (Vitest 5) and lint tooling need these versions.

```bash
npm install
cp .env.example .env.local   # optional; the defaults use sample data
npm run dev
```

Open <http://localhost:3000>. To try the phone layout, narrow the browser window below 900 px or use your browser's device toolbar. To test on a real phone on the same Wi-Fi, run `npm run dev -- -H 0.0.0.0` and open the "Network" address shown in the terminal, using your computer's IP address (for example `http://192.168.1.20:3000`). On macOS, `ipconfig getifaddr en0` (or `en1`) prints the IP address. `next.config.ts` allows this computer's local network addresses in `allowedDevOrigins`, so the page keeps working on the phone. Only one dev server can run per project folder, so stop any other one first.

To preview a production build:

```bash
npm run build
npm start
```

### Environment variables

See [`.env.example`](.env.example). It contains no secrets.

| Variable | Default | Purpose |
|---|---|---|
| `DAYKIND_DATA_SOURCE` | `sample` | `sample` (read-only invented data, no sign-in) or `supabase` (sign-in and private storage). Set it before `npm run build`. |
| `DAYKIND_SAMPLE_TIMEZONE` | `America/Los_Angeles` | IANA timezone that decides "today" for the sample data. |
| `SUPABASE_URL` | — | Supabase project URL (Supabase mode). |
| `SUPABASE_PUBLISHABLE_KEY` | — | Supabase publishable (anon) key. App queries run as the signed-in user under row-level security; the reminder dispatcher uses this key without a session and is authorized only for its own functions by the dispatch key. The service-role key is never used. |
| `DAYKIND_ALLOWED_EMAILS` | — | Comma-separated emails allowed to use the app. The database allowlist is the enforcing control. |
| `DAYKIND_APP_URL` | — | Public base URL used for links in reminder emails. |
| `REMINDER_DISPATCH_SECRET` | — | Secret the scheduler sends to `/api/reminders/dispatch`; its SHA-256 hash is registered in the database. Server-only. |
| `RESEND_API_KEY` | — | Resend API key for reminder email. Server-only. |
| `REMINDER_EMAIL_FROM` | — | Sender for reminder email, on a domain verified with Resend. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | — | Browser notifications (Web Push). The private key is server-only; the public key is given to the browser when it subscribes. |

The reminder variables are optional. Reminders need `DAYKIND_APP_URL`, `REMINDER_DISPATCH_SECRET`, and at least one channel (both email variables, or all three VAPID variables); without them nothing is sent and Settings says so. See [`doc/reminders.md`](doc/reminders.md).

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the development server |
| `npm run build` | Build for production |
| `npm start` | Serve the production build |
| `npm run typecheck` | Generate route types, then type-check with `tsc` |
| `npm run lint` | Run ESLint |
| `npm test` | Run the unit tests and the database tests (Vitest). The database tests apply the real migrations to an in-process Postgres (PGlite), so they need no Supabase project. |
| `npm run check` | Run the type check, lint, and tests together |

GitHub Actions runs `npm run check` and the production build on every pull request to `main` and every push to `main`, with no secrets. See [`doc/ci.md`](doc/ci.md) for the jobs, how to reproduce a failure locally, and the check names to require before merging.

## Screens

| Route | Screen |
|---|---|
| `/sign-in` | **Sign in** (Supabase mode only): email and password for the one allowed account. There is no registration. |
| `/welcome` | **First-use setup** (Supabase mode, once): confirm the timezone (the device's timezone is offered as a suggestion only), distance units, optional weight tracking and its unit, review the three activity targets, and acknowledge the guidance limits. Every other screen redirects here until it is finished. In sample mode it is a read-only preview linked from Settings. |
| `/` | **Today**: check-ins due, the day's suggestion and why, today's activity, weekly target progress |
| `/check-in/morning[?date=]` | **Morning check-in**: actual sleep (exact or a range), interruptions including baby care, how rested and how tired you feel, optional ankle update |
| `/check-in/evening[?date=]` | **Evening check-in**: existing activities, quick add, a "no activity" option that warns when it conflicts with recorded activity, ankle status, fatigue, recovery day |
| `/history` | **History**: a 14-day timeline with source labels, edit and delete (disabled for sample data), and links to add a missed check-in |
| `/activities/new`, `/activities/edit?id=` | Add or edit an activity at any time. Imported activities keep their measured values. |
| `/symptoms/new`, `/symptoms/edit?id=` | Record or edit an ankle observation outside a check-in |
| `/report` | **Weekly report**: the last completed Monday–Sunday week, with coverage, sleep, target status, symptoms, optional weight, and one focus |
| `/import` | **Import a workout file**: Garmin TCX or FIT upload, preview, and duplicate review before saving. Reached from the evening check-in and Settings. |
| `/settings` | **Settings**: account and sign-out; edit the timezone, units, and weight tracking; see the targets in effect and any upcoming change, and edit or cancel that change; reminders (opt-in, email or browser notification, which reminders, follow-ups, quiet hours), registering this browser for notifications, a test per channel, and recent delivery status; workout import link; guidance limits. Export/delete are marked "Not available yet". |
| `/api/reminders/dispatch` | Scheduler endpoint (no page). Requires the dispatch secret as a bearer token. |

Phones get a bottom tab bar. Screens 900 px and wider get a sidebar.

## How the code is organized

```
src/
  app/                  Screens (Next.js App Router) and server actions
    check-in/actions.ts   Validates check-ins on the server, then calls the repository
  components/           Shared UI (navigation, guidance card, progress, primitives)
  proxy.ts              Refreshes the Supabase session cookie; sends signed-out visitors to /sign-in
  lib/
    domain/             Pure logic with no I/O: types, date math, targets, guidance rules,
                        check-in and activity validation, duplicate rule, weekly report. Unit tested.
    data/
      repository.ts       The DayKindRepository interface (incl. the shared ActivityStore contract)
      index.ts            getRepository(): picks the implementation from DAYKIND_DATA_SOURCE
      sample/             Generated, read-only sample data and its repository
      supabase/           Supabase repository, row/payload mapping, and database tests
    auth/session.ts     getCurrentUser(): verifies the Supabase session and the allowlist
    supabase/           Supabase client and configuration
    forms/              Shared server-action form handling (idempotency, save states)
    views/loaders.ts    Combines repository reads with domain logic into data for each screen
    reminders/          Reminder dispatcher, Resend email and Web Push senders, notification text, scheduler auth
public/sw.js            Service worker that shows reminder notifications (no caching)
supabase/migrations/    Versioned SQL: tables, constraints, row-level security, write functions
doc/activity-contract.md  Shared Activity contract used by the workout-import feature
```

Screens never touch a data source directly. They call loaders, which ask `getRepository()` for an instance tied to the current user.

### How saving works

- **Ownership:** row-level security in the database. Each row must belong to `auth.uid()`, and that user must be in `daykind_private.allowed_users`. The app verifies the session on every request and every server action. The proxy check is only a convenience.
- **One check-in per day:** `sleep_entries (user_id, waking_date)` and `evening_entries (user_id, local_date)` are unique. Creating a second one, for example from another device, returns a conflict instead of overwriting. Editing sends the revision being edited, and a stale revision is rejected.
- **No duplicate submissions:** every save attempt carries a request id. A retry after a dropped connection reuses it and gets the original result. Each quick-add activity has its own id, so it is never stored twice.
- **Transactions:** an evening check-in, with its new activities, its symptom, and any removals confirmed by "no activity", is saved by one database function. All checks run before any write.
- **Failures:** forms never reset. A failed or conflicting save says "Not saved" and keeps every answer on screen.
- **Unknown versus zero:** `null` means unknown, and explicit states use enumerations. For example, evening activity is `logged`, `confirmed_none`, or `unknown`.
- **Preferences:** the timezone, units, and weight tracking are saved by `save_preferences`, which always marks the timezone confirmed and rejects a stale profile revision. DayKind never changes the timezone by itself: when a device reports a different one, Today and the check-ins say so and link to Settings.
- **Targets:** a target change is stored as a `goal_versions` row starting **next Monday** in the confirmed timezone (`save_goal_version`). Editing the upcoming change updates that row in place; setting it back to the targets in effect removes it. The first change also stores the defaults as a baseline version, so earlier weeks keep them. A database trigger refuses any insert, edit, or delete of a version that is already in effect, so past weeks and reports keep their targets.
- **Dates:** "today" is computed in the profile timezone. Sleep belongs to the waking date, and an activity belongs to its local start date. Each record keeps the timezone it was entered in, and future dates are rejected.

### Next.js notes

This project uses Next.js 16 with **Cache Components** turned on, so data that depends on the current request has to be read inside a `<Suspense>` boundary. The sample repository calls `connection()` because it depends on today's date. Each screen streams its content behind a skeleton loading state. Next 16's own docs are in `node_modules/next/dist/docs/` (see `AGENTS.md`).

## What's not built yet

- **Still missing from preferences:** backdating a target change, saving the weekly focus, weight entry (the weight preference only controls whether and how weight is shown), and data export and account deletion.
- **Check-in drafts:** check-ins are saved complete only. Partial drafts and offline drafts are later work.
- **The Monday report notice, snooze, adjustable reminder times, and iPhone notifications** (iOS needs a Home Screen web app). Email and browser reminders are built; these are not. See [`doc/reminders.md`](doc/reminders.md#limitations).
- **Garmin Connect sync.** Workouts come from manual entry or uploaded TCX/FIT files (built on [`doc/activity-contract.md`](doc/activity-contract.md)). There is no provider sync.
- **Scheduled weekly reports.** The report is calculated each time the page opens. There are no stored, versioned, or stale/revised reports yet.
- **Guidance wording** is draft text (rule set `draft-2026-10-20.1`) that still needs review against the user's own care guidance. Sleep and target thresholds are the PRD's proposed defaults (Section 15), not confirmed decisions.
- Offline drafts and PWA installation. Devices stay in sync through the server: a saved change shows on another device after it refreshes. There is no live push.
