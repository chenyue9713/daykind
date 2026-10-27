-- DayKind: check-in reminders (PRD FR07).
-- Adds per-user reminder settings, persisted reminder occurrences, and the
-- functions the server-side dispatcher uses to plan, claim, and record sends.
--
-- Ownership: the signed-in user may read and change their own settings and
-- read their own occurrences. Occurrences are written only by the dispatcher
-- functions below, which require a dispatch key whose SHA-256 hash is stored
-- in daykind_private.dispatch_keys (see doc/reminders.md). No service-role key
-- is involved. Earlier migrations are not modified.

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------

-- One row per user, created on first save. Email delivery is off until the
-- user turns it on; email_enabled_at records when, so reminders scheduled
-- before that moment are never sent.
create table public.reminder_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique default auth.uid() references auth.users (id) on delete cascade,
  email_enabled boolean not null default false,
  email_enabled_at timestamptz,
  morning_enabled boolean not null default true,
  evening_enabled boolean not null default true,
  follow_ups_enabled boolean not null default true,
  quiet_hours_enabled boolean not null default true,
  quiet_start time not null default '22:30',
  quiet_end time not null default '08:00',
  last_request_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision >= 1),
  check (email_enabled = (email_enabled_at is not null)),
  check (quiet_start <> quiet_end),
  check (extract(second from quiet_start) = 0 and extract(second from quiet_end) = 0)
);

create trigger reminder_settings_touch before update on public.reminder_settings
  for each row execute function daykind_private.touch_row();

alter table public.reminder_settings enable row level security;
create policy reminder_settings_owner on public.reminder_settings for all to authenticated
  using (daykind_private.owns_row(user_id)) with check (daykind_private.owns_row(user_id));
revoke all on table public.reminder_settings from anon, public;
grant select, insert, update on table public.reminder_settings to authenticated;

-- ---------------------------------------------------------------------------
-- Occurrences
-- ---------------------------------------------------------------------------

-- One row per reminder that became due (or a test the user asked for).
-- (user_id, kind, local_date, stage) is unique for daily reminders, so a
-- reminder is planned once however many dispatcher runs overlap, and a
-- timezone change cannot repeat a date/kind/stage that already has a row.
--
-- status:  pending → sending → sent
--                  ↘ pending (transient failure, retried with backoff)
--          suppressed (check-in already complete), skipped (not eligible),
--          failed (provider refused it, retries ran out, or too late)
create table public.reminder_occurrences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('morning', 'evening', 'test')),
  -- The check-in date: the waking date for morning, the local date for evening.
  local_date date not null,
  stage text not null check (stage in ('initial', 'follow_up')),
  channel text not null default 'email' check (channel in ('email')),
  timezone text not null check (daykind_private.is_valid_timezone(timezone)),
  scheduled_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'suppressed', 'skipped', 'failed')),
  status_reason text check (status_reason in (
    'completed', 'delivery_off', 'reminder_off', 'follow_ups_off', 'quiet_hours', 'too_late',
    'timezone_changed', 'timezone_unconfirmed', 'no_address', 'retries_exhausted', 'provider_rejected'
  )),
  -- Delivery attempts made: the first send plus at most three retries.
  attempts smallint not null default 0 check (attempts between 0 and 4),
  next_attempt_at timestamptz not null,
  claim_token uuid,
  claimed_until timestamptz,
  provider_message_id text check (char_length(provider_message_id) <= 200),
  -- An error code from the provider or transport; never message content.
  last_error text check (char_length(last_error) <= 100),
  sent_at timestamptz,
  -- Idempotency key for test notifications requested from Settings.
  request_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision >= 1),
  check (kind <> 'test' or stage = 'initial'),
  check ((status = 'sending') = (claim_token is not null and claimed_until is not null)),
  check (status <> 'sent' or sent_at is not null)
);
create unique index reminder_occurrences_key
  on public.reminder_occurrences (user_id, kind, local_date, stage) where kind <> 'test';
create unique index reminder_occurrences_request
  on public.reminder_occurrences (user_id, request_id) where request_id is not null;
create index reminder_occurrences_due
  on public.reminder_occurrences (next_attempt_at) where status in ('pending', 'sending');
