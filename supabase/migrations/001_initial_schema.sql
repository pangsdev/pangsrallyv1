-- PangsRally Beta - Initial Database Schema
-- Run this in Supabase SQL Editor

-- ============================================
-- TABLE: users
-- ============================================
CREATE TABLE IF NOT EXISTS users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  wallet_address TEXT UNIQUE NOT NULL,
  username TEXT,
  total_races INTEGER DEFAULT 0,
  total_wins INTEGER DEFAULT 0,
  total_pangs_earned NUMERIC DEFAULT 0,
  referral_code TEXT UNIQUE,
  referred_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  last_active TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_wallet ON users(wallet_address);
CREATE INDEX IF NOT EXISTS idx_users_referral ON users(referral_code);

-- ============================================
-- TABLE: races
-- ============================================
CREATE TABLE IF NOT EXISTS races (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id TEXT NOT NULL,
  map TEXT NOT NULL,
  class TEXT NOT NULL,
  seed TEXT NOT NULL,
  status TEXT DEFAULT 'waiting' CHECK (status IN ('waiting', 'racing', 'finished')),
  prize_pool NUMERIC DEFAULT 0,
  entry_fee NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_races_status ON races(status);
CREATE INDEX IF NOT EXISTS idx_races_created ON races(created_at);

-- ============================================
-- TABLE: race_participants
-- ============================================
CREATE TABLE IF NOT EXISTS race_participants (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  race_id UUID REFERENCES races(id) ON DELETE CASCADE,
  wallet_address TEXT NOT NULL,
  nft_token_id INTEGER NOT NULL,
  nft_name TEXT,
  nft_body_color TEXT,
  position INTEGER,
  finish_time NUMERIC,
  prize_earned NUMERIC DEFAULT 0,
  prize_claimed BOOLEAN DEFAULT false,
  claim_nonce INTEGER,
  claim_tx_hash TEXT,
  joined_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_participants_race ON race_participants(race_id);
CREATE INDEX IF NOT EXISTS idx_participants_wallet ON race_participants(wallet_address);

-- ============================================
-- VIEW: leaderboard
-- ============================================
CREATE OR REPLACE VIEW leaderboard AS
SELECT
  u.wallet_address,
  u.username,
  u.total_races,
  u.total_wins AS wins,
  COALESCE(
    (SELECT COUNT(*) FROM race_participants rp 
     WHERE rp.wallet_address = u.wallet_address AND rp.position <= 3), 0
  ) AS podiums,
  u.total_pangs_earned AS total_earnings
FROM users u
ORDER BY u.total_wins DESC, u.total_pangs_earned DESC;

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE races ENABLE ROW LEVEL SECURITY;
ALTER TABLE race_participants ENABLE ROW LEVEL SECURITY;

-- Public read access for all tables (game data is public)
CREATE POLICY "Allow public read on users" ON users FOR SELECT USING (true);
CREATE POLICY "Allow public read on races" ON races FOR SELECT USING (true);
CREATE POLICY "Allow public read on race_participants" ON race_participants FOR SELECT USING (true);

-- Allow anonymous inserts (frontend will handle writes via anon key)
CREATE POLICY "Allow anon insert on users" ON users FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anon insert on races" ON races FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anon insert on race_participants" ON race_participants FOR INSERT WITH CHECK (true);

-- Allow anonymous updates (for race results, user stats)
CREATE POLICY "Allow anon update on users" ON users FOR UPDATE USING (true);
CREATE POLICY "Allow anon update on races" ON races FOR UPDATE USING (true);
CREATE POLICY "Allow anon update on race_participants" ON race_participants FOR UPDATE USING (true);
