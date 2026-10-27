# Reminders and notifications

DayKind sends check-in reminders from the server. A scheduler calls the app every five minutes, and the app sends anything that has become due, by email or as a browser notification. Reminders do not depend on a DayKind tab being open.

## What is built

| Channel or feature | Status |
|---|---|
| Email reminders (Resend) | **Implemented.** Off until the user turns reminders on in Settings. |
| Browser notifications (Web Push with VAPID) | **Implemented.** The user chooses email *or* browser, and registers one browser. Desktop Chrome, Edge, Firefox, and Safari (macOS 13+), and Chrome or Firefox on Android. No app install needed. |
| Morning reminder at 10 AM and evening reminder at 9 PM, in the confirmed timezone | **Implemented** |
| One follow-up at 11 AM or 10 PM while the check-in is incomplete | **Implemented** (on by default, can be turned off) |
| Quiet hours (default 10:30 PM–8 AM; they skip follow-ups and never move them) | **Implemented** |
| Test notification (each channel) and recent delivery status in Settings | **Implemented** |
| In-app due cards on Today | **Implemented** (always shown, whatever the notification settings) |
| Monday weekly-report notice | **Planned.** It will come with stored weekly reports. |
| Snooze, adjustable times and follow-up delay | **Planned** |
| iPhone/iPad notifications | Not tested. iOS only allows web push for apps added to the Home Screen, and DayKind has no web app manifest yet. Use email on iOS. |

## How it works

```
Supabase pg_cron (every 5 min)
  └─ pg_net POST /api/reminders/dispatch   Authorization: Bearer $REMINDER_DISPATCH_SECRET
       └─ dispatcher (src/lib/reminders/dispatcher.ts)
            1. reminder_dispatch_users  → users with email on and a confirmed timezone
            2. dueSlots()               → 10:00, 11:00, 21:00, 22:00 local slots that are due
            3. reminder_plan            → one row per (user, kind, local date, stage); repeats are ignored
            4. reminder_claim           → final checks and an exclusive claim, in one transaction
            5. send on the user's channel:
                 email → Resend POST /emails, Idempotency-Key = occurrence id
                 push  → Web Push to the registered browser, Topic = occurrence id
            6. reminder_record          → sent | retry (2, 5, 10 min) | failed
```

- **Local wall-clock times.** Slots are computed from the local date and time in the profile's confirmed timezone, so 10 AM stays 10 AM across daylight saving changes.
- **Final checks before each send.** `reminder_claim` runs these checks in the transaction that claims the send:
  - email delivery is still on, and was on when the reminder was due;
  - that reminder and follow-ups are still enabled;
  - the timezone is still confirmed and unchanged;
  - the check-in is still incomplete (a draft does not count);
  - a follow-up is outside quiet hours;
  - the reminder is no more than two hours late (15 minutes for a test).

  - the user's channel can be sent by this server, and, for push, a browser is registered.

  A reminder that fails any check is closed with a reason, which Settings shows. A check-in completed on any device therefore cancels its pending follow-up.
- **Idempotency and concurrency.** These rules prevent duplicate sends:
  - The unique key `(user_id, kind, local_date, stage)` means each reminder and each follow-up exists at most once.
  - Claims use `FOR UPDATE SKIP LOCKED` and a five-minute lease, so overlapping runs never claim the same row.
  - If a run dies mid-send, its lease expires and a later run can claim the row again. The Resend idempotency key (valid for 24 hours) stops that from becoming a second email. For push, the Topic header makes the push service replace an undelivered earlier copy, and the notification tag makes the browser replace one already shown.
- **One channel, one browser:** the user picks email or browser notifications, so a reminder never arrives on both. Registering a browser replaces the previous one, so desktop and phone never both alert. A retry always uses the channel of its first attempt.
- **Retries:** a transient failure (429, 5xx, timeout, or network error from Resend or the push service) is retried after 2, 5, and then 10 minutes. That is at most three retries, and only within the two-hour window. A permanent failure (for example a bad sender or key) is not retried. When a push service answers 404 or 410, the browser has unsubscribed or its subscription expired: DayKind removes it, and Settings asks to register a browser again.
- **Timezone changes:** an already-used date/kind/stage key is never sent again. An unsent reminder that was never attempted is dropped and planned again in the new timezone. One that was already attempted is closed as "timezone changed", because the provider may have accepted it.
- **Outages:** a daily reminder more than two hours late is recorded as skipped. The Today due card is unaffected.

### Security

