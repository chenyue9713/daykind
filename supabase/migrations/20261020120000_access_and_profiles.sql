-- DayKind: access control, shared helpers, profiles, and goal versions.
-- Ownership is enforced here with row-level security, not only in the app.
-- Every user-owned row carries id, user_id, created_at, updated_at, revision.

create schema if not exists daykind_private;
revoke all on schema daykind_private from public;
grant usage on schema daykind_private to authenticated;

-- The private pilot has exactly one intended user. Accounts that are not
-- listed here cannot read or write any DayKind data, even if sign-ups are
-- accidentally enabled. Add the user with the SQL in the setup guide.
create table daykind_private.allowed_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now()
);
revoke all on table daykind_private.allowed_users from public, authenticated;

create function daykind_private.is_allowed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from daykind_private.allowed_users where user_id = (select auth.uid())
  );
$$;

-- The single ownership rule used by every policy.
create function daykind_private.owns_row(row_user_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select row_user_id = (select auth.uid()) and (select daykind_private.is_allowed());
$$;

create function daykind_private.is_valid_timezone(tz text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  perform now() at time zone tz;
  return tz is not null and tz <> '';
exception when others then
  return false;
end;
$$;

-- Maintains updated_at and revision, and keeps identity columns immutable.
create function daykind_private.touch_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.id := old.id;
  new.user_id := old.user_id;
  new.created_at := old.created_at;
  new.updated_at := now();
  new.revision := old.revision + 1;
  return new;
end;
$$;

revoke all on all functions in schema daykind_private from public;
grant execute on function daykind_private.is_allowed() to authenticated;
grant execute on function daykind_private.owns_row(uuid) to authenticated;
grant execute on function daykind_private.is_valid_timezone(text) to authenticated;

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique default auth.uid() references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 80),
  timezone text not null default 'America/Los_Angeles'
    check (daykind_private.is_valid_timezone(timezone)),
  timezone_confirmed boolean not null default false,
  distance_unit text not null default 'mi' check (distance_unit in ('km', 'mi')),
  weight_unit text not null default 'lb' check (weight_unit in ('kg', 'lb')),
  weight_tracking_enabled boolean not null default false,
  guidance_limits_acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision >= 1)
);

-- Effective-dated weekly targets. Versions start on a Monday and are kept so
-- past reports use the targets that applied then.
create table public.goal_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  effective_from date not null check (extract(isodow from effective_from) = 1),
  walking_seconds_per_day integer not null check (walking_seconds_per_day >= 0),
  resistance_sessions_per_week integer not null check (resistance_sessions_per_week >= 0),
  cycling_seconds_per_week integer not null check (cycling_seconds_per_week >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision >= 1),
  unique (user_id, effective_from)
);

create trigger profiles_touch before update on public.profiles
  for each row execute function daykind_private.touch_row();
create trigger goal_versions_touch before update on public.goal_versions
  for each row execute function daykind_private.touch_row();

alter table public.profiles enable row level security;
alter table public.goal_versions enable row level security;

create policy profiles_owner on public.profiles for all to authenticated
  using (daykind_private.owns_row(user_id)) with check (daykind_private.owns_row(user_id));
create policy goal_versions_owner on public.goal_versions for all to authenticated
  using (daykind_private.owns_row(user_id)) with check (daykind_private.owns_row(user_id));

revoke all on table public.profiles, public.goal_versions from anon, public;
grant select, insert, update, delete on table public.profiles, public.goal_versions to authenticated;
