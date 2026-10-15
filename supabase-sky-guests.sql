-- The keeper's friends: who may use the Sky Garden beam below level 99 (see supabase/functions/sky-pass).
-- Run this in the Supabase dashboard (SQL editor). It is safe to run more than once.
-- It only makes one small table. The secret itself is NOT stored here: set it as an Edge Function secret named SKY_PASS.
-- Nobody can read or change this table from a browser (row-level security is on and there are no policies); only the sky-pass function can.
create table if not exists public.sky_guests (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  granted      boolean     not null default false,
  tries        int         not null default 0,            -- wrong tries in the current hour
  total_tries  int         not null default 0,            -- wrong tries ever (30 locks the account out)
  window_start timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.sky_guests enable row level security;
revoke all on public.sky_guests from anon, authenticated;
-- to let someone back in after a lock-out, a GM can run:  update public.sky_guests set total_tries = 0, tries = 0 where user_id = '...';
