-- Weather and night effects (rain, snow, fireflies, lanterns): one small value in the game's settings row.
-- Run this in the Supabase dashboard (SQL editor). It is safe to run more than once.
-- Needs supabase-world-clock.sql to have run first (it creates public.world_settings and decides who may change it: only GMs).
-- Until it has run the game still works: everybody just gets "Auto" (rain now and then, snow in December, fireflies at dusk, lanterns on clear nights).
-- Example of what is stored:  {"w":"snow","f":"on","l":"auto"}   (w = weather, f = fireflies, l = lanterns)
alter table public.world_settings add column if not exists fx jsonb;
