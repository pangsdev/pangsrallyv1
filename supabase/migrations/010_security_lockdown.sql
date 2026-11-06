-- Security pass after the Supabase advisor flagged public.leaderboard (Nov 2026).
-- No rows are deleted. Only the test-season function (service role) writes game data.

-- 1. Views run with the caller's rights, so they can never step around row level security.
alter view public.leaderboard set (security_invoker = true);
alter view public.test_leaderboard set (security_invoker = true);

-- 2. The old pre-season tables let anyone write. claim-verify trusts race_participants before it signs a prize
--    with the treasury key, so a forged row could get a signature. They are empty and the game no longer writes them.
drop policy if exists "Allow anon update on users" on users;
drop policy if exists "Allow anon insert on users" on users;
drop policy if exists "Allow anon update on races" on races;
drop policy if exists "Allow anon insert on races" on races;
drop policy if exists "Allow anon update on race_participants" on race_participants;
drop policy if exists "Allow anon insert on race_participants" on race_participants;
drop policy if exists "Anyone can update race_rooms" on race_rooms;
drop policy if exists "Anyone can insert race_rooms" on race_rooms;
drop policy if exists "Anyone can update race_room_players" on race_room_players;
drop policy if exists "Anyone can insert race_room_players" on race_room_players;
revoke insert, update, delete, truncate, references, trigger on users, races, race_participants, race_rooms, race_room_players from anon, authenticated;

-- 3. Season tables: row level security already blocks the public keys; remove the grants as a second lock.
revoke all on test_players, test_sessions, test_races, test_race_entries, test_invite_codes, test_reports from anon, authenticated;

-- 4. Rooms used to seed from their public id, so anyone could work out the result early. Waiting rooms get a secret seed.
update test_races
set seed = 'online-' || md5(random()::text || clock_timestamp()::text || id::text)
where kind = 'online' and status = 'open' and seed = 'online-' || id::text;
