-- Racer names chosen on the Profile page. Unique in any letter case; rules live in checkUsername (src/race/testSeason.ts).
alter table test_players add column if not exists username text;
create unique index if not exists test_players_username_lower on test_players (lower(username));
