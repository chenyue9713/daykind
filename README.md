# DayKind

A private, responsive web app for one person that keeps sleep, activity, and ankle and recovery check-ins together, with explainable daily guidance and a weekly report. The product requirements are in [`doc/personal-recovery-app-prd.md`](doc/personal-recovery-app-prd.md).

> **Status: foundation for review.** Every screen shows **clearly labeled sample data** that was made up for this review. Nothing you enter is saved. Sign-in, database storage, notifications, and Garmin file import are not built yet (see [What's not built yet](#whats-not-built-yet)).

## Local setup

Requirements: Node.js 20.9 or later (developed on Node 22) and npm.

```bash
npm install
cp .env.example .env.local   # optional; the defaults already use sample data
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
| `DAYKIND_DATA_SOURCE` | `sample` | Data source. `sample` is the only one available. |
| `DAYKIND_SAMPLE_TIMEZONE` | `America/Los_Angeles` | IANA timezone that decides "today" for the sample data. |

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the development server |
| `npm run build` | Build for production |
| `npm start` | Serve the production build |
| `npm run typecheck` | Generate route types, then type-check with `tsc` |
| `npm run lint` | Run ESLint |
| `npm test` | Run the domain unit tests (Vitest) |
| `npm run check` | Run the type check, lint, and tests together |

## Screens

| Route | Screen |
|---|---|
| `/` | **Today**: check-ins due, the day's suggestion and why, today's activity, weekly target progress |
| `/check-in/morning` | **Morning check-in**: actual sleep (exact or a range), interruptions including baby care, how rested and how tired you feel, optional ankle update |
| `/check-in/evening` | **Evening check-in**: existing activities, quick add, a "no activity" option that warns when it conflicts with recorded activity, ankle status, fatigue, recovery day |
| `/history` | **History**: a 14-day timeline with source labels (edit and delete are shown but disabled) |
| `/report` | **Weekly report**: the last completed Monday–Sunday week, with coverage, sleep, target status, symptoms, optional weight, and one focus |
| `/settings` | **Settings**: timezone, units, and targets, plus reminders, Garmin import, and export/delete, all marked "Not available yet" |

Phones get a bottom tab bar. Screens 900 px and wider get a sidebar.

## How the code is organized

```
src/
  app/                  Screens (Next.js App Router) and server actions
    check-in/actions.ts   Validates check-ins on the server, then calls the repository
  components/           Shared UI (navigation, guidance card, progress, primitives)
  lib/
    domain/             Pure logic with no I/O: types, date math, targets, guidance rules,
                        check-in validation, weekly report. Unit tested.
    data/
      repository.ts       The DayKindRepository interface, the only data-access contract
      index.ts            getRepository(): picks the implementation from DAYKIND_DATA_SOURCE
      sample/             Generated, read-only sample data and its repository
    auth/session.ts     getCurrentUser(): placeholder until managed authentication exists
    views/loaders.ts    Combines repository reads with domain logic into data for each screen
```

Screens never touch a data source directly. They call loaders, which ask `getRepository()` for an instance tied to the current user. Adding storage means:

1. Implement `DayKindRepository` against the database (for example, Supabase/PostgreSQL), scoped to `userId`, with ownership enforced in the database.
2. Replace `getCurrentUser()` with the auth provider's session lookup, and redirect when there is no session.
3. Add a case to `getRepository()` and set `DAYKIND_DATA_SOURCE`.

The validation rules in `lib/domain/checkins.ts` and the save results (`saved` / `not_persisted` / `failed`) already match what the forms show.

### Next.js notes

This project uses Next.js 16 with **Cache Components** turned on, so data that depends on the current request has to be read inside a `<Suspense>` boundary. The sample repository calls `connection()` because it depends on today's date. Each screen streams its content behind a skeleton loading state. Next 16's own docs are in `node_modules/next/dist/docs/` (see `AGENTS.md`).

## What's not built yet

- **Authentication and storage.** There is no sign-in, every visitor sees the same sample data, and submitted check-ins are validated but not stored.
- **Editing and deleting** history entries, saving preferences, goal changes, saving the weekly focus, weight entry, and data export and account deletion.
- **Reminders and notifications** (10 AM, 9 PM, follow-ups, quiet hours, the Monday report notice). Settings says they are not available, and no reminders are sent.
- **Garmin TCX/FIT import.** The import button is disabled and labeled. Workouts can only be added by hand for now.
- **Scheduled weekly reports.** The report is calculated each time the page opens. There are no stored, versioned, or stale/revised reports yet.
- **Guidance wording** is draft text (rule set `draft-2026-10-20.1`) that still needs review against the user's own care guidance. Sleep and target thresholds are the PRD's proposed defaults (Section 15), not confirmed decisions.
- Offline drafts, PWA installation, and syncing between devices.
