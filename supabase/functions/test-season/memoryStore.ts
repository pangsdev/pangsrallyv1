/**
 * In-memory Store for `npm run dev` and tests. Mirrors the uniqueness rules of
 * supabase/migrations/003_test_season.sql and 004_test_invites.sql so limits behave like production.
 * Data is lost when the dev server restarts.
 */
import { raceOver, type EntryRow, type LeaderRow, type RaceRow, type Store } from './core.ts';

/** `invites`: code → places, e.g. { 'DEV-RALLY': 1000 } so dev sign-in works. */
export function createMemoryStore(invites: Record<string, number> = {}): Store {
  const codes = new Map(Object.entries(invites).map(([code, max]) => [code, { max, uses: 0 }]));
  const betaMinted = new Set<string>();
  const sessions = new Map<string, { wallet: string; expiresAt: number }>();
  const players = new Map<string, { created: string; lastSeen: string }>();
  const usernames = new Map<string, string>();
  const races = new Map<string, RaceRow>();
  let entries: EntryRow[] = [];

  const clone = <T>(v: T): T => (v === null || v === undefined ? v : JSON.parse(JSON.stringify(v)));

  return {
    async getSessionWallet(tokenHash, now) {
      const s = sessions.get(tokenHash);
      return s && s.expiresAt > now.getTime() ? s.wallet : null;
    },
    async createSession(tokenHash, wallet, expiresAt) {
      sessions.set(tokenHash, { wallet, expiresAt: expiresAt.getTime() });
    },
    async upsertPlayer(wallet, now) {
      const p = players.get(wallet);
      players.set(wallet, { created: p?.created ?? now.toISOString(), lastSeen: now.toISOString() });
    },
    async playerExists(wallet) {
      return players.has(wallet);
    },
    async joinWithInvite(wallet, code) {
      if (players.has(wallet)) return 'exists';
      const c = codes.get(code);
      if (!c || c.uses >= c.max) return 'invalid';
      c.uses++;
      const now = new Date().toISOString();
      players.set(wallet, { created: now, lastSeen: now });
      return 'joined';
    },
    async getBetaMinted(wallet) {
      return betaMinted.has(wallet);
    },
    async setBetaMinted(wallet) {
      betaMinted.add(wallet);
    },
    async countEntriesOnDay(wallet, day) {
      return entries.filter(e => e.wallet === wallet && e.day === day).length;
    },
    async insertRace(race) {
      races.set(race.id, clone(race));
    },
    async deleteRace(id) {
      races.delete(id);
      entries = entries.filter(e => e.race_id !== id);
    },
    async insertEntry(entry) {
      const clash = entries.some(e =>
        (e.race_id === entry.race_id && e.wallet === entry.wallet) ||
        (e.wallet === entry.wallet && e.day === entry.day && e.slot === entry.slot));
      if (clash) return 'conflict';
      entries.push(clone(entry));
      return 'ok';
    },
    async deleteEntry(raceId, wallet) {
      entries = entries.filter(e => !(e.race_id === raceId && e.wallet === wallet));
    },
    async getRace(id) {
      return clone(races.get(id) ?? null);
    },
    async listEntries(raceId) {
      return clone(entries.filter(e => e.race_id === raceId));
    },
    async listOpenRooms(terrain) {
      return clone([...races.values()]
        .filter(r => r.kind === 'online' && r.status === 'open' && r.terrain === terrain)
        .sort((a, b) => (a.closes_at ?? '').localeCompare(b.closes_at ?? '')));
    },
    async insertOpenRoom(room) {
      // Mirrors the partial unique index of 006: one open room per track and start time.
      const clash = [...races.values()].some(r => r.kind === 'online' && r.status === 'open' && r.terrain === room.terrain && r.closes_at === room.closes_at);
      if (clash) return 'conflict';
      races.set(room.id, clone(room));
      return 'ok';
    },
    async openRoomsFor(wallet) {
      const ids = new Set(entries.filter(e => e.wallet === wallet).map(e => e.race_id));
      return clone([...races.values()].filter(r => ids.has(r.id) && r.kind === 'online' && r.status === 'open'));
    },
    async finishRace(id, patch) {
      const r = races.get(id);
      if (!r || r.status !== 'open') return false;
      races.set(id, { ...r, ...clone(patch), status: 'finished' });
      return true;
    },
    async setEntryResult(raceId, wallet, position, points) {
      const e = entries.find(x => x.race_id === raceId && x.wallet === wallet);
      if (e) { e.position = position; e.points = points; }
    },
    async leaderboard(limit, now) {
      const by = new Map<string, LeaderRow>();
      for (const e of entries) {
        const race = races.get(e.race_id);
        if (!race || !raceOver(race, now)) continue;
        const row = by.get(e.wallet) ?? { wallet: e.wallet, races: 0, points: 0, wins: 0, podiums: 0, last_race: null };
        if (e.position !== null) {
          row.races++;
          row.points += e.points;
          if (e.position === 1) row.wins++;
          if (e.position <= 3) row.podiums++;
        }
        if (!row.last_race || e.joined_at > row.last_race) row.last_race = e.joined_at;
        by.set(e.wallet, row);
      }
      return sortLeaderboard([...by.values()]).slice(0, limit);
    },
    async getUsernames(wallets) {
      return Object.fromEntries(wallets.filter(w => usernames.has(w)).map(w => [w, usernames.get(w)!]));
    },
    async setUsername(wallet, name) {
      for (const [w, n] of usernames) if (w !== wallet && n.toLowerCase() === name.toLowerCase()) return 'taken';
      usernames.set(wallet, name);
      return 'ok';
    },
    async history(wallet, limit) {
      return entries
        .filter(e => e.wallet === wallet && races.has(e.race_id))
        .sort((a, b) => b.joined_at.localeCompare(a.joined_at))
        .slice(0, limit)
        .map(e => ({ ...clone(e), race: clone(races.get(e.race_id)!) }));
    },
  };
}

/** Points, then wins, then whoever got there first. Shared with the Postgres store. */
export function sortLeaderboard(rows: LeaderRow[]): LeaderRow[] {
  return rows
    .filter(r => r.races > 0)
    .sort((a, b) => b.points - a.points || b.wins - a.wins || (a.last_race ?? '').localeCompare(b.last_race ?? ''));
}
