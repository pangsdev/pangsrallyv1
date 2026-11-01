-- Supabase migration: add race_rooms table for Online Race mode
CREATE TABLE IF NOT EXISTS race_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_code TEXT NOT NULL UNIQUE,
  map TEXT NOT NULL DEFAULT 'Forest',
  class TEXT NOT NULL DEFAULT 'Class 5',
  max_players INT NOT NULL DEFAULT 5,
  player_count INT NOT NULL DEFAULT 0,
  prize_pool INT NOT NULL DEFAULT 10,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'starting', 'racing', 'finished')),
  seed TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS race_room_players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES race_rooms(id) ON DELETE CASCADE,
  wallet_address TEXT NOT NULL,
  nft_token_id TEXT NOT NULL,
  nft_name TEXT,
  nft_sprite TEXT,
  position INT,
  finish_time FLOAT,
  prize_earned INT DEFAULT 0,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(room_id, wallet_address)
);

-- Enable Realtime on race_rooms and race_room_players
ALTER TABLE race_rooms REPLICA IDENTITY FULL;
ALTER TABLE race_room_players REPLICA IDENTITY FULL;

-- RLS policies
ALTER TABLE race_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE race_room_players ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read race_rooms" ON race_rooms FOR SELECT USING (true);
CREATE POLICY "Anyone can insert race_rooms" ON race_rooms FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update race_rooms" ON race_rooms FOR UPDATE USING (true);

CREATE POLICY "Anyone can read race_room_players" ON race_room_players FOR SELECT USING (true);
CREATE POLICY "Anyone can insert race_room_players" ON race_room_players FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update race_room_players" ON race_room_players FOR UPDATE USING (true);
