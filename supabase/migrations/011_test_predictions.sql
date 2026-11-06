-- Free prediction game: one final pick (saddle number 1-10) per wallet per online room.
-- Separate from season points. Only the test-season function touches this: RLS on, no policies.
create table if not exists test_predictions (
  race_id uuid not null references test_races(id) on delete cascade,
  wallet text not null references test_players(wallet) on delete cascade,
  pick int not null check (pick between 1 and 10),
  position int,
  points int not null default 0,
  created_at timestamptz not null default now(),
  primary key (race_id, wallet)
);
create index if not exists test_predictions_wallet on test_predictions (wallet, created_at desc);
alter table test_predictions enable row level security;
revoke all on test_predictions from anon, authenticated;

-- Picks count once the race crosses the line on screen, like season points (migration 007).
create or replace view test_prediction_board as
select
  p.wallet,
  count(*)::int as picks,
  coalesce(sum(p.points), 0)::int as points,
  count(*) filter (where p.position = 1)::int as winners,
  count(*) filter (where p.position in (2, 3))::int as podiums,
  max(p.created_at) as last_pick
from test_predictions p
join test_races r on r.id = p.race_id
where r.status = 'finished' and r.finished_at <= now() and p.position is not null
group by p.wallet;

revoke all on test_prediction_board from anon, authenticated;
