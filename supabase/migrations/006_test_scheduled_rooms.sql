-- Online rooms are made by the game on a schedule (ROOM_SLOT_MINUTES in src/race/testSeason.ts).
-- At most one open room per track and start time, so parallel requests cannot make duplicates;
-- a room that fills up is finished at once, which frees its start time for a new room.
create unique index if not exists test_races_one_open_room_per_slot
  on test_races (terrain, closes_at)
  where kind = 'online' and status = 'open';
