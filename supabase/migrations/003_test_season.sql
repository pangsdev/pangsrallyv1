-- Test season: wallet sign-in, races, points and leaderboard.
-- Only the `test-season` Edge Function (service role) reads or writes these
-- tables: RLS is on with no policies, so the public API key gets nothing.

create table if not exists test_players (
  wallet text primary key check (wallet ~ '^0x[0-9a-f]{40}$'),
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

create table if not exists test_sessions (
  token_hash text primary key,
  wallet text not null references test_players(wallet) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists test_sessions_wallet on test_sessions (wallet);

create table if not exists test_races (
  id uuid primary key,
  kind text not null check (kind in ('bot', 'online')),
  terrain text not null,
  seed text not null,
  status text not null check (status in ('open', 'finished')),
  created_at timestamptz not null default now(),
  closes_at timestamptz,
  finished_at timestamptz,
  field jsonb,
  results jsonb
);
create index if not exists test_races_open on test_races (kind, terrain, status, created_at);

create table if not exists test_race_entries (
  race_id uuid not null references test_races(id) on delete cascade,
  wallet text not null references test_players(wallet) on delete cascade,
  day date not null,
  slot int not null check (slot >= 1),
  position int,
  points int not null default 0,
  joined_at timestamptz not null default now(),
  primary key (race_id, wallet),
  -- One row per race of the day: this is what enforces the daily limit under parallel requests.
  unique (wallet, day, slot)
);
create index if not exists test_race_entries_wallet on test_race_entries (wallet, joined_at desc);

create or replace view test_leaderboard as
select
  wallet,
  count(*) filter (where position is not null)::int as races,
  coalesce(sum(points), 0)::int as points,
  count(*) filter (where position = 1)::int as wins,
  count(*) filter (where position <= 3)::int as podiums,
  max(joined_at) as last_race
from test_race_entries
group by wallet;

alter table test_players enable row level security;
alter table test_sessions enable row level security;
alter table test_races enable row level security;
alter table test_race_entries enable row level security;

-- Views run with their owner's rights, so keep this one away from the public roles too.
revoke all on test_leaderboard from anon, authenticated;
