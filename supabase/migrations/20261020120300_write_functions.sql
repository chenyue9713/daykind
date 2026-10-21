-- DayKind: transactional writes. Every function is SECURITY INVOKER, so the
-- caller's row-level security applies to each statement. Each returns jsonb
-- {status, ...} where status is saved | conflict | not_found | invalid |
-- duplicate_file. Checks run before any write, so a non-saved result never
-- leaves partial data. A repeated request_id returns the original result.

create function daykind_private.insert_activity(p_draft jsonb, p_source text, p_request uuid)
returns public.activities
language plpgsql
set search_path = ''
as $$
declare
  v public.activities;
begin
  insert into public.activities (
    source, type, started_at, local_date, timezone,
    elapsed_seconds, active_seconds, reported_seconds, duration_basis,
    distance_meters, avg_heart_rate_bpm, max_heart_rate_bpm, intensity, note,
    field_provenance, created_request_id, last_request_id
  ) values (
    p_source,
    p_draft ->> 'type',
    (p_draft ->> 'started_at')::timestamptz,
    (p_draft ->> 'local_date')::date,
    p_draft ->> 'timezone',
    (p_draft ->> 'elapsed_seconds')::integer,
    (p_draft ->> 'active_seconds')::integer,
    (p_draft ->> 'reported_seconds')::integer,
    p_draft ->> 'duration_basis',
    (p_draft ->> 'distance_meters')::numeric,
    (p_draft ->> 'avg_heart_rate_bpm')::smallint,
    (p_draft ->> 'max_heart_rate_bpm')::smallint,
    coalesce(p_draft ->> 'intensity', 'unknown'),
    p_draft ->> 'note',
    coalesce(p_draft -> 'field_provenance', '{}'::jsonb),
    p_request,
    p_request
  )
  returning * into v;
  return v;
end;
$$;

create function daykind_private.insert_manual_activity(p_draft jsonb, p_request uuid)
returns public.activities
language plpgsql
set search_path = ''
as $$
declare
  v public.activities;
begin
  v := daykind_private.insert_activity(p_draft, 'manual', p_request);
  insert into public.activity_sources (activity_id, source_kind, field_provenance)
  values (v.id, 'manual', v.field_provenance);
  return v;
end;
$$;

