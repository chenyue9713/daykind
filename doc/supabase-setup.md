# Supabase setup

These steps connect DayKind to a private Supabase project, with sign-in for one intended user. They need the Supabase dashboard; none of the values belong in git or in chat.

## 1 Create the project

1. Create a project at <https://supabase.com/dashboard>. Choose the region and a spending cap first (PRD Section 15, "Hosting and spending").
2. Under **Project Settings → API**, note the **Project URL** and the **publishable (anon) key**. The app does not use the service-role or secret key.

## 2 Apply the migrations

The migrations are in `supabase/migrations/` and must run in filename order:

| File | Creates |
|---|---|
| `20261020120000_access_and_profiles.sql` | `daykind_private` schema, allowlist, ownership helper, `profiles`, `goal_versions` |
| `20261020120100_check_ins.sql` | `symptom_entries`, `sleep_entries`, `evening_entries` |
| `20261020120200_activities.sql` | `activities`, `import_files`, `activity_sources`, plus link and cleanup triggers |
| `20261020120300_write_functions.sql` | Transactional write functions: `save_morning_check_in`, `save_evening_check_in`, `create_manual_activity`, `update_activity`, `import_confirmed_activities` |

Apply them in one of two ways:

- **Supabase CLI:** run `supabase link --project-ref <ref>`, then `supabase db push`.
- **Dashboard:** paste each file into **SQL Editor** and run them in order.

Every table has row-level security enabled. The `anon` role has no table access, and every policy requires both of these:

- `user_id = auth.uid()`
- membership in `daykind_private.allowed_users`

## 3 Lock down sign-in

1. Under **Authentication → Sign In / Providers**, turn **off** "Allow new users to sign up". DayKind has no registration page.
2. Keep the **Email** provider enabled with password sign-in. Leave "Confirm email" on.
3. Under **Authentication → Users**, choose **Add user → Create new user**. Enter the intended email and a strong password, and tick **Auto Confirm User**.
4. Copy the new user's **UID**, then run this in the SQL Editor:

   ```sql
   insert into daykind_private.allowed_users (user_id) values ('<the user UID>');
   ```

   An account missing from this table can sign in but cannot read or write any DayKind data.

5. Optional: under **Authentication → URL Configuration**, set the **Site URL** to the deployed app URL.

## 4 Configure the app

In `.env.local`, or in the host's environment settings, set:

```bash
DAYKIND_DATA_SOURCE=supabase
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY=<publishable key>
DAYKIND_ALLOWED_EMAILS=<the same email as above>
```

Then run `npm run build && npm start`, or `npm run dev`. Set these **before** building, because the sample-data banner is decided at build time.

The first visit redirects to `/sign-in`. After sign-in, DayKind creates the profile with the PRD defaults: timezone `America/Los_Angeles` (marked unconfirmed), miles, and pounds. It uses the default targets until custom targets are added.

## 5 Check that it works

In order:

1. Sign in on the desktop. Save a morning check-in.
2. Open the app on the phone and sign in. After a refresh, Today and History show the same entry.
3. Edit the entry on the phone, then try saving the older version still open on the desktop. The desktop shows "changed on another device" and keeps your answers.
4. In the SQL Editor, confirm that ownership is enforced:

   ```sql
   -- Should list RLS enabled on every DayKind table.
   select relname, relrowsecurity from pg_class
    where relnamespace = 'public'::regnamespace and relkind = 'r';
   ```

5. Sign in as an account that is not in `allowed_users`, if you create one for testing. It should see the "isn't allowed" message and no data.

## Notes

- **Backups:** Supabase's daily backups cover the PRD's 24-hour recovery point on paid plans. The free plan has no point-in-time recovery. Run a restore drill before relying on the pilot (PRD Section 9).
- **Deletion:** deleting the auth user cascades to all of their DayKind rows. Export and account deletion screens are later tasks.
- **Rate limits:** Supabase Auth rate-limits sign-in attempts. The sign-in form shows a message when that happens.