create index reminder_occurrences_user_recent
  on public.reminder_occurrences (user_id, scheduled_at desc);

create trigger reminder_occurrences_touch before update on public.reminder_occurrences
  for each row execute function daykind_private.touch_row();

-- The owner can see delivery status; nobody but the dispatcher functions writes.
alter table public.reminder_occurrences enable row level security;
create policy reminder_occurrences_owner_read on public.reminder_occurrences for select to authenticated
  using (daykind_private.owns_row(user_id));
revoke all on table public.reminder_occurrences from anon, public, authenticated;
grant select on table public.reminder_occurrences to authenticated;

-- ---------------------------------------------------------------------------
-- Settings writes
-- ---------------------------------------------------------------------------

-- Saves reminder settings. p: {request_id, expected_revision (null to create),
-- email_enabled, morning_enabled, evening_enabled, follow_ups_enabled,
-- quiet_hours_enabled, quiet_start "HH:MM", quiet_end "HH:MM"}.
-- Returns {status: saved | conflict | not_found | invalid, record?, reason?}.
create function public.save_reminder_settings(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_request uuid := (p ->> 'request_id')::uuid;
  v_expected integer := (p ->> 'expected_revision')::integer;
  v_email boolean := coalesce((p ->> 'email_enabled')::boolean, false);
  v_start time;
  v_end time;
  v_row public.reminder_settings;
  v_exists boolean;
begin
  if v_user is null or not daykind_private.is_allowed() then
    return jsonb_build_object('status', 'not_found', 'reason', 'Your account could not be found. Reload the page.');
  end if;
  begin
    v_start := (p ->> 'quiet_start')::time;
    v_end := (p ->> 'quiet_end')::time;
  exception when others then
    return jsonb_build_object('status', 'invalid', 'reason', 'Quiet hours need a start and an end time.');
  end;
  if v_start is null or v_end is null or v_start = v_end then
    return jsonb_build_object('status', 'invalid', 'reason', 'Quiet hours need different start and end times.');
  end if;

  select * into v_row from public.reminder_settings where user_id = v_user for update;
  v_exists := found;
  if v_exists and v_row.last_request_id = v_request then
    return jsonb_build_object('status', 'saved', 'record', to_jsonb(v_row));
  end if;
  if v_expected is distinct from (case when v_exists then v_row.revision end) then
    return jsonb_build_object('status', 'conflict', 'reason',
      'Your reminder settings were changed on another device. Reload to see the latest values.');
  end if;

  begin
    if not v_exists then
      insert into public.reminder_settings (
        email_enabled, email_enabled_at, morning_enabled, evening_enabled, follow_ups_enabled,
        quiet_hours_enabled, quiet_start, quiet_end, last_request_id
      ) values (
        v_email, case when v_email then now() end,
        coalesce((p ->> 'morning_enabled')::boolean, true),
        coalesce((p ->> 'evening_enabled')::boolean, true),
        coalesce((p ->> 'follow_ups_enabled')::boolean, true),
        coalesce((p ->> 'quiet_hours_enabled')::boolean, true),
        v_start, v_end, v_request
      )
      returning * into v_row;
    else
      update public.reminder_settings set
        email_enabled = v_email,
        -- Turning delivery on starts from now; earlier reminders are never sent.
        email_enabled_at = case
          when not v_email then null
          when email_enabled then email_enabled_at
          else now() end,
        morning_enabled = coalesce((p ->> 'morning_enabled')::boolean, true),
        evening_enabled = coalesce((p ->> 'evening_enabled')::boolean, true),
        follow_ups_enabled = coalesce((p ->> 'follow_ups_enabled')::boolean, true),
        quiet_hours_enabled = coalesce((p ->> 'quiet_hours_enabled')::boolean, true),
        quiet_start = v_start,
        quiet_end = v_end,
        last_request_id = v_request
      where id = v_row.id
      returning * into v_row;
    end if;
  exception when unique_violation then
    return jsonb_build_object('status', 'conflict', 'reason',
      'Your reminder settings were changed on another device. Reload to see the latest values.');
  end;
  return jsonb_build_object('status', 'saved', 'record', to_jsonb(v_row));
end;
$$;

-- A test notification from Settings, sent by the dispatcher straight away.
-- An explicit request, so it does not depend on email_enabled. At most five
-- per hour. p: {request_id}. Returns {status: saved | rate_limited | not_found, record?}.
create function public.request_test_reminder(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_request uuid := (p ->> 'request_id')::uuid;
  v_tz text;
  v_row public.reminder_occurrences;
begin
  if v_user is null or v_request is null or not daykind_private.is_allowed() then
    return jsonb_build_object('status', 'not_found', 'reason', 'Your account could not be found. Reload the page.');
  end if;
  select * into v_row from public.reminder_occurrences where user_id = v_user and request_id = v_request;
  if found then
    return jsonb_build_object('status', 'saved', 'record', to_jsonb(v_row));
  end if;
  if (select count(*) from public.reminder_occurrences
       where user_id = v_user and kind = 'test' and created_at > now() - interval '1 hour') >= 5 then
    return jsonb_build_object('status', 'rate_limited', 'reason',
      'You have sent five test notifications in the last hour. Try again later.');
  end if;
  v_tz := coalesce((select timezone from public.profiles where user_id = v_user), 'America/Los_Angeles');
  insert into public.reminder_occurrences (
    user_id, kind, local_date, stage, timezone, scheduled_at, next_attempt_at, request_id
  ) values (v_user, 'test', (now() at time zone v_tz)::date, 'initial', v_tz, now(), now(), v_request)
  returning * into v_row;
  return jsonb_build_object('status', 'saved', 'record', to_jsonb(v_row));
end;
$$;

revoke all on function public.save_reminder_settings(jsonb), public.request_test_reminder(jsonb) from public, anon;
grant execute on function public.save_reminder_settings(jsonb), public.request_test_reminder(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Dispatcher
-- ---------------------------------------------------------------------------

-- SHA-256 hashes (lowercase hex) of accepted dispatch keys. Only the hash is
-- stored; the key itself lives in the app host's environment and in Supabase
-- Vault for pg_cron. Add one with the SQL in doc/reminders.md.
create table daykind_private.dispatch_keys (
  key_hash text primary key check (key_hash ~ '^[0-9a-f]{64}$'),
  note text check (char_length(note) <= 80),
  created_at timestamptz not null default now()
);
revoke all on table daykind_private.dispatch_keys from public, anon, authenticated;

create function daykind_private.require_dispatch_key(p_key text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_key is null or char_length(p_key) < 32 or not exists (
    select 1 from daykind_private.dispatch_keys
     where key_hash = encode(sha256(convert_to(p_key, 'UTF8')), 'hex')
  ) then
    raise exception 'reminder dispatch key not accepted' using errcode = '42501';
  end if;
end;
$$;

-- True when `t` falls in the quiet window [start, end), which may cross midnight.
create function daykind_private.in_quiet_hours(t time, p_start time, p_end time)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case when p_start < p_end then t >= p_start and t < p_end
              else t >= p_start or t < p_end end;
$$;

revoke all on function
  daykind_private.require_dispatch_key(text),
  daykind_private.in_quiet_hours(time, time, time)
from public;

-- Users with email delivery on and a confirmed timezone, for planning.
-- Returns [{user_id, timezone, email_enabled_at, morning_enabled,
-- evening_enabled, follow_ups_enabled}]. No email addresses or health data.
create function public.reminder_dispatch_users(p_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform daykind_private.require_dispatch_key(p_key);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', s.user_id,
      'timezone', pr.timezone,
      'email_enabled_at', s.email_enabled_at,
      'morning_enabled', s.morning_enabled,
      'evening_enabled', s.evening_enabled,
      'follow_ups_enabled', s.follow_ups_enabled
    ) order by s.user_id)
    from public.reminder_settings s
    join public.profiles pr on pr.user_id = s.user_id
    join daykind_private.allowed_users a on a.user_id = s.user_id
    where s.email_enabled and pr.timezone_confirmed and pr.onboarding_completed_at is not null
  ), '[]'::jsonb);
end;
$$;

-- Records reminders that have become due. p_slots: [{user_id, kind, local_date,
-- stage, timezone, scheduled_at}]. A slot that already has a row is ignored,
-- whatever its status. Returns the number of new rows.
create function public.reminder_plan(p_key text, p_slots jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform daykind_private.require_dispatch_key(p_key);
  insert into public.reminder_occurrences (user_id, kind, local_date, stage, timezone, scheduled_at, next_attempt_at)
  select (s ->> 'user_id')::uuid, s ->> 'kind', (s ->> 'local_date')::date, s ->> 'stage', s ->> 'timezone',
         (s ->> 'scheduled_at')::timestamptz, (s ->> 'scheduled_at')::timestamptz
    from jsonb_array_elements(coalesce(p_slots, '[]'::jsonb)) s
   where s ->> 'kind' in ('morning', 'evening')
     and exists (select 1 from public.reminder_settings rs
                  where rs.user_id = (s ->> 'user_id')::uuid and rs.email_enabled)
  on conflict (user_id, kind, local_date, stage) where kind <> 'test' do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Claims due occurrences for sending. Every eligibility rule is checked here,
-- in the same transaction that claims the row, immediately before the send:
-- delivery and the reminder still enabled, the timezone unchanged, the
-- check-in still incomplete, follow-ups outside quiet hours, and no more than
-- two hours late (15 minutes for a test). Rows that fail a rule are closed
-- with a reason. Rows locked by a concurrent run are skipped, and a claimed
-- row is leased for five minutes; a lease that expired (the run died) can be
-- claimed again, and the provider idempotency key prevents a second email.
-- p_now defaults to the database clock. Returns [{id, claim_token, email,
-- kind, stage, local_date, attempt}].
create function public.reminder_claim(p_key text, p_now timestamptz default null, p_limit integer default 20, p_only uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  r public.reminder_occurrences;
  s public.reminder_settings;
  pr public.profiles;
  v_email text;
  v_status text;
  v_reason text;
  v_claim uuid;
  v_window interval;
  v_out jsonb := '[]'::jsonb;
begin
  perform daykind_private.require_dispatch_key(p_key);
  for r in
    select * from public.reminder_occurrences o
     where (p_only is null or o.id = p_only)
       and ((o.status = 'pending' and o.next_attempt_at <= v_now)
         or (o.status = 'sending' and o.claimed_until < v_now))
     order by o.scheduled_at, o.id
     limit greatest(1, least(coalesce(p_limit, 20), 50))
     for update skip locked
  loop
    v_status := null;
    v_reason := null;
    select * into s from public.reminder_settings where user_id = r.user_id;
    select * into pr from public.profiles where user_id = r.user_id;
    select email into v_email from auth.users where id = r.user_id;
    v_window := case when r.kind = 'test' then interval '15 minutes' else interval '2 hours' end;

    if not exists (select 1 from daykind_private.allowed_users where user_id = r.user_id) then
      v_status := 'skipped'; v_reason := 'delivery_off';
    elsif r.attempts >= 4 then
      v_status := 'failed'; v_reason := 'retries_exhausted';
    elsif r.kind <> 'test' then
      if s.user_id is null or not s.email_enabled or r.scheduled_at < s.email_enabled_at then
        v_status := 'skipped'; v_reason := 'delivery_off';
      elsif (r.kind = 'morning' and not s.morning_enabled) or (r.kind = 'evening' and not s.evening_enabled) then
        v_status := 'skipped'; v_reason := 'reminder_off';
      elsif r.stage = 'follow_up' and not s.follow_ups_enabled then
        v_status := 'skipped'; v_reason := 'follow_ups_off';
      elsif pr.user_id is null or not pr.timezone_confirmed then
        v_status := 'skipped'; v_reason := 'timezone_unconfirmed';
      elsif pr.timezone <> r.timezone then
        if r.attempts = 0 then
          -- Never attempted: drop it so the next run plans it in the new timezone if still due.
          delete from public.reminder_occurrences where id = r.id;
          continue;
        end if;
        v_status := 'skipped'; v_reason := 'timezone_changed';
      elsif (r.kind = 'morning' and exists (
               select 1 from public.sleep_entries e
                where e.user_id = r.user_id and e.waking_date = r.local_date and e.completion_state = 'complete'))
         or (r.kind = 'evening' and exists (
               select 1 from public.evening_entries e
                where e.user_id = r.user_id and e.local_date = r.local_date and e.completion_state = 'complete')) then
        v_status := 'suppressed'; v_reason := 'completed';
      elsif r.stage = 'follow_up' and s.quiet_hours_enabled
         and daykind_private.in_quiet_hours((r.scheduled_at at time zone r.timezone)::time, s.quiet_start, s.quiet_end) then
        v_status := 'skipped'; v_reason := 'quiet_hours';
      end if;
    end if;

    if v_status is null and v_now > r.scheduled_at + v_window then
      v_status := case when r.attempts = 0 then 'skipped' else 'failed' end;
      v_reason := 'too_late';
    end if;
    if v_status is null and (v_email is null or v_email = '') then
      v_status := 'failed'; v_reason := 'no_address';
    end if;

    if v_status is not null then
      update public.reminder_occurrences
         set status = v_status, status_reason = v_reason, claim_token = null, claimed_until = null
       where id = r.id;
      continue;
    end if;

    v_claim := gen_random_uuid();
    update public.reminder_occurrences
       set status = 'sending', status_reason = null, attempts = attempts + 1,
           claim_token = v_claim, claimed_until = v_now + interval '5 minutes'
     where id = r.id;
    v_out := v_out || jsonb_build_object(
      'id', r.id, 'claim_token', v_claim, 'email', v_email, 'kind', r.kind, 'stage', r.stage,
      'local_date', to_char(r.local_date, 'YYYY-MM-DD'), 'attempt', r.attempts + 1
    );
  end loop;
  return v_out;
end;
$$;

-- Records the result of one send. Only the run holding the claim can record
-- it. p_outcome: sent (p_detail = provider message id) | transient (retried
-- after 2, 5, then 10 minutes, at most three times and only within the
-- allowed lateness) | permanent. p_detail is an error code, never content.
-- Returns sent | retry | failed | stale.
create function public.reminder_record(
  p_key text, p_id uuid, p_claim uuid, p_outcome text, p_detail text default null, p_now timestamptz default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  r public.reminder_occurrences;
  v_backoff interval;
  v_window interval;
begin
  perform daykind_private.require_dispatch_key(p_key);
  select * into r from public.reminder_occurrences where id = p_id for update;
  if not found or r.status <> 'sending' or r.claim_token is distinct from p_claim then
    return 'stale';
  end if;

  if p_outcome = 'sent' then
    update public.reminder_occurrences
       set status = 'sent', status_reason = null, sent_at = v_now, provider_message_id = left(p_detail, 200),
           last_error = null, claim_token = null, claimed_until = null
     where id = r.id;
    return 'sent';
  end if;

  if p_outcome = 'transient' then
    v_backoff := case r.attempts when 1 then interval '2 minutes' when 2 then interval '5 minutes' else interval '10 minutes' end;
    v_window := case when r.kind = 'test' then interval '15 minutes' else interval '2 hours' end;
    if r.attempts < 4 and v_now + v_backoff <= r.scheduled_at + v_window then
      update public.reminder_occurrences
         set status = 'pending', next_attempt_at = v_now + v_backoff, last_error = left(p_detail, 100),
             claim_token = null, claimed_until = null
       where id = r.id;
      return 'retry';
    end if;
    update public.reminder_occurrences
       set status = 'failed',
           status_reason = case when r.attempts < 4 then 'too_late' else 'retries_exhausted' end,
           last_error = left(p_detail, 100), claim_token = null, claimed_until = null
     where id = r.id;
    return 'failed';
  end if;

  update public.reminder_occurrences
     set status = 'failed', status_reason = 'provider_rejected', last_error = left(p_detail, 100),
         claim_token = null, claimed_until = null
   where id = r.id;
  return 'failed';
end;
$$;

-- The dispatcher connects with the publishable key and no session (anon). The
-- dispatch key, checked first in each function, is what authorizes it.
revoke all on function
  public.reminder_dispatch_users(text),
  public.reminder_plan(text, jsonb),
  public.reminder_claim(text, timestamptz, integer, uuid),
  public.reminder_record(text, uuid, uuid, text, text, timestamptz)
from public;
grant execute on function
  public.reminder_dispatch_users(text),
  public.reminder_plan(text, jsonb),
  public.reminder_claim(text, timestamptz, integer, uuid),
  public.reminder_record(text, uuid, uuid, text, text, timestamptz)
to anon, authenticated;
