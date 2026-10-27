# Continuous integration

The workflow is [`.github/workflows/ci.yml`](../.github/workflows/ci.yml). It runs on every pull request that targets `main` and on every push to `main`. It needs no secrets, production credentials, or Supabase project.

## Jobs

| Check name | What it runs | Environment |
|---|---|---|
| `Check (typecheck, lint, tests)` | `npm ci`, then `npm run check` (route type generation + `tsc`, ESLint, Vitest). Vitest includes the database tests, which apply `supabase/migrations` to an in-process Postgres (PGlite). | Node 22 |
| `Build (sample mode)` | `npm ci`, then `npm run build` | `DAYKIND_DATA_SOURCE=sample`, Supabase variables empty |
| `Build check (Supabase mode, fake config)` | `npm ci`, then `npm run build` | `DAYKIND_DATA_SOURCE=supabase` with fake values (see below) |

The Supabase-mode job is **only a build check**. Its URL (`http://127.0.0.1:54321`) and key (`ci-fake-publishable-key-not-a-secret`) are deliberately fake. Passing means the app compiles and prerenders with Supabase mode switched on. It does not show that sign-in, row-level security, or the hosted database work. Database behavior is covered by the PGlite tests in the first job, which use the real migrations but not a real Supabase project or Supabase Auth.

### Settings

- **Node.js:** `NODE_VERSION: "22"` at the top of the workflow, used by every job. Change it there only, and keep it within `package.json` `engines` (Node 20 and 25 cannot run the tests or lint tooling).
- **Dependencies:** `npm ci` from `package-lock.json`. `actions/setup-node` caches npm's download cache keyed on the lockfile. `node_modules` is not cached.
- **Permissions:** the token is read-only (`contents: read`), and checkout does not keep credentials.
- **Events:** ordinary `pull_request`, not `pull_request_target`, so code from a pull request never runs with write access or secrets.
- **Timeouts:** 15 minutes per job.
- **Concurrency:** a new push to a pull request cancels that pull request's older run. Runs on `main` are not cancelled.
- **Actions** are pinned to full commit SHAs, with the release tag in a comment.

## Reproducing a failure locally

Use Node 22 (`node -v`), then from the repository root:

```bash
npm ci
npm run check            # same as the Check job

# Build (sample mode). Make sure .env.local does not switch to Supabase mode.
DAYKIND_DATA_SOURCE=sample SUPABASE_URL= SUPABASE_PUBLISHABLE_KEY= npm run build

# Build check (Supabase mode, fake config)
DAYKIND_DATA_SOURCE=supabase \
SUPABASE_URL=http://127.0.0.1:54321 \
SUPABASE_PUBLISHABLE_KEY=ci-fake-publishable-key-not-a-secret \
DAYKIND_ALLOWED_EMAILS=ci@example.invalid \
npm run build
```

Next.js loads `.env.local` too, but variables set on the command line take precedence. To narrow down a failing check, run the parts on their own: `npm run typecheck`, `npm run lint`, `npm test`, or a single test file with `npx vitest run path/to/file.test.ts`.

## Requiring checks before merging

Branch protection is not configured by this workflow. To require the checks, add these names under **Settings → Branches** (or a ruleset) for `main`, after they have run at least once:

- `Check (typecheck, lint, tests)`
- `Build (sample mode)`
- `Build check (Supabase mode, fake config)`

Renaming a job changes its check name, so update the rule if a job is renamed.
