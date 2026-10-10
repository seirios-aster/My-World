-- The game clock: which time zone the whole world follows, and who is allowed to change it.
-- Run this in the Supabase dashboard (SQL editor). It is safe to run more than once.
-- Until it has run, the app keeps working and every player just follows their own device's time.

-- who runs the game (the "GM"). Nobody can add themselves: rows are only added here, in the SQL editor.
create table if not exists public.world_admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);
alter table public.world_admins enable row level security;
-- say exactly what each kind of visitor may do (older projects hand out much more by default; the policies below would still block it, this makes it explicit)
revoke all on public.world_admins from anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select on public.world_admins to authenticated;

-- a signed-in person can see only their own row (that is how the app knows whether to show the clock control)
drop policy if exists "world_admins: see own row" on public.world_admins;
create policy "world_admins: see own row" on public.world_admins for select to authenticated using (user_id = auth.uid());

-- one row: 'device' = every player follows their own device's time, otherwise a time-zone name such as America/New_York
create table if not exists public.world_settings (
  id         text primary key default 'main' check (id = 'main'),
  tz         text not null default 'device' check (tz = 'device' or (length(tz) <= 40 and tz ~ '^[A-Za-z]+(/[A-Za-z0-9_+-]+){0,2}$')),
  updated_at timestamptz not null default now()
);
alter table public.world_settings enable row level security;
insert into public.world_settings (id) values ('main') on conflict (id) do nothing;

revoke all on public.world_settings from anon, authenticated;
grant select on public.world_settings to anon, authenticated;
grant insert, update on public.world_settings to authenticated;

-- everyone (even before signing in) can read it; only a GM can change it
drop policy if exists "world_settings: read"        on public.world_settings;
drop policy if exists "world_settings: gm insert"   on public.world_settings;
drop policy if exists "world_settings: gm update"   on public.world_settings;
create policy "world_settings: read"      on public.world_settings for select to anon, authenticated using (true);
create policy "world_settings: gm insert" on public.world_settings for insert to authenticated
  with check (exists (select 1 from public.world_admins a where a.user_id = auth.uid()));
create policy "world_settings: gm update" on public.world_settings for update to authenticated
  using      (exists (select 1 from public.world_admins a where a.user_id = auth.uid()))
  with check (exists (select 1 from public.world_admins a where a.user_id = auth.uid()));

-- To make someone a GM (run once, with their email; they must have signed in to the game at least once):
--   insert into public.world_admins (user_id) select id from auth.users where lower(email) = lower('their-email@example.com') on conflict do nothing;
--   select * from public.world_admins;   -- must show one row per GM; no rows means the email did not match anyone
