-- DayKind: canonical activities, their sources, and imported-file hashes.
-- See doc/activity-contract.md. Units: seconds, meters, beats per minute.

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  source text not null check (source in ('manual', 'tcx', 'fit')),
  type text not null check (type in ('walking', 'cycling', 'resistance', 'other')),
  started_at timestamptz,
  -- Local start date in the captured timezone; frozen after entry.
  local_date date not null,
  timezone text not null check (daykind_private.is_valid_timezone(timezone)),
  elapsed_seconds integer check (elapsed_seconds between 0 and 86400),
  active_seconds integer check (active_seconds between 0 and 86400),
  reported_seconds integer check (reported_seconds between 0 and 86400),
  duration_basis text not null check (duration_basis in ('active', 'elapsed', 'reported')),
  goal_seconds integer generated always as (
    case duration_basis
      when 'active' then active_seconds
      when 'elapsed' then elapsed_seconds
      else reported_seconds
    end
  ) stored,
  distance_meters numeric(10, 2) check (distance_meters between 0 and 1000000),
  avg_heart_rate_bpm smallint check (avg_heart_rate_bpm between 25 and 250),
  max_heart_rate_bpm smallint check (max_heart_rate_bpm between 25 and 250),
  intensity text not null default 'unknown' check (intensity in ('easy', 'moderate', 'hard', 'unknown')),
  note text check (char_length(note) <= 500),
  canonical_status text not null default 'canonical' check (canonical_status in ('canonical', 'linked')),
  linked_activity_id uuid,
  field_provenance jsonb not null default '{}' check (jsonb_typeof(field_provenance) = 'object'),
  created_request_id uuid,
  last_request_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision >= 1),
  unique (id, user_id),
  unique (user_id, created_request_id),
  check (
    case duration_basis
      when 'active' then active_seconds > 0
      when 'elapsed' then elapsed_seconds > 0
      else reported_seconds > 0
    end
  ),
  check (active_seconds <= elapsed_seconds),
  check (avg_heart_rate_bpm <= max_heart_rate_bpm),
  check (started_at is null or (started_at at time zone timezone)::date = local_date),
  check ((canonical_status = 'linked') = (linked_activity_id is not null)),
  check (linked_activity_id <> id),
  foreign key (linked_activity_id, user_id) references public.activities (id, user_id)
);
create index activities_user_date on public.activities (user_id, local_date);
create index activities_user_start on public.activities (user_id, started_at);
create index activities_linked on public.activities (linked_activity_id) where linked_activity_id is not null;

-- Exact file hashes block repeated imports while any of the file's activities exist.
create table public.import_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  file_hash text not null check (file_hash ~ '^[0-9a-f]{64}$'),
  file_kind text not null check (file_kind in ('tcx', 'fit')),
  filename_sanitized text check (char_length(filename_sanitized) <= 255),
  session_count integer not null default 0 check (session_count >= 0),
  -- Activity ids in session order, so a repeated confirmation returns the same result.
  activity_ids uuid[] not null default '{}',
  created_request_id uuid,
  imported_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision >= 1),
  unique (id, user_id),
  unique (user_id, file_hash),
  unique (user_id, created_request_id)
);

create table public.activity_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  activity_id uuid not null,
  import_file_id uuid,
  source_kind text not null check (source_kind in ('manual', 'tcx', 'fit')),
  provider_id text check (char_length(provider_id) <= 200),
  file_hash text check (file_hash ~ '^[0-9a-f]{64}$'),
  imported_summary jsonb check (imported_summary is null or jsonb_typeof(imported_summary) = 'object'),
  field_provenance jsonb not null default '{}' check (jsonb_typeof(field_provenance) = 'object'),
  decoder_version text check (char_length(decoder_version) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision >= 1),
  -- Provider ids are unique per user and source kind when present.
  unique (user_id, source_kind, provider_id),
  check ((source_kind = 'manual') = (import_file_id is null)),
  foreign key (activity_id, user_id) references public.activities (id, user_id) on delete cascade,
  foreign key (import_file_id, user_id) references public.import_files (id, user_id)
);
create index activity_sources_activity on public.activity_sources (activity_id);
create index activity_sources_import_file on public.activity_sources (import_file_id);

-- Deleting a replacement restores the activity it replaced, so the workout
-- still counts once instead of disappearing.
create function daykind_private.unlink_replaced()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.activities
     set canonical_status = 'canonical', linked_activity_id = null
   where linked_activity_id = old.id;
  return old;
end;
$$;

-- An import file with no remaining sources no longer blocks re-import.
create function daykind_private.drop_orphan_import_file()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.import_file_id is not null then
    delete from public.import_files f
     where f.id = old.import_file_id
       and not exists (select 1 from public.activity_sources s where s.import_file_id = f.id);
  end if;
  return old;
end;
$$;

revoke all on function daykind_private.unlink_replaced(), daykind_private.drop_orphan_import_file() from public;

create trigger activities_unlink_replaced before delete on public.activities
  for each row execute function daykind_private.unlink_replaced();
create trigger activity_sources_drop_orphan after delete on public.activity_sources
  for each row execute function daykind_private.drop_orphan_import_file();

create trigger activities_touch before update on public.activities
  for each row execute function daykind_private.touch_row();
create trigger import_files_touch before update on public.import_files
  for each row execute function daykind_private.touch_row();
create trigger activity_sources_touch before update on public.activity_sources
  for each row execute function daykind_private.touch_row();

alter table public.activities enable row level security;
alter table public.import_files enable row level security;
alter table public.activity_sources enable row level security;

create policy activities_owner on public.activities for all to authenticated
  using (daykind_private.owns_row(user_id)) with check (daykind_private.owns_row(user_id));
create policy import_files_owner on public.import_files for all to authenticated
  using (daykind_private.owns_row(user_id)) with check (daykind_private.owns_row(user_id));
create policy activity_sources_owner on public.activity_sources for all to authenticated
  using (daykind_private.owns_row(user_id)) with check (daykind_private.owns_row(user_id));

revoke all on table public.activities, public.import_files, public.activity_sources from anon, public;
grant select, insert, update, delete
  on table public.activities, public.import_files, public.activity_sources to authenticated;
