-- Points count once a race crosses the line on screen, not when the server fixes the result.
-- test_races.finished_at now holds that moment (result time + lead-in + race length, see raceEndsAt in core.ts).
create or replace view test_leaderboard as
select
  e.wallet,
  count(*) filter (where e.position is not null)::int as races,
  coalesce(sum(e.points), 0)::int as points,
  count(*) filter (where e.position = 1)::int as wins,
  count(*) filter (where e.position <= 3)::int as podiums,
  max(e.joined_at) as last_race
from test_race_entries e
join test_races r on r.id = e.race_id
where r.status = 'finished' and r.finished_at <= now()
group by e.wallet;

revoke all on test_leaderboard from anon, authenticated;
