-- Arete backend: run once in Supabase → SQL Editor (safe to re-run).
--
-- What it sets up
--   user_data       one row per user holding the app's synced data. Row-Level Security: a signed-in
--                   user can read and write ONLY their own row; nobody else's, ever.
--   ai_usage        per-user, per-day counters for features that cost money (food photo estimates).
--                   Clients cannot read or write it directly.
--   claim_ai_credit spends one credit and returns how many are left today, or -1 once the daily cap
--                   is reached. The caps are written here, so no client can raise them.
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
  delete from auth.users where id = uid;   -- cascades to user_data and ai_usage
end;
$$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
