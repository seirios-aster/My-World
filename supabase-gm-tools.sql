-- GM tools: who is online (with their ping), and bans / kicks.
-- Run this in the Supabase dashboard (SQL editor). It is safe to run more than once.
-- Until it has run (and the gm-admin Edge Function is deployed) the app keeps working; the GM panel just says it isn't set up.
-- Needs supabase-world-clock.sql to have run first (it creates public.world_admins, the list of GMs).

-- ---------------------------------------------------------------- bans and kicks
-- One row per removed person. A kick is a ban that ends by itself after a minute; a ban lasts until `until` (empty = until a GM lifts it).
-- Only the gm-admin Edge Function writes here (it uses the secret key, which skips these rules); nobody else has any write access at all.
create table if not exists public.world_bans (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  email      text,
  name       text check (name is null or length(name) <= 24),
  reason     text check (reason is null or length(reason) <= 200),
  kind       text not null default 'ban' check (kind in ('ban', 'kick')),
  banned_by  uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  until      timestamptz
);
alter table public.world_bans enable row level security;
revoke all on public.world_bans from anon, authenticated;
grant select on public.world_bans to authenticated;

-- you can see your own row (that is how the game tells you that you were removed); a GM can see everyone's
drop policy if exists "world_bans: see own row" on public.world_bans;
drop policy if exists "world_bans: gm reads all" on public.world_bans;
create policy "world_bans: see own row" on public.world_bans for select to authenticated using (user_id = auth.uid());
create policy "world_bans: gm reads all" on public.world_bans for select to authenticated
  using (exists (select 1 from public.world_admins a where a.user_id = auth.uid()));

-- ---------------------------------------------------------------- who is online
-- Every signed-in game writes one small row about itself about once a minute (name, and the ping it measured on its last write).
-- The user id here is the real one (the database fills in who you are, you cannot write someone else's row), so a GM can safely kick or ban from this list.
create table if not exists public.world_online (
  user_id uuid primary key references auth.users (id) on delete cascade,
  name    text not null default '' check (length(name) <= 24),
  ping    integer check (ping is null or (ping >= 0 and ping <= 9999)),
  seen_at timestamptz not null default now()
);
alter table public.world_online enable row level security;
revoke all on public.world_online from anon, authenticated;
grant select, insert, update on public.world_online to authenticated;

-- seen_at is always the server's clock, whatever the game sends
create or replace function public.world_online_touch() returns trigger
language plpgsql set search_path = '' as $$
begin new.seen_at := now(); return new; end $$;
drop trigger if exists world_online_touch on public.world_online;
create trigger world_online_touch before insert or update on public.world_online
  for each row execute function public.world_online_touch();

drop policy if exists "world_online: write own"  on public.world_online;
drop policy if exists "world_online: update own" on public.world_online;
drop policy if exists "world_online: see own row" on public.world_online;
drop policy if exists "world_online: gm reads"   on public.world_online;
-- you can only write your own row, and a banned (or just kicked) person can't: their game sees the refusal and checks why
create policy "world_online: write own" on public.world_online for insert to authenticated
  with check (user_id = auth.uid() and not exists (
    select 1 from public.world_bans b where b.user_id = auth.uid() and (b.until is null or b.until > now())));
create policy "world_online: update own" on public.world_online for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and not exists (
    select 1 from public.world_bans b where b.user_id = auth.uid() and (b.until is null or b.until > now())));
-- you can see your own row (an upsert needs that), and only a GM can read the whole list
create policy "world_online: see own row" on public.world_online for select to authenticated using (user_id = auth.uid());
create policy "world_online: gm reads" on public.world_online for select to authenticated
  using (exists (select 1 from public.world_admins a where a.user_id = auth.uid()));

-- ---------------------------------------------------------------- the server-side key
-- The gm-admin Edge Function uses the project's secret (service_role) key. That key skips the row-level-security rules, but it still needs plain table permissions,
-- and on some projects it does not have them on tables made in the SQL editor (then every call is refused with 403 "GM only", because it cannot read world_admins).
grant select on public.world_admins to service_role;
grant select, insert, update, delete on public.world_bans to service_role;
grant select on public.world_online to service_role;
