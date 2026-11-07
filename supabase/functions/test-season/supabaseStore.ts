/** Postgres-backed Store (tables from supabase/migrations/003_test_season.sql … 006_test_scheduled_rooms.sql). */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CupEntryRow, CupRow } from './cup.ts';
import type { EntryRow, LeaderRow, PredictionBoardRow, PredictionRow, RaceRow, Store } from './core.ts';
import { sortLeaderboard, sortPredictionBoard } from './memoryStore.ts';

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
    async raceDays(wallets) {
      const unique = [...new Set(wallets)];
      const out: Record<string, string[]> = {};
      if (!unique.length) return out;
      // The API returns at most 1000 rows per call, so read in pages; (wallet, day, slot) is unique, so the order is stable.
      for (let from = 0; ; from += 1000) {
        const rows = must(await db.from('test_race_entries').select('wallet, day').in('wallet', unique).gt('slot', 0)
          .order('wallet').order('day').order('slot').range(from, from + 999)) as { wallet: string; day: string }[];
        for (const r of rows) (out[r.wallet] ??= []).push(r.day);
        if (rows.length < 1000) return out;
      }
    },
    async racerNumber(wallet, before) {
      const row = must(await db.from('test_players').select('created_at').eq('wallet', wallet).maybeSingle()) as { created_at: string } | null;
      if (!row || (before && Date.parse(row.created_at) >= before.getTime())) return null;
      const earlier = await db.from('test_players').select('wallet', { count: 'exact', head: true }).lt('created_at', row.created_at);
      if (earlier.error) throw new Error(earlier.error.message);
      return (earlier.count ?? 0) + 1;
    },
    async racerNumbers(before) {
      const out: Record<string, number> = {};
      // The API returns at most 1000 rows per call, so read in pages.
      for (let from = 0; ; from += 1000) {
        const rows = must(await db.from('test_players').select('wallet, created_at').order('created_at').order('wallet').range(from, from + 999)) as { wallet: string; created_at: string }[];
        rows.forEach((r, i) => {
          if (!before || Date.parse(r.created_at) < before.getTime()) out[r.wallet] = from + i + 1;
        });
        if (rows.length < 1000) return out;
      }
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
      const res = await db.from('test_race_entries').select('race_id', { count: 'exact', head: true }).eq('wallet', wallet).eq('day', day).gt('slot', 0);
      if (res.error) throw new Error(res.error.message);
      return res.count ?? 0;
    },
    async heldSeats(wallet) {
      const rows = must(await db.from('test_race_entries').select('race_id, race:test_races!inner(status)')
        .eq('wallet', wallet).eq('slot', 0).eq('race.status', 'open')) as unknown[];
      return rows.length;
    },
    async chargeSeat(raceId, wallet, day, slot) {
      const res = await db.from('test_race_entries').update({ day, slot }).eq('race_id', raceId).eq('wallet', wallet);
      if (res.error?.code === UNIQUE_VIOLATION) return 'conflict';
      if (res.error) throw new Error(res.error.message);
      return 'ok';
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
    async startCountdown(id, closesAt) {
      must(await db.from('test_races').update({ closes_at: closesAt }).eq('id', id).eq('status', 'open').is('closes_at', null));
    },
    async insertPrediction(row) {
      const res = await db.from('test_predictions').insert(row);
      if (res.error?.code === UNIQUE_VIOLATION) return 'conflict';
      if (res.error) throw new Error(res.error.message);
      return 'ok';
    },
    async deletePrediction(raceId, wallet) {
      must(await db.from('test_predictions').delete().eq('race_id', raceId).eq('wallet', wallet));
    },
    async listPredictions(raceId) {
      return must(await db.from('test_predictions').select('*').eq('race_id', raceId)) as PredictionRow[];
    },
    async setPredictionResult(raceId, pick, position, points) {
      must(await db.from('test_predictions').update({ position, points }).eq('race_id', raceId).eq('pick', pick));
    },
    async predictionsFor(wallet, limit) {
      return must(await db.from('test_predictions').select('*, race:test_races!inner(*)')
        .eq('wallet', wallet).order('created_at', { ascending: false }).limit(limit)) as unknown as (PredictionRow & { race: RaceRow })[];
    },
    async predictionBoard(limit) {
      const rows = must(await db.from('test_prediction_board').select('*')
        .order('points', { ascending: false }).order('winners', { ascending: false }).limit(Math.max(limit, 1))) as PredictionBoardRow[];
      return sortPredictionBoard(rows).slice(0, limit);
    },
    async recentRooms(limit, now) {
      return must(await db.from('test_races').select('*').eq('kind', 'online').eq('status', 'finished')
        .lte('finished_at', now.toISOString()).order('finished_at', { ascending: false }).limit(limit)) as RaceRow[];
    },
    async insertReport(report) { must(await db.from('test_reports').insert(report)); },
    async countReports(since, wallet) {
      const q = db.from('test_reports').select('id', { count: 'exact', head: true }).gte('created_at', since);
      const { count, error } = await (wallet ? q.eq('wallet', wallet) : q.is('wallet', null));
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
    async playerJoinedAt(wallet) {
      const row = must(await db.from('test_players').select('created_at').eq('wallet', wallet).maybeSingle()) as { created_at: string } | null;
      return row?.created_at ?? null;
    },
    async getCup(id) {
      return must(await db.from('test_cups').select('*').eq('id', id).maybeSingle()) as CupRow | null;
    },
    async latestCup() {
      return must(await db.from('test_cups').select('*').order('id', { ascending: false }).limit(1).maybeSingle()) as CupRow | null;
    },
    async insertCup(cup) {
      must(await db.from('test_cups').insert(cup));
    },
    async cupEntries(cupId) {
      return must(await db.from('test_cup_entries').select('*').eq('cup_id', cupId).order('registered_at')) as CupEntryRow[];
    },
    async insertCupEntry(entry) {
      const res = await db.from('test_cup_entries').insert(entry);
      if (res.error && res.error.code !== UNIQUE_VIOLATION) throw new Error(res.error.message);
    },
    async deleteCupEntry(cupId, wallet) {
      must(await db.from('test_cup_entries').delete().eq('cup_id', cupId).eq('wallet', wallet));
    },
    async cupRaces(cupId) {
      return must(await db.from('test_races').select('*').eq('cup_id', cupId)) as RaceRow[];
    },
    async insertCupRace(race) {
      const res = await db.from('test_races').insert(race);
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
