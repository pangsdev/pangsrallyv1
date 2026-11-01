import { createClient } from '@supabase/supabase-js';

// Supabase Configuration
// These values will be set from environment variables
// Only a *publishable* key may live here: every VITE_ variable ships in the public JS bundle.
// The test season does not use this client (it talks to the test-season function), so it may be unset;
// createClient throws on an empty key, hence the placeholders — legacy calls then just fail and are caught.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'http://localhost';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'no-public-key-configured';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Database Types
export interface DBUser {
  id: string;
  wallet_address: string;
  username: string | null;
  total_races: number;
  total_wins: number;
  total_pangs_earned: number;
  referral_code: string | null;
  referred_by: string | null;
  created_at: string;
  last_active: string;
}

export interface DBRace {
  id: string;
  room_id: string;
  map: string;
  class: string;
  seed: string;
  status: 'waiting' | 'racing' | 'finished';
  prize_pool: number;
  entry_fee: number;
  created_at: string;
  finished_at: string | null;
}

export interface DBRaceParticipant {
  id: string;
  race_id: string;
  wallet_address: string;
  nft_token_id: number;
  nft_name: string | null;
  nft_body_color: string | null;
  position: number | null;
  finish_time: number | null;
  prize_earned: number;
  prize_claimed: boolean;
  claim_nonce: number | null;
  claim_tx_hash: string | null;
  joined_at: string;
}

export interface LeaderboardEntry {
  wallet_address: string;
  username: string | null;
  total_races: number;
  wins: number;
  podiums: number;
  total_earnings: number;
}

// ---- Helper Functions ----

/**
 * Register or fetch a user by wallet address
 */
export async function upsertUser(walletAddress: string): Promise<DBUser | null> {
  const addr = walletAddress.toLowerCase();
  
  // Try to get existing user first
  const { data: existing } = await supabase
    .from('users')
    .select('*')
    .eq('wallet_address', addr)
    .single();

  if (existing) {
    // Update last_active
    await supabase
      .from('users')
      .update({ last_active: new Date().toISOString() })
      .eq('wallet_address', addr);
    return existing;
  }

  // Create new user
  const { data: newUser, error } = await supabase
    .from('users')
    .insert({ wallet_address: addr })
    .select()
    .single();

  if (error) {
    console.error('Error creating user:', error);
    return null;
  }
  return newUser;
}

/**
 * Create a new race record
 */
export async function createRace(params: {
  roomId: string;
  map: string;
  raceClass: string;
  prizePool: number;
  entryFee: number;
}): Promise<DBRace | null> {
  const seed = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  const { data, error } = await supabase
    .from('races')
    .insert({
      room_id: params.roomId,
      map: params.map,
      class: params.raceClass,
      seed: seed,
      status: 'waiting',
      prize_pool: params.prizePool,
      entry_fee: params.entryFee,
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating race:', error);
    return null;
  }
  return data;
}

/**
 * Add a participant to a race
 */
export async function joinRaceDB(params: {
  raceId: string;
  walletAddress: string;
  nftTokenId: number;
  nftName: string;
  nftBodyColor: string;
}): Promise<DBRaceParticipant | null> {
  const { data, error } = await supabase
    .from('race_participants')
    .insert({
      race_id: params.raceId,
      wallet_address: params.walletAddress.toLowerCase(),
      nft_token_id: params.nftTokenId,
      nft_name: params.nftName,
      nft_body_color: params.nftBodyColor,
    })
    .select()
    .single();

  if (error) {
    console.error('Error joining race:', error);
    return null;
  }
  return data;
}

/**
 * Record race results
 */
export async function finishRace(
  raceId: string,
  results: Array<{ walletAddress: string; position: number; finishTime: number; prizeEarned: number }>
): Promise<boolean> {
  // Update race status
  await supabase
    .from('races')
    .update({ status: 'finished', finished_at: new Date().toISOString() })
    .eq('id', raceId);

  // Update each participant's result
  for (const result of results) {
    await supabase
      .from('race_participants')
      .update({
        position: result.position,
        finish_time: result.finishTime,
        prize_earned: result.prizeEarned,
      })
      .eq('race_id', raceId)
      .eq('wallet_address', result.walletAddress.toLowerCase());
  }

  // Update user stats for the real player
  for (const result of results) {
    const { data: user } = await supabase
      .from('users')
      .select('total_races, total_wins, total_pangs_earned')
      .eq('wallet_address', result.walletAddress.toLowerCase())
      .single();

    if (user) {
      await supabase
        .from('users')
        .update({
          total_races: (user.total_races || 0) + 1,
          total_wins: (user.total_wins || 0) + (result.position === 1 ? 1 : 0),
          total_pangs_earned: (user.total_pangs_earned || 0) + result.prizeEarned,
        })
        .eq('wallet_address', result.walletAddress.toLowerCase());
    }
  }

  return true;
}

/**
 * Fetch leaderboard data
 */
export async function fetchLeaderboard(): Promise<LeaderboardEntry[]> {
  // Try materialized view first, fall back to manual query
  const { data, error } = await supabase
    .from('leaderboard')
    .select('*')
    .order('wins', { ascending: false })
    .limit(50);

  if (error) {
    console.warn('Leaderboard view not available, using fallback:', error);
    // Fallback: query users directly
    const { data: users } = await supabase
      .from('users')
      .select('wallet_address, username, total_races, total_wins, total_pangs_earned')
      .order('total_wins', { ascending: false })
      .limit(50);

    return (users || []).map(u => ({
      wallet_address: u.wallet_address,
      username: u.username,
      total_races: u.total_races || 0,
      wins: u.total_wins || 0,
      podiums: 0,
      total_earnings: u.total_pangs_earned || 0,
    }));
  }

  return data || [];
}

/**
 * Fetch race history for a specific wallet
 */
export async function fetchRaceHistory(walletAddress: string): Promise<any[]> {
  const { data, error } = await supabase
    .from('race_participants')
    .select(`
      *,
      races (*)
    `)
    .eq('wallet_address', walletAddress.toLowerCase())
    .order('joined_at', { ascending: false })
    .limit(20);

  if (error) {
    console.error('Error fetching race history:', error);
    return [];
  }
  return data || [];
}

/**
 * Mark prize as claimed
 */
export async function markPrizeClaimed(raceId: string, walletAddress: string, txHash: string): Promise<boolean> {
  const { error } = await supabase
    .from('race_participants')
    .update({
      prize_claimed: true,
      claim_tx_hash: txHash,
    })
    .eq('race_id', raceId)
    .eq('wallet_address', walletAddress.toLowerCase());

  return !error;
}
