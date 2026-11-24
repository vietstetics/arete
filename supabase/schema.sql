-- Arete backend: run once in Supabase → SQL Editor (safe to re-run).
--
-- What it sets up
--   user_data       one row per user holding the app's synced data. Row-Level Security: a signed-in
--                   user can read and write ONLY their own row; nobody else's, ever.
--   ai_usage        per-user, per-day counters for features that cost money (food photo estimates).
--                   Clients cannot read or write it directly.
--   claim_ai_credit spends one credit and returns how many are left today, or -1 once the daily cap
--                   is reached. The caps are written here, so no client can raise them.
--   exercise_sets   one row per logged set (weight, reps, RIR, each side for unilateral): weight progression.
--   velocity_sets   one row per camera-tracked set (load, bar speed, per-rep speeds): velocity history.
--                   Both: Row-Level Security, each user reads and writes only their own rows.
--   delete_my_account  deletes the caller's account; their data rows go with it (on delete cascade).

-- ── Synced app data ─────────────────────────────────────────────────────────
create table if not exists public.user_data (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  -- A sane ceiling (5 MB) so one account can't fill the database.
  constraint user_data_size check (pg_column_size(data) < 5000000)
);
alter table public.user_data enable row level security;
alter table public.user_data force row level security;

drop policy if exists "own row - select" on public.user_data;
drop policy if exists "own row - insert" on public.user_data;
drop policy if exists "own row - update" on public.user_data;
drop policy if exists "own row - delete" on public.user_data;
create policy "own row - select" on public.user_data for select to authenticated using ((select auth.uid()) = user_id);
create policy "own row - insert" on public.user_data for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own row - update" on public.user_data for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own row - delete" on public.user_data for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.user_data from anon;
grant select, insert, update, delete on public.user_data to authenticated;

-- ── Daily caps for paid AI features ─────────────────────────────────────────
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day     date not null,
  kind    text not null,
  count   integer not null default 0,
  primary key (user_id, day, kind)
);
alter table public.ai_usage enable row level security;
alter table public.ai_usage force row level security;
-- No policies on purpose: only the function below (running as the table owner) touches it.
revoke all on public.ai_usage from anon, authenticated;

create or replace function public.claim_ai_credit(p_kind text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid  uuid := auth.uid();
  lim  integer;
  used integer;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  lim := case p_kind
           when 'food_photo' then 20     -- food photo estimates per user per day (UTC)
           else null
         end;
  if lim is null then
    raise exception 'unknown credit kind' using errcode = '22023';
  end if;

  insert into public.ai_usage as u (user_id, day, kind, count)
  values (uid, (now() at time zone 'utc')::date, p_kind, 1)
  on conflict (user_id, day, kind) do update set count = u.count + 1
  returning u.count into used;

  if used > lim then
    return -1;
  end if;
  return lim - used;
end;
$$;
revoke all on function public.claim_ai_credit(text) from public, anon;
grant execute on function public.claim_ai_credit(text) to authenticated;

-- ── Set history: one row per logged set and per camera-tracked set ─────────
-- Weight progression and bar-speed history live here as organised rows, independent of the size of
-- user_data. The app writes them from js/setSync.js (upserts, so a retry never duplicates).
create table if not exists public.exercise_sets (
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  set_id       text not null check (char_length(set_id) between 1 and 120),
  workout_id   text not null check (char_length(workout_id) between 1 and 120),
  plan_id      text check (char_length(plan_id) <= 120),
  routine_id   text check (char_length(routine_id) <= 120),
  exercise     text not null check (char_length(exercise) between 1 and 160),
  exercise_key text not null check (char_length(exercise_key) between 1 and 160),
  machine_id   text check (char_length(machine_id) <= 160),
  position     integer not null default 0 check (position between 0 and 1000),
  set_type     text not null default 'working' check (set_type in ('working', 'warmup')),
  performed_on date not null,
  completed_at timestamptz,
  weight_kg    numeric(7,2) check (weight_kg >= 0 and weight_kg < 2000),
  reps         numeric(5,1) check (reps >= 0 and reps < 1000),
  rir          numeric(3,1) check (rir >= 0 and rir <= 10),
  weight_r     numeric(7,2) check (weight_r >= 0 and weight_r < 2000),
  reps_r       numeric(5,1) check (reps_r >= 0 and reps_r < 1000),
  weight_l     numeric(7,2) check (weight_l >= 0 and weight_l < 2000),
  reps_l       numeric(5,1) check (reps_l >= 0 and reps_l < 1000),
  updated_at   timestamptz not null default now(),
  primary key (user_id, set_id)
);
create index if not exists exercise_sets_by_exercise on public.exercise_sets (user_id, exercise_key, performed_on);
create index if not exists exercise_sets_by_workout on public.exercise_sets (user_id, workout_id);

create table if not exists public.velocity_sets (
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  record_id     text not null check (char_length(record_id) between 1 and 160),
  set_id        text check (char_length(set_id) <= 120),
  workout_id    text check (char_length(workout_id) <= 120),
  exercise      text not null check (char_length(exercise) between 1 and 160),
  exercise_key  text not null check (char_length(exercise_key) between 1 and 160),
  equipment_key text check (char_length(equipment_key) <= 200),
  load_kg       numeric(7,2) check (load_kg >= 0 and load_kg < 2000),
  units         text not null check (units in ('m/s', 'relative')),
  captured_at   timestamptz not null,
  counted       integer not null default 0 check (counted between 0 and 1000),
  first_mcv     numeric(6,3) check (first_mcv >= 0 and first_mcv < 20),
  best_mcv      numeric(6,3) check (best_mcv >= 0 and best_mcv < 20),
  loss_pct      numeric(6,2) check (loss_pct > -1000 and loss_pct < 1000),
  quality_ok    boolean,
  reps          jsonb not null default '[]'::jsonb check (pg_column_size(reps) < 64000),
  updated_at    timestamptz not null default now(),
  primary key (user_id, record_id)
);
create index if not exists velocity_sets_by_load on public.velocity_sets (user_id, exercise_key, load_kg);

do $$
declare t text;
begin
  foreach t in array array['exercise_sets', 'velocity_sets'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('drop policy if exists "own rows - select" on public.%I', t);
    execute format('drop policy if exists "own rows - insert" on public.%I', t);
    execute format('drop policy if exists "own rows - update" on public.%I', t);
    execute format('drop policy if exists "own rows - delete" on public.%I', t);
    execute format('create policy "own rows - select" on public.%I for select to authenticated using ((select auth.uid()) = user_id)', t);
    execute format('create policy "own rows - insert" on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)', t);
    execute format('create policy "own rows - update" on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t);
    execute format('create policy "own rows - delete" on public.%I for delete to authenticated using ((select auth.uid()) = user_id)', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- ── Account deletion (required by Apple and Google, and by GDPR's right to erasure) ──
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  delete from auth.users where id = uid;   -- cascades to user_data, ai_usage, exercise_sets and velocity_sets
end;
$$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
