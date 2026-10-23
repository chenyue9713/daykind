-- DayKind: onboarding and editable preferences.
-- Adds onboarding state and idempotency keys to profiles, bounds and
-- idempotency keys to goal versions, a guard that keeps targets already in
-- effect unchanged, and the transactional save_preferences and
-- save_goal_version functions. Earlier migrations are not modified.

alter table public.profiles
  add column onboarding_completed_at timestamptz,
  add column last_request_id uuid,
  add constraint profiles_onboarding_requires_confirmation check (
    onboarding_completed_at is null
    or (timezone_confirmed and guidance_limits_acknowledged_at is not null)
  );

-- NOT VALID: enforced for every new or changed row without failing on rows
-- written before these bounds existed.
alter table public.goal_versions
  add column created_request_id uuid,
  add column last_request_id uuid,
  add constraint goal_versions_walking_bounds
    check (walking_seconds_per_day between 60 and 14400) not valid,
  add constraint goal_versions_resistance_bounds
    check (resistance_sessions_per_week between 0 and 14) not valid,
  add constraint goal_versions_cycling_bounds
    check (cycling_seconds_per_week between 0 and 72000) not valid;

-- The civil date "today" in the user's saved timezone.
create function daykind_private.local_today(p_user uuid)
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone coalesce(
    (select timezone from public.profiles where user_id = p_user),
    'America/Los_Angeles'
  ))::date;
$$;

-- The Monday after p_today (a Monday gives the following Monday).
create function daykind_private.next_monday(p_today date)
returns date
language sql
immutable
set search_path = ''
as $$
  select p_today + (8 - extract(isodow from p_today)::integer);
$$;

-- Targets that are already in effect belong to past or current weeks and
-- their reports, so the signed-in role may only add, edit, or remove versions
-- that start after today. The one exception is the baseline row holding the
-- PRD defaults, which save_goal_version records before the first change.
-- Other roles (operators, and cascades from deleting the account) are not
-- restricted.
create function daykind_private.guard_goal_versions()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_today date;
begin
  if current_user <> 'authenticated' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  v_today := daykind_private.local_today(case when tg_op = 'DELETE' then old.user_id else new.user_id end);

  if tg_op in ('UPDATE', 'DELETE') and old.effective_from <= v_today then
    raise exception 'Targets already in effect cannot be changed or removed. Save a new version instead.'
      using errcode = 'check_violation';
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.effective_from <= v_today and not (
    tg_op = 'INSERT'
    and new.effective_from = date '1970-01-05'
    and new.walking_seconds_per_day = 600
    and new.resistance_sessions_per_week = 2
    and new.cycling_seconds_per_week = 3600
  ) then
    raise exception 'New targets must start after today.' using errcode = 'check_violation';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger goal_versions_guard before insert or update or delete on public.goal_versions
  for each row execute function daykind_private.guard_goal_versions();

