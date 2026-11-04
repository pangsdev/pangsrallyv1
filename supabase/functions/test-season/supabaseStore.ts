/** Postgres-backed Store (tables from supabase/migrations/003_test_season.sql … 006_test_scheduled_rooms.sql). */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { EntryRow, LeaderRow, RaceRow, Store } from './core.ts';
import { sortLeaderboard } from './memoryStore.ts';

const UNIQUE_VIOLATION = '23505';

export function createSupabaseStore(db: SupabaseClient): Store {
  const must = <T>(res: { data: T; error: { message: string } | null }): T => {
    if (res.error) throw new Error(res.error.message);
    return res.data;
  };

  return {
    async getSessionWallet(tokenHash, now) {
      const data = must(await db.from('test_sessions').select('wallet, expires_at').eq('token_hash', tokenHash).maybeSingle());
      return data && Date.parse(data.expires_at) > now.getTime() ? data.wallet : null;
    },
    async createSession(tokenHash, wallet, expiresAt) {
      must(await db.from('test_sessions').insert({ token_hash: tokenHash, wallet, expires_at: expiresAt.toISOString() }));
    },
    async upsertPlayer(wallet, now) {
      must(await db.from('test_players').upsert({ wallet, last_seen: now.toISOString() }, { onConflict: 'wallet' }));
    },
    async playerExists(wallet) {
      return !!must(await db.from('test_players').select('wallet').eq('wallet', wallet).maybeSingle());
    },
    async joinWithInvite(wallet, code) {
      const res = await db.rpc('test_join_with_invite', { p_wallet: wallet, p_code: code });
      // Same wallet signing in twice at once: the other request registered it (and kept the place).
      if (res.error?.code === UNIQUE_VIOLATION) return 'exists';
      if (res.error) throw new Error(res.error.message);
      return res.data as 'exists' | 'joined' | 'invalid';
    },
    async inviteIsFull(code) {
      const row = must(await db.from('test_invite_codes').select('uses, max_uses, active').eq('code', code).maybeSingle()) as { uses: number; max_uses: number; active: boolean } | null;
      return !!row && row.active && row.uses >= row.max_uses;
    },
    async getBetaMinted(wallet) {
      const row = must(await db.from('test_players').select('beta_minted_at').eq('wallet', wallet).maybeSingle()) as { beta_minted_at: string | null } | null;
      return !!row?.beta_minted_at;
    },
    async setBetaMinted(wallet, now) {
      must(await db.from('test_players').update({ beta_minted_at: now.toISOString() }).eq('wallet', wallet));
    },
    async countEntriesOnDay(wallet, day) {
      const res = await db.from('test_race_entries').select('race_id', { count: 'exact', head: true }).eq('wallet', wallet).eq('day', day);
      if (res.error) throw new Error(res.error.message);
      return res.count ?? 0;
    },
    async insertRace(race) {
      must(await db.from('test_races').insert(race));
    },
    async deleteRace(id) {
      must(await db.from('test_races').delete().eq('id', id));
    },
    async insertEntry(entry) {
      const res = await db.from('test_race_entries').insert(entry);
      if (res.error?.code === UNIQUE_VIOLATION) return 'conflict';
      if (res.error) throw new Error(res.error.message);
      return 'ok';
    },
    async deleteEntry(raceId, wallet) {
      must(await db.from('test_race_entries').delete().eq('race_id', raceId).eq('wallet', wallet));
    },
    async getRace(id) {
      return must(await db.from('test_races').select('*').eq('id', id).maybeSingle()) as RaceRow | null;
    },
    async listEntries(raceId) {
      return must(await db.from('test_race_entries').select('*').eq('race_id', raceId)) as EntryRow[];
    },
    async listOpenRooms(terrain) {
      return must(await db.from('test_races').select('*')
        .eq('kind', 'online').eq('status', 'open').eq('terrain', terrain)
        .order('closes_at', { ascending: true })) as RaceRow[];
    },
    async insertOpenRoom(room) {
      const res = await db.from('test_races').insert(room);
      if (res.error?.code === UNIQUE_VIOLATION) return 'conflict';
      if (res.error) throw new Error(res.error.message);
      return 'ok';
    },
    async openRoomsFor(wallet) {
      const rows = must(await db.from('test_race_entries').select('race:test_races!inner(*)')
        .eq('wallet', wallet).eq('race.kind', 'online').eq('race.status', 'open')) as unknown as { race: RaceRow }[];
      return rows.map(r => r.race);
    },
    async finishRace(id, patch) {
      const rows = must(await db.from('test_races').update({ ...patch, status: 'finished' })
        .eq('id', id).eq('status', 'open').select('id'));
      return (rows ?? []).length > 0;
    },
    async setEntryResult(raceId, wallet, position, points) {
      must(await db.from('test_race_entries').update({ position, points }).eq('race_id', raceId).eq('wallet', wallet));
    },
    async leaderboard(limit) {
      const rows = must(await db.from('test_leaderboard').select('*')
        .order('points', { ascending: false }).order('wins', { ascending: false }).limit(Math.max(limit, 1))) as LeaderRow[];
      return sortLeaderboard(rows).slice(0, limit);
    },
    async getUsernames(wallets) {
      const unique = [...new Set(wallets)];
      if (!unique.length) return {};
      const rows = must(await db.from('test_players').select('wallet, username').in('wallet', unique).not('username', 'is', null)) as { wallet: string; username: string }[];
      return Object.fromEntries(rows.map(r => [r.wallet, r.username]));
    },
    async setUsername(wallet, name) {
      const res = await db.from('test_players').update({ username: name }).eq('wallet', wallet);
      if (res.error?.code === UNIQUE_VIOLATION) return 'taken';
      if (res.error) throw new Error(res.error.message);
      return 'ok';
    },
    async history(wallet, limit) {
      return must(await db.from('test_race_entries').select('*, race:test_races!inner(*)')
        .eq('wallet', wallet).order('joined_at', { ascending: false }).limit(limit)) as unknown as (EntryRow & { race: RaceRow })[];
    },
  };
}