-- Updates the check-in's own symptom observation, or records a new one, so
-- editing a check-in never creates a second copy.
create function daykind_private.upsert_check_in_symptom(
  p_id uuid, p_symptom jsonb, p_context text, p_date date, p_timezone text, p_request uuid
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_id is not null then
    update public.symptom_entries set
      ankle_pain = (p_symptom ->> 'ankle_pain')::smallint,
      side = p_symptom ->> 'side',
      flare_reported = coalesce((p_symptom ->> 'flare_reported')::boolean, false),
      new_or_worsening = coalesce((p_symptom ->> 'new_or_worsening')::boolean, false),
      swelling_heat_redness = coalesce((p_symptom ->> 'swelling_heat_redness')::boolean, false),
      weight_bearing_difficulty = coalesce((p_symptom ->> 'weight_bearing_difficulty')::boolean, false),
      fever_or_unwell = (p_symptom ->> 'fever_or_unwell')::boolean,
      last_request_id = p_request
    where id = p_id
    returning id into v_id;
    if found then
      return v_id;
    end if;
  end if;

  insert into public.symptom_entries (
    observed_at, local_date, timezone, context, ankle_pain, side, flare_reported,
    new_or_worsening, swelling_heat_redness, weight_bearing_difficulty, fever_or_unwell,
    created_request_id, last_request_id
  ) values (
    now(), p_date, p_timezone, p_context,
    (p_symptom ->> 'ankle_pain')::smallint,
    p_symptom ->> 'side',
    coalesce((p_symptom ->> 'flare_reported')::boolean, false),
    coalesce((p_symptom ->> 'new_or_worsening')::boolean, false),
    coalesce((p_symptom ->> 'swelling_heat_redness')::boolean, false),
    coalesce((p_symptom ->> 'weight_bearing_difficulty')::boolean, false),
    (p_symptom ->> 'fever_or_unwell')::boolean,
    p_request, p_request
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- Morning check-in. p: {request_id, expected_revision, id?, waking_date,
-- timezone, duration_min_seconds, duration_max_seconds, approximate,
-- total_interruptions, baby_interruptions, restfulness, morning_fatigue, note, symptom?}
create function public.save_morning_check_in(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_request uuid := (p ->> 'request_id')::uuid;
  v_expected integer := (p ->> 'expected_revision')::integer;
  v_id uuid := (p ->> 'id')::uuid;
  v_date date := (p ->> 'waking_date')::date;
  v_row public.sleep_entries;
  v_exists boolean;
  v_symptom_id uuid;
begin
  if v_id is not null then
    select * into v_row from public.sleep_entries where id = v_id for update;
  else
    select * into v_row from public.sleep_entries
     where user_id = (select auth.uid()) and waking_date = v_date for update;
  end if;
  v_exists := found;

  if v_exists and v_row.last_request_id = v_request then
    return jsonb_build_object('status', 'saved', 'record', to_jsonb(v_row));
  elsif v_expected is null and v_exists then
    return jsonb_build_object('status', 'conflict', 'reason',
      'A sleep check-in for this date already exists, possibly saved on another device. Reload to edit it.');
  elsif v_expected is not null and not v_exists then
    return jsonb_build_object('status', 'not_found', 'reason',
      'This sleep check-in no longer exists. It may have been deleted on another device.');
  elsif v_exists and v_row.revision <> v_expected then
    return jsonb_build_object('status', 'conflict', 'reason',
      'This sleep check-in was changed on another device. Reload to see the latest version.');
  end if;

  v_symptom_id := v_row.symptom_entry_id;
  if jsonb_typeof(p -> 'symptom') = 'object' then
    v_symptom_id := daykind_private.upsert_check_in_symptom(
      v_symptom_id, p -> 'symptom', 'morning', v_date, coalesce(v_row.timezone, p ->> 'timezone'), v_request);
  end if;

  if v_exists then
    update public.sleep_entries set
      waking_date = v_date,
      duration_min_seconds = (p ->> 'duration_min_seconds')::integer,
      duration_max_seconds = (p ->> 'duration_max_seconds')::integer,
      approximate = (p ->> 'approximate')::boolean,
      total_interruptions = (p ->> 'total_interruptions')::integer,
      baby_interruptions = (p ->> 'baby_interruptions')::integer,
      restfulness = p ->> 'restfulness',
      morning_fatigue = p ->> 'morning_fatigue',
      note = p ->> 'note',
      completion_state = 'complete',
      symptom_entry_id = v_symptom_id,
      last_request_id = v_request
    where id = v_row.id
    returning * into v_row;
  else
    insert into public.sleep_entries (
      waking_date, timezone, duration_min_seconds, duration_max_seconds, approximate,
      total_interruptions, baby_interruptions, restfulness, morning_fatigue, note,
      completion_state, symptom_entry_id, last_request_id
    ) values (
      v_date, p ->> 'timezone',
      (p ->> 'duration_min_seconds')::integer, (p ->> 'duration_max_seconds')::integer,
      (p ->> 'approximate')::boolean,
      (p ->> 'total_interruptions')::integer, (p ->> 'baby_interruptions')::integer,
      p ->> 'restfulness', p ->> 'morning_fatigue', p ->> 'note',
      'complete', v_symptom_id, v_request
    )
    returning * into v_row;
  end if;

  return jsonb_build_object('status', 'saved', 'record', to_jsonb(v_row));
exception when unique_violation then
  -- A concurrent save for the same date won. Same request: report its result.
  select * into v_row from public.sleep_entries
   where user_id = (select auth.uid()) and waking_date = v_date;
  if found and v_row.last_request_id = v_request then
    return jsonb_build_object('status', 'saved', 'record', to_jsonb(v_row));
  end if;
  return jsonb_build_object('status', 'conflict', 'reason',
    'A sleep check-in for this date already exists, possibly saved on another device. Reload to edit it.');
end;
$$;

-- Evening check-in with its new manual activities and symptom observation.
-- p: {request_id, expected_revision, id?, local_date, timezone, activity_status,
-- evening_fatigue, recovery_day, symptom, new_activities: [{request_id, draft}],
-- remove_activity_ids: [uuid]} — remove_activity_ids are the activities the user
-- saw and confirmed removing when choosing "no activity".
create function public.save_evening_check_in(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_request uuid := (p ->> 'request_id')::uuid;
  v_expected integer := (p ->> 'expected_revision')::integer;
  v_id uuid := (p ->> 'id')::uuid;
  v_date date := (p ->> 'local_date')::date;
  v_status text := p ->> 'activity_status';
  v_new jsonb := coalesce(p -> 'new_activities', '[]'::jsonb);
  v_remove uuid[] := array(select jsonb_array_elements_text(coalesce(p -> 'remove_activity_ids', '[]'::jsonb))::uuid);
  v_row public.evening_entries;
  v_exists boolean;
  v_symptom_id uuid;
  v_item jsonb;
  v_unseen integer;
  v_existing integer;
begin
  if v_id is not null then
    select * into v_row from public.evening_entries where id = v_id for update;
  else
    select * into v_row from public.evening_entries
     where user_id = (select auth.uid()) and local_date = v_date for update;
  end if;
  v_exists := found;

  if v_exists and v_row.last_request_id = v_request then
    return jsonb_build_object('status', 'saved', 'record', to_jsonb(v_row));
  elsif v_expected is null and v_exists then
    return jsonb_build_object('status', 'conflict', 'reason',
      'An evening check-in for this date already exists, possibly saved on another device. Reload to edit it.');
  elsif v_expected is not null and not v_exists then
    return jsonb_build_object('status', 'not_found', 'reason',
      'This evening check-in no longer exists. It may have been deleted on another device.');
  elsif v_exists and v_row.revision <> v_expected then
    return jsonb_build_object('status', 'conflict', 'reason',
      'This evening check-in was changed on another device. Reload to see the latest version.');
  end if;

  select count(*) filter (where not (a.id = any (v_remove))), count(*)
    into v_unseen, v_existing
    from public.activities a
   where a.user_id = (select auth.uid()) and a.local_date = v_date and a.canonical_status = 'canonical';

  if v_status = 'confirmed_none' then
    if jsonb_array_length(v_new) > 0 then
      return jsonb_build_object('status', 'invalid', 'reason',
        '“No activity” cannot be saved together with new activities.');
    elsif v_unseen > 0 then
      return jsonb_build_object('status', 'conflict', 'reason',
        'Activity for this date was recorded elsewhere since you opened the form. Reload to review it.');
    end if;
  elsif v_status = 'logged' and jsonb_array_length(v_new) = 0 and v_existing = 0 then
    return jsonb_build_object('status', 'conflict', 'reason',
      'There is no recorded activity for this date any more. Reload to review it.');
  end if;

  if v_status = 'confirmed_none' and cardinality(v_remove) > 0 then
    delete from public.activities
     where user_id = (select auth.uid()) and local_date = v_date and id = any (v_remove);
  end if;

  for v_item in select value from jsonb_array_elements(v_new) loop
    -- A retried submission must not add the same quick-add activity twice.
    if not exists (
      select 1 from public.activities
       where user_id = (select auth.uid()) and created_request_id = (v_item ->> 'request_id')::uuid
    ) then
      perform daykind_private.insert_manual_activity(v_item -> 'draft', (v_item ->> 'request_id')::uuid);
    end if;
  end loop;

  v_symptom_id := daykind_private.upsert_check_in_symptom(
    v_row.symptom_entry_id, p -> 'symptom', 'evening', v_date, coalesce(v_row.timezone, p ->> 'timezone'), v_request);

  if v_exists then
    update public.evening_entries set
      local_date = v_date,
      activity_status = v_status,
      evening_fatigue = p ->> 'evening_fatigue',
      recovery_day = coalesce((p ->> 'recovery_day')::boolean, false),
      completion_state = 'complete',
      symptom_entry_id = v_symptom_id,
      last_request_id = v_request
    where id = v_row.id
    returning * into v_row;
  else
    insert into public.evening_entries (
      local_date, timezone, activity_status, evening_fatigue, recovery_day,
      completion_state, symptom_entry_id, last_request_id
    ) values (
      v_date, p ->> 'timezone', v_status, p ->> 'evening_fatigue',
      coalesce((p ->> 'recovery_day')::boolean, false), 'complete', v_symptom_id, v_request
    )
    returning * into v_row;
  end if;

  return jsonb_build_object('status', 'saved', 'record', to_jsonb(v_row));
exception when unique_violation then
  select * into v_row from public.evening_entries
   where user_id = (select auth.uid()) and local_date = v_date;
  if found and v_row.last_request_id = v_request then
    return jsonb_build_object('status', 'saved', 'record', to_jsonb(v_row));
  end if;
  return jsonb_build_object('status', 'conflict', 'reason',
    'An evening check-in for this date already exists, possibly saved on another device. Reload to edit it.');
end;
$$;

-- p: {request_id, draft}
create function public.create_manual_activity(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_request uuid := (p ->> 'request_id')::uuid;
  v public.activities;
begin
  select * into v from public.activities
   where user_id = (select auth.uid()) and created_request_id = v_request;
  if not found then
    v := daykind_private.insert_manual_activity(p -> 'draft', v_request);
  end if;
  return jsonb_build_object('status', 'saved', 'record', to_jsonb(v));
end;
$$;

-- p: {id, expected_revision, request_id, draft}. Rewrites the editable fields.
create function public.update_activity(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_request uuid := (p ->> 'request_id')::uuid;
  d jsonb := p -> 'draft';
  v public.activities;
begin
  select * into v from public.activities where id = (p ->> 'id')::uuid for update;
  if not found then
    return jsonb_build_object('status', 'not_found', 'reason',
      'This activity no longer exists. It may have been deleted on another device.');
  elsif v.last_request_id = v_request then
    return jsonb_build_object('status', 'saved', 'record', to_jsonb(v));
  elsif v.revision <> (p ->> 'expected_revision')::integer then
    return jsonb_build_object('status', 'conflict', 'reason',
      'This activity was changed on another device. Reload to see the latest version.');
  end if;

  update public.activities set
    type = d ->> 'type',
    started_at = (d ->> 'started_at')::timestamptz,
    local_date = (d ->> 'local_date')::date,
    timezone = d ->> 'timezone',
    elapsed_seconds = (d ->> 'elapsed_seconds')::integer,
    active_seconds = (d ->> 'active_seconds')::integer,
    reported_seconds = (d ->> 'reported_seconds')::integer,
    duration_basis = d ->> 'duration_basis',
    distance_meters = (d ->> 'distance_meters')::numeric,
    avg_heart_rate_bpm = (d ->> 'avg_heart_rate_bpm')::smallint,
    max_heart_rate_bpm = (d ->> 'max_heart_rate_bpm')::smallint,
    intensity = coalesce(d ->> 'intensity', 'unknown'),
    note = d ->> 'note',
    field_provenance = coalesce(d -> 'field_provenance', '{}'::jsonb),
    last_request_id = v_request
  where id = v.id
  returning * into v;
  return jsonb_build_object('status', 'saved', 'record', to_jsonb(v));
end;
$$;

-- Atomic confirmed import (PRD FR04). p: {request_id, file: {sha256, kind,
-- filename_sanitized}, sessions: [{draft, source: {source_kind, provider_id,
-- imported_summary, decoder_version}, resolution: {kind, activity_id?, expected_revision?}}]}
create function public.import_confirmed_activities(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_request uuid := (p ->> 'request_id')::uuid;
  v_hash text := p -> 'file' ->> 'sha256';
  v_kind text := p -> 'file' ->> 'kind';
  v_file public.import_files;
  v_session jsonb;
  v_index integer := -1;
  v_resolution jsonb;
  v_target public.activities;
  v_new public.activities;
  v_ids uuid[] := '{}';
  v_draft jsonb;
  v_measured jsonb;
begin
  select * into v_file from public.import_files
   where user_id = (select auth.uid()) and created_request_id = v_request;
  if found then
    return jsonb_build_object('status', 'saved', 'saved_at', v_file.imported_at, 'activity_ids', to_jsonb(v_file.activity_ids));
  end if;

  select * into v_file from public.import_files
   where user_id = (select auth.uid()) and file_hash = v_hash;
  if found then
    return jsonb_build_object('status', 'duplicate_file', 'imported_at', v_file.imported_at,
      'reason', 'This file was already imported.');
  end if;

  begin
    insert into public.import_files (file_hash, file_kind, filename_sanitized, session_count, created_request_id)
    values (v_hash, v_kind, p -> 'file' ->> 'filename_sanitized',
            jsonb_array_length(p -> 'sessions'), v_request)
    returning * into v_file;

    for v_session in select value from jsonb_array_elements(p -> 'sessions') loop
      v_index := v_index + 1;
      v_draft := v_session -> 'draft';
      v_resolution := v_session -> 'resolution';

      if v_resolution ->> 'kind' in ('link', 'replace') then
        select * into v_target from public.activities
         where id = (v_resolution ->> 'activity_id')::uuid and canonical_status = 'canonical'
         for update;
        if not found or v_target.revision <> (v_resolution ->> 'expected_revision')::integer then
          raise exception using errcode = 'DK409', message = v_resolution ->> 'activity_id';
        end if;
      end if;

      if v_resolution ->> 'kind' = 'link' then
        -- Measured fields come from the file; the user's note, effort, type,
        -- and reported duration are kept.
        v_measured := coalesce(v_draft -> 'field_provenance', '{}'::jsonb)
          - 'note' - 'intensity' - 'type' - 'reportedSeconds';
        update public.activities set
          started_at = (v_draft ->> 'started_at')::timestamptz,
          local_date = (v_draft ->> 'local_date')::date,
          timezone = v_draft ->> 'timezone',
          elapsed_seconds = (v_draft ->> 'elapsed_seconds')::integer,
          active_seconds = (v_draft ->> 'active_seconds')::integer,
          duration_basis = v_draft ->> 'duration_basis',
          distance_meters = (v_draft ->> 'distance_meters')::numeric,
          avg_heart_rate_bpm = (v_draft ->> 'avg_heart_rate_bpm')::smallint,
          max_heart_rate_bpm = (v_draft ->> 'max_heart_rate_bpm')::smallint,
          intensity = case when v_target.intensity = 'unknown'
                           then coalesce(v_draft ->> 'intensity', 'unknown') else v_target.intensity end,
          note = coalesce(v_target.note, v_draft ->> 'note'),
          field_provenance = v_target.field_provenance || v_measured,
          last_request_id = v_request
        where id = v_target.id
        returning * into v_new;
      else
        v_new := daykind_private.insert_activity(v_draft, v_session -> 'source' ->> 'source_kind', null);
        if v_resolution ->> 'kind' = 'replace' then
          update public.activities
             set canonical_status = 'linked', linked_activity_id = v_new.id
           where id = v_target.id;
        end if;
      end if;

      insert into public.activity_sources (
        activity_id, import_file_id, source_kind, provider_id, file_hash,
        imported_summary, field_provenance, decoder_version
      ) values (
        v_new.id, v_file.id, v_session -> 'source' ->> 'source_kind',
        v_session -> 'source' ->> 'provider_id', v_hash,
        v_session -> 'source' -> 'imported_summary',
        coalesce(v_draft -> 'field_provenance', '{}'::jsonb),
        v_session -> 'source' ->> 'decoder_version'
      );
      v_ids := v_ids || v_new.id;
    end loop;

    update public.import_files set activity_ids = v_ids where id = v_file.id returning * into v_file;
  exception
    when sqlstate 'DK409' then
      return jsonb_build_object('status', 'conflict', 'activity_id', sqlerrm, 'reason',
        'An activity chosen for linking or replacing changed or was removed since the preview.');
    when unique_violation then
      return jsonb_build_object('status', 'duplicate_file', 'imported_at', now(), 'reason',
        'This file, or a workout in it, was already imported.');
    when check_violation or not_null_violation or data_exception then
      return jsonb_build_object('status', 'invalid', 'session_index', greatest(v_index, 0), 'reason', sqlerrm);
  end;

  return jsonb_build_object('status', 'saved', 'saved_at', v_file.imported_at, 'activity_ids', to_jsonb(v_ids));
end;
$$;

revoke all on function
  daykind_private.insert_activity(jsonb, text, uuid),
  daykind_private.insert_manual_activity(jsonb, uuid),
  daykind_private.upsert_check_in_symptom(uuid, jsonb, text, date, text, uuid)
from public;
grant execute on function
  daykind_private.insert_activity(jsonb, text, uuid),
  daykind_private.insert_manual_activity(jsonb, uuid),
  daykind_private.upsert_check_in_symptom(uuid, jsonb, text, date, text, uuid)
to authenticated;

revoke all on function
  public.save_morning_check_in(jsonb),
  public.save_evening_check_in(jsonb),
  public.create_manual_activity(jsonb),
  public.update_activity(jsonb),
  public.import_confirmed_activities(jsonb)
from public, anon;
grant execute on function
  public.save_morning_check_in(jsonb),
  public.save_evening_check_in(jsonb),
  public.create_manual_activity(jsonb),
  public.update_activity(jsonb),
  public.import_confirmed_activities(jsonb)
to authenticated;
