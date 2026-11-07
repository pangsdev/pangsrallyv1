-- Pangs Cup (supabase/functions/test-season/cup.ts): a one-evening tournament.
-- Cup races live in test_races (kind 'cup') with their Cup, round and room, so replays work as
-- for any race. They have no test_race_entries rows: they use no daily race and give no season points.
alter table test_races drop constraint if exists test_races_kind_check;
alter table test_races add constraint test_races_kind_check check (kind in ('bot', 'online', 'cup'));

alter table test_races add column if not exists cup_id int;
alter table test_races add column if not exists cup_round int;
alter table test_races add column if not exists cup_room int;
-- One race per Cup round and room, so two requests resolving a round at once cannot run it twice.
create unique index if not exists test_races_cup_room on test_races (cup_id, cup_round, cup_room) where cup_id is not null;

create table if not exists test_cups (
  id int primary key,
  title text not null,
  terrain text not null default 'Forest',
  starts_at timestamptz not null,
  round_minutes int not null default 15 check (round_minutes >= 2),
  qualifying_rounds int not null default 4 check (qualifying_rounds between 1 and 10),
  final_gap_minutes int not null default 30 check (final_gap_minutes >= 2),
  seats int not null default 30 check (seats between 2 and 200),
  register_close_minutes int not null default 30 check (register_close_minutes >= 0),
  eligible_before timestamptz,
  -- Secret until the Grand Final has run; its SHA-256 is public from the start.
  seed_secret text not null,
  seed_commit text not null,
  prizes jsonb not null default '[]',
  claim_contract text,
  created_at timestamptz not null default now()
);

create table if not exists test_cup_entries (
  cup_id int not null references test_cups(id) on delete cascade,
  wallet text not null references test_players(wallet) on delete cascade,
  registered_at timestamptz not null default now(),
  primary key (cup_id, wallet)
);

-- Only the game server (service role) touches these.
alter table test_cups enable row level security;
alter table test_cup_entries enable row level security;
revoke all on test_cups, test_cup_entries from anon, authenticated;