- **Endpoint:** `/api/reminders/dispatch` requires `Authorization: Bearer $REMINDER_DISPATCH_SECRET`, compared in constant time. Without full configuration it answers 503. The response contains only counts. The proxy does not redirect this path to sign-in.
- **Database access without a service-role key:** the dispatcher connects with the publishable key and no session. The five `reminder_*` functions are `SECURITY DEFINER`, and each first checks the dispatch key against a SHA-256 hash in `daykind_private.dispatch_keys`. They can only plan, claim, and record reminders and remove a push subscription the push service reported gone, and they return no health data.
- **Ownership:** row-level security lets users read and change only their own `reminder_settings` and read only their own `reminder_occurrences`. Nobody can write occurrences directly.
- **Content:** emails and notifications are generic: which check-in is open, its date, a link to that check-in, and (in email) a link to Settings. Links lead to pages that require sign-in and contain no login tokens. Push payloads are encrypted end to end (RFC 8291), so the push service (Google, Mozilla, Apple, or Microsoft) sees only ciphertext, plus the timing and the browser's endpoint. The service worker (`public/sw.js`) only shows notifications and opens DayKind links on its own site; it caches nothing. Logs record counts and provider error codes only.
- **Push subscriptions:** row-level security limits each user to their own one row. The browser's endpoint and keys are validated (HTTPS endpoint, base64url keys) before they are stored.
- **Secrets** live only in the host environment and in Supabase Vault. Never commit them or paste them into chat.

## Recommended setup

There is no deployment configuration in the repository yet, so this setup works on any host that runs `next start` at a public HTTPS URL, such as Vercel, Render, Fly.io, or a VPS.

| Need | Recommendation | Why |
|---|---|---|
| Scheduler | **Supabase pg_cron + pg_net** | Already part of the Supabase project, available on every plan, and reaches the five-minute dispatch target. Vercel Cron on the Hobby plan runs at most once a day, and GitHub Actions schedules are often delayed, so neither fits. |
| Email | **Resend** | A simple HTTP API with no SDK dependency, idempotency keys, and a free tier far above one user's ~60 emails a month. |
| Browser notifications | **Web Push with VAPID**, using the `web-push` library | Standard and free, with no third-party account. Works in the browsers above without installing the app. |

Any HTTPS scheduler that sends the bearer header works too. For example, Vercel Cron on a Pro plan can send `GET` with `Authorization: Bearer <CRON_SECRET>`; set `CRON_SECRET` to the same value as `REMINDER_DISPATCH_SECRET`.

## Setup steps

### 1 Resend

1. Create an account at <https://resend.com>.
2. Under **Domains**, add and verify a domain you control by adding the DNS records it shows. Until you do, Resend only lets you send from `onboarding@resend.dev` to your own account address, which is enough for a first test.
3. Under **API Keys**, create a key with **Sending access**, limited to that domain. Copy it once into your host's environment settings, not into a file in the repository.

### 1b Browser notifications (VAPID keys)

Generate a key pair once, on your own computer:

```bash
npx web-push generate-vapid-keys
```

The public key is sent to browsers when they subscribe. Keep the private key on the server only. If you replace the keys, every browser has to be registered again.

You can set up email, browser notifications, or both. Settings only lets the user choose a channel that is set up.

### 2 Dispatch secret

Generate a random secret and its SHA-256 hash on your own computer:

```bash
SECRET="$(openssl rand -base64 32 | tr -d '=+/')"   # ~43 characters
printf %s "$SECRET" | shasum -a 256 | cut -d' ' -f1    # the hash for step 3
```

Keep `$SECRET` for steps 4 and 5. The database stores only the hash.

### 3 Database

Apply `supabase/migrations/20261026120000_reminders.sql` with `supabase db push` or the SQL Editor (see [supabase-setup.md](supabase-setup.md)). Then register the hash:

```sql
insert into daykind_private.dispatch_keys (key_hash, note) values ('<hash from step 2>', 'production');
```

To rotate the secret, insert the new hash, update the app and Vault, then delete the old row.

### 4 App environment

Set these on the host, next to the Supabase variables, then rebuild and redeploy:

| Variable | Example | Purpose |
|---|---|---|
| `DAYKIND_APP_URL` | `https://daykind.example.com` | Base URL for links in emails |
| `REMINDER_DISPATCH_SECRET` | the secret from step 2 | Authorizes the scheduler and the dispatcher's database calls (at least 32 characters) |
| `RESEND_API_KEY` | `re_…` | Resend API key from step 1 |
| `REMINDER_EMAIL_FROM` | `DayKind <reminders@example.com>` | Sender on the verified domain |
| `VAPID_PUBLIC_KEY` | from step 1b | Browser notifications: the public key |
| `VAPID_PRIVATE_KEY` | from step 1b | Browser notifications: the private key. Server only. |
| `VAPID_SUBJECT` | `mailto:you@example.com` | Contact for push services (`mailto:` or `https:` URL) |

