-- DayKind: symptom observations, morning sleep entries, evening entries.
-- null means unknown; explicit "none" states use enumerations.

create table public.symptom_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  observed_at timestamptz not null,
  local_date date not null,
  timezone text not null check (daykind_private.is_valid_timezone(timezone)),
  context text not null check (context in ('morning', 'evening', 'standalone')),
  ankle_pain smallint check (ankle_pain between 0 and 10),
  side text check (side in ('left', 'right', 'both')),
  flare_reported boolean not null default false,
  new_or_worsening boolean not null default false,
  swelling_heat_redness boolean not null default false,
  weight_bearing_difficulty boolean not null default false,
  -- null when not asked or not sure.
  fever_or_unwell boolean,
  created_request_id uuid,
  last_request_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision >= 1),
  unique (id, user_id),
  unique (user_id, created_request_id)
);
create index symptom_entries_user_date on public.symptom_entries (user_id, local_date);

-- One canonical sleep entry per waking date. Duration is actual sleep,
-- excluding awake baby-care time; a range stores min < max, a point min = max.
create table public.sleep_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  waking_date date not null,
  timezone text not null check (daykind_private.is_valid_timezone(timezone)),
  duration_min_seconds integer check (duration_min_seconds between 0 and 57600),
  duration_max_seconds integer check (duration_max_seconds between 0 and 57600),
  approximate boolean not null default false,
  total_interruptions integer check (total_interruptions >= 0),
  baby_interruptions integer check (baby_interruptions >= 0),
  restfulness text check (restfulness in ('well_rested', 'somewhat_rested', 'poorly_rested')),
  morning_fatigue text check (morning_fatigue in ('energetic', 'mildly_tired', 'very_tired')),
  note text check (char_length(note) <= 500),
  completion_state text not null default 'complete' check (completion_state in ('draft', 'complete')),
  symptom_entry_id uuid,
  last_request_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision >= 1),
  unique (user_id, waking_date),
  check (duration_min_seconds <= duration_max_seconds),
  check (approximate or duration_min_seconds is not distinct from duration_max_seconds),
  check (baby_interruptions <= total_interruptions),
  -- A complete entry needs a duration, restfulness, and fatigue. Interruption
  -- counts may be null, which a complete entry records as an explicit "unknown".
  check (
    completion_state = 'draft'
    or (duration_min_seconds is not null and restfulness is not null and morning_fatigue is not null)
  ),
  foreign key (symptom_entry_id, user_id) references public.symptom_entries (id, user_id)
    on delete set null (symptom_entry_id)
);

-- One evening review per local date. Activities exist independently.
create table public.evening_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  local_date date not null,
  timezone text not null check (daykind_private.is_valid_timezone(timezone)),
  activity_status text not null check (activity_status in ('logged', 'confirmed_none', 'unknown')),
  evening_fatigue text check (evening_fatigue in ('energetic', 'mildly_tired', 'very_tired')),
  recovery_day boolean not null default false,
  completion_state text not null default 'complete' check (completion_state in ('draft', 'complete')),
  symptom_entry_id uuid,
  last_request_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision >= 1),
  unique (user_id, local_date),
  check (completion_state = 'draft' or evening_fatigue is not null),
  foreign key (symptom_entry_id, user_id) references public.symptom_entries (id, user_id)
    on delete set null (symptom_entry_id)
);

create trigger symptom_entries_touch before update on public.symptom_entries
  for each row execute function daykind_private.touch_row();
create trigger sleep_entries_touch before update on public.sleep_entries
  for each row execute function daykind_private.touch_row();
create trigger evening_entries_touch before update on public.evening_entries
  for each row execute function daykind_private.touch_row();

alter table public.symptom_entries enable row level security;
alter table public.sleep_entries enable row level security;
alter table public.evening_entries enable row level security;

create policy symptom_entries_owner on public.symptom_entries for all to authenticated
  using (daykind_private.owns_row(user_id)) with check (daykind_private.owns_row(user_id));
create policy sleep_entries_owner on public.sleep_entries for all to authenticated
  using (daykind_private.owns_row(user_id)) with check (daykind_private.owns_row(user_id));
create policy evening_entries_owner on public.evening_entries for all to authenticated
  using (daykind_private.owns_row(user_id)) with check (daykind_private.owns_row(user_id));

revoke all on table public.symptom_entries, public.sleep_entries, public.evening_entries from anon, public;
grant select, insert, update, delete
  on table public.symptom_entries, public.sleep_entries, public.evening_entries to authenticated;
