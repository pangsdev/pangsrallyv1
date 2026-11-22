-- Weekly Pangs Cup + a rally leaderboard computed in the database.
--
-- 1. Weekly Cups are bigger (Daily Rally turnout is ~250-320 racers) and keep seats for the week's top
--    rally racers (rally_seats). One Cup per start time.
-- 2. The rally leaderboard used to read every rally race into the game server on every page view; this
--    function adds the points up in Postgres and returns one small row per racer.

alter table test_cups drop constraint if exists test_cups_seats_check;
alter table test_cups add constraint test_cups_seats_check check (seats between 2 and 1000);
alter table test_cups add column if not exists rally_seats int not null default 0 check (rally_seats >= 0);
create unique index if not exists test_cups_starts_at_key on test_cups (starts_at);

-- One row per player per rally race that has crossed the line on screen (bots have no wallet).
create or replace view test_rally_placings as
select r.rally_day as day, f->>'wallet' as wallet, (res->>'position')::int as position
from test_races r
cross join lateral jsonb_array_elements(r.field) f
join lateral jsonb_array_elements(r.results) res on res->>'id' = f->>'id'
where r.kind = 'rally' and r.status = 'finished' and r.finished_at <= now()
  and f->>'wallet' is not null;

-- Rally points (25/18/15/12/10/8/6/4/2/1, as POINTS_BY_POSITION) since from_day (null = all time), best first.
create or replace function test_rally_board(from_day date default null)
returns table (wallet text, points int, rallies int, wins int, podiums int)
language sql stable
as $$
  select p.wallet,
    sum(case p.position when 1 then 25 when 2 then 18 when 3 then 15 when 4 then 12 when 5 then 10
      when 6 then 8 when 7 then 6 when 8 then 4 when 9 then 2 when 10 then 1 else 0 end)::int as points,
    count(*)::int as rallies,
    count(*) filter (where p.position = 1)::int as wins,
    count(*) filter (where p.position <= 3)::int as podiums
  from test_rally_placings p
  where from_day is null or p.day >= from_day
  group by p.wallet
  order by points desc, wins desc, podiums desc, wallet asc
$$;

revoke all on test_rally_placings from anon, authenticated;
revoke all on function test_rally_board(date) from public, anon, authenticated;
grant execute on function test_rally_board(date) to service_role;