-- Saves new targets as the version starting next Monday, or edits the one
-- pending version in place. Called with the profile row locked, so writes for
-- one user are serialized. p_goal: {pending_id, expected_revision,
-- walking_seconds_per_day, resistance_sessions_per_week, cycling_seconds_per_week}.
-- Returns {status: saved | unchanged | conflict, record?, effective_from?}.
-- Values equal to the targets in effect remove a pending version instead.
create function daykind_private.apply_goal_change(p_today date, p_goal jsonb, p_request uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_next date := daykind_private.next_monday(p_today);
  v_pending_id uuid := (p_goal ->> 'pending_id')::uuid;
  v_expected integer := (p_goal ->> 'expected_revision')::integer;
  v_walking integer := (p_goal ->> 'walking_seconds_per_day')::integer;
  v_resistance integer := (p_goal ->> 'resistance_sessions_per_week')::integer;
  v_cycling integer := (p_goal ->> 'cycling_seconds_per_week')::integer;
  v_current public.goal_versions;
  v_pending public.goal_versions;
  v_row public.goal_versions;
  v_same boolean;
begin
  select * into v_row from public.goal_versions where user_id = v_user and last_request_id = p_request;
  if found then
    return jsonb_build_object('status', 'saved', 'record', to_jsonb(v_row), 'effective_from', v_row.effective_from);
  end if;

  select * into v_current from public.goal_versions
   where user_id = v_user and effective_from <= p_today
   order by effective_from desc limit 1;
  if found then
    v_same := (v_walking, v_resistance, v_cycling)
      = (v_current.walking_seconds_per_day, v_current.resistance_sessions_per_week, v_current.cycling_seconds_per_week);
  else
    v_same := (v_walking, v_resistance, v_cycling) = (600, 2, 3600);
  end if;

  select * into v_pending from public.goal_versions
   where user_id = v_user and effective_from > p_today
   order by effective_from limit 1
   for update;

  if found then
    if v_pending_id is distinct from v_pending.id or v_expected is distinct from v_pending.revision then
      return jsonb_build_object('status', 'conflict', 'reason',
        'The upcoming target change was edited on another device. Reload to see it.');
    end if;
    if v_same then
      delete from public.goal_versions where id = v_pending.id;
      return jsonb_build_object('status', 'saved', 'record', null, 'effective_from', null);
    end if;
    update public.goal_versions set
      effective_from = v_next,
      walking_seconds_per_day = v_walking,
      resistance_sessions_per_week = v_resistance,
      cycling_seconds_per_week = v_cycling,
      last_request_id = p_request
    where id = v_pending.id
    returning * into v_row;
    return jsonb_build_object('status', 'saved', 'record', to_jsonb(v_row), 'effective_from', v_row.effective_from);
  end if;

  if v_pending_id is not null then
    -- The form was editing a pending change that no longer exists.
    if v_same then
      return jsonb_build_object('status', 'saved', 'record', null, 'effective_from', null);
    end if;
    return jsonb_build_object('status', 'conflict', 'reason',
      'The upcoming target change was removed or took effect since this page loaded. Reload to see the current targets.');
  end if;

  if v_same then
    return jsonb_build_object('status', 'unchanged');
  end if;

  -- Record the defaults that applied so far, so they stay attached to past weeks.
  if not exists (select 1 from public.goal_versions where user_id = v_user) then
    insert into public.goal_versions (effective_from, walking_seconds_per_day, resistance_sessions_per_week, cycling_seconds_per_week)
    values (date '1970-01-05', 600, 2, 3600);
  end if;

  insert into public.goal_versions (
    effective_from, walking_seconds_per_day, resistance_sessions_per_week, cycling_seconds_per_week,
    created_request_id, last_request_id
  ) values (v_next, v_walking, v_resistance, v_cycling, p_request, p_request)
  returning * into v_row;
  return jsonb_build_object('status', 'saved', 'record', to_jsonb(v_row), 'effective_from', v_row.effective_from);
end;
$$;

-- Target change from Settings. Requires a confirmed timezone, because "next
-- Monday" is computed in it. p: {request_id, pending_id, expected_revision,
-- walking_seconds_per_day, resistance_sessions_per_week, cycling_seconds_per_week}.
create function public.save_goal_version(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_profile public.profiles;
begin
  select * into v_profile from public.profiles where user_id = (select auth.uid()) for update;
  if not found or not v_profile.timezone_confirmed then
    return jsonb_build_object('status', 'invalid', 'reason', 'Confirm your timezone before changing targets.');
  end if;
  return daykind_private.apply_goal_change(
    (now() at time zone v_profile.timezone)::date, p, (p ->> 'request_id')::uuid
  );
end;
$$;

-- Timezone, units, and weight tracking, plus (during onboarding) the guidance
-- acknowledgment and optional first targets, saved in one transaction.
-- p: {request_id, expected_revision, timezone, distance_unit, weight_unit,
--     weight_tracking_enabled, acknowledge_guidance?, complete_onboarding?, targets?}
-- Saving always confirms the timezone. Returns {status, record?, goal?}.
create function public.save_preferences(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_request uuid := (p ->> 'request_id')::uuid;
  v_expected integer := (p ->> 'expected_revision')::integer;
  v_timezone text := p ->> 'timezone';
  v_complete boolean := coalesce((p ->> 'complete_onboarding')::boolean, false);
  v_ack boolean := coalesce((p ->> 'acknowledge_guidance')::boolean, false);
  v_row public.profiles;
  v_goal jsonb := null;
begin
  select * into v_row from public.profiles where user_id = (select auth.uid()) for update;
  if not found then
    return jsonb_build_object('status', 'not_found', 'reason', 'Your profile could not be found. Reload the page.');
  end if;
  if v_row.last_request_id = v_request then
    return jsonb_build_object('status', 'saved', 'record', to_jsonb(v_row));
  end if;
  if v_expected is distinct from v_row.revision then
    return jsonb_build_object('status', 'conflict', 'reason',
      'Your preferences were changed on another device. Reload to see the latest values.');
  end if;
  if not daykind_private.is_valid_timezone(v_timezone) then
    return jsonb_build_object('status', 'invalid', 'reason', 'That timezone is not recognized.');
  end if;
  if v_complete and not v_ack and v_row.guidance_limits_acknowledged_at is null then
    return jsonb_build_object('status', 'invalid', 'reason', 'Acknowledge the guidance limits to finish setup.');
  end if;

  begin
    update public.profiles set
      timezone = v_timezone,
      timezone_confirmed = true,
      distance_unit = p ->> 'distance_unit',
      weight_unit = p ->> 'weight_unit',
      weight_tracking_enabled = (p ->> 'weight_tracking_enabled')::boolean,
      guidance_limits_acknowledged_at = case
        when v_ack then coalesce(guidance_limits_acknowledged_at, now())
        else guidance_limits_acknowledged_at end,
      onboarding_completed_at = case
        when v_complete then coalesce(onboarding_completed_at, now())
        else onboarding_completed_at end,
      last_request_id = v_request
    where id = v_row.id
    returning * into v_row;

    if p -> 'targets' is not null and jsonb_typeof(p -> 'targets') = 'object' then
      v_goal := daykind_private.apply_goal_change((now() at time zone v_timezone)::date, p -> 'targets', v_request);
      if v_goal ->> 'status' not in ('saved', 'unchanged') then
        -- Undo the profile update as well: nothing is saved unless everything is.
        raise exception using errcode = 'DK001', message = 'goal change not saved';
      end if;
    end if;
  exception when sqlstate 'DK001' then
    return v_goal;
  end;

  return jsonb_build_object('status', 'saved', 'record', to_jsonb(v_row), 'goal', v_goal);
end;
$$;

revoke all on function
  daykind_private.local_today(uuid),
  daykind_private.next_monday(date),
  daykind_private.guard_goal_versions(),
  daykind_private.apply_goal_change(date, jsonb, uuid)
from public;
grant execute on function
  daykind_private.local_today(uuid),
  daykind_private.next_monday(date),
  daykind_private.apply_goal_change(date, jsonb, uuid)
to authenticated;

revoke all on function public.save_preferences(jsonb), public.save_goal_version(jsonb) from public, anon;
grant execute on function public.save_preferences(jsonb), public.save_goal_version(jsonb) to authenticated;
