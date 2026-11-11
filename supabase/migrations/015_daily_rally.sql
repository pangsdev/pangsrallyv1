-- Daily Rally (supabase/functions/test-season/rally.ts): one race a day at 18:00 UTC.
-- Rally races live in test_races (kind 'rally') with their day and room, so replays work as for any
-- race. They have no test_race_entries rows: they use no daily race and give no season points.
alter table test_races drop constraint if exists test_races_kind_check;
alter table test_races add constraint test_races_kind_check check (kind in ('bot', 'online', 'cup', 'rally'));

alter table test_races add column if not exists rally_day date;
alter table test_races add column if not exists rally_room int;
-- One race per rally day and room, so two requests resolving a day at once cannot run it twice.
create unique index if not exists test_races_rally_room on test_races (rally_day, rally_room) where rally_day is not null;

-- The day's secret seeds the room draw and the race seeds; created by the first sign-up or start.
create table if not exists test_rally_days (
  day date primary key,
  seed_secret text not null,
  created_at timestamptz not null default now()
);

create table if not exists test_rally_entries (
  day date not null,
  wallet text not null references test_players(wallet) on delete cascade,
  registered_at timestamptz not null default now(),
  primary key (day, wallet)
);

-- Only the game server (service role) touches these.
alter table test_rally_days enable row level security;
alter table test_rally_entries enable row level security;
revoke all on test_rally_days, test_rally_entries from anon, authenticated;
