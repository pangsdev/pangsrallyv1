-- Online rooms no longer run on a schedule: one room waits per track until all seats are taken
-- by real players (closes_at stays null), then it starts ROOM_FULL_COUNTDOWN_SECONDS later.
-- A seat in a waiting room is slot 0: it holds one race of the day and is given its real
-- day and slot when the race starts.
alter table test_race_entries drop constraint if exists test_race_entries_slot_check;
alter table test_race_entries add constraint test_race_entries_slot_check check (slot >= 0);

create unique index if not exists test_races_one_waiting_room
  on test_races (terrain)
  where kind = 'online' and status = 'open' and closes_at is null;