Reminders also need `DAYKIND_DATA_SOURCE=supabase`, `DAYKIND_APP_URL`, `REMINDER_DISPATCH_SECRET`, and at least one complete channel: both email variables, or all three VAPID variables. A channel that is only partly set is reported as missing. Until a channel is set up, Settings says so and its test button is disabled. Without any channel, the endpoint answers 503.

### 5 Scheduler (Supabase)

1. Under **Database → Extensions**, enable `pg_cron` and `pg_net`.
2. Under **Integrations → Vault** (or with `vault.create_secret`), add two secrets:
   - `daykind_dispatch_url`: `https://<your app>/api/reminders/dispatch`
   - `daykind_dispatch_secret`: the secret from step 2

   The Vault screen keeps the secret out of SQL history.
3. Schedule the job in the SQL Editor:

   ```sql
   select cron.schedule(
     'daykind-reminders',
     '*/5 * * * *',
     $$
     select net.http_post(
       url := (select decrypted_secret from vault.decrypted_secrets where name = 'daykind_dispatch_url'),
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'daykind_dispatch_secret')
       ),
       body := '{}'::jsonb,
       timeout_milliseconds := 30000
     );
     $$
   );
   ```

   To stop it: `select cron.unschedule('daykind-reminders');`

### 6 Verify

1. **Endpoint:** `curl -i -X POST https://<app>/api/reminders/dispatch` should return 401. With `-H "Authorization: Bearer $SECRET"` it should return JSON counts.
2. **Scheduler:** in the SQL Editor, check that the job runs and the app answers 200:

   ```sql
   select status, start_time from cron.job_run_details order by start_time desc limit 5;
   select status_code, created from net._http_response order by created desc limit 5;
   ```

3. **Email delivery:** sign in, open **Settings → Reminders and notifications**, and choose **Send a test email**. The message should say it was accepted, the email should arrive, and **Recent notifications** should show "Test notification · email · Accepted by the mail service".
4. **Browser delivery:** on the phone or computer that should get reminders, open the deployed app over HTTPS, go to Settings, and choose **Turn on notifications for this browser**. Allow notifications when the browser asks. Then:
   - Choose **Send a test browser notification**. A "DayKind test notification" should appear, and clicking it opens DayKind.
   - Close every DayKind tab on that device, then send another test from Settings on a different device. It should still appear.
   - On Android, if nothing appears, check **Settings → Apps → Chrome → Notifications** and battery saver.
5. **Real reminders:** turn on **Send me check-in reminders**, choose the channel, and save. Leave a check-in open past 10 AM or 9 PM, and a reminder should arrive within five minutes. Then complete the check-in before the follow-up time: Recent notifications should show the follow-up as "Not sent: the check-in was already done".

## Limitations

- **Delivered means accepted.** A "sent" reminder was accepted by Resend or the push service. It may still be delayed, filtered as spam, hidden by the device (focus modes, battery saver, notifications blocked), or never seen. Today always shows what's due.
- **Browser notifications depend on the browser.**
  - The browser must still be installed and allowed to notify. Desktop browsers must be running (Chrome and Edge can keep running in the background).
  - Clearing site data or revoking permission unsubscribes the browser. DayKind notices only at the next send, and then asks to register again.
  - iOS is not supported without Home Screen installation (see the table above).
- **One browser.** Registering a second browser replaces the first. There is no "send to all my devices".
- **Fixed times.** Reminders are at 10 AM and 9 PM, and follow-ups 60 minutes later. Times and the delay are not adjustable yet. Snooze is not built.
- **Quiet hours** apply to follow-ups only, as the PRD specifies. To silence a reminder itself, turn it off.
- **Turning email on** applies from that moment: a reminder already due that day is not sent, but a follow-up still to come is.
- **Dispatch timing** depends on pg_cron's five-minute cadence and on the host being up. A run that cannot reach the app is retried on the next tick.
- **Not verified end to end in CI.** The tests apply the real migrations to PGlite and use fake senders. The Web Push request itself (encryption, VAPID header, Topic, TTL) is built by the real library in a test. pg_cron, pg_net, Vault, Resend, real push services, and the service worker in a browser are exercised only by the manual checks above.
