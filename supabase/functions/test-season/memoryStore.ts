/**
 * In-memory Store for `npm run dev` and tests. Mirrors the uniqueness rules of
 * supabase/migrations/003_test_season.sql and 004_test_invites.sql so limits behave like production.
 * Data is lost when the dev server restarts.
 */
import type { CupEntryRow, CupRow } from './cup.ts';
import type { RallyDayRow, RallyEntryRow } from './rally.ts';
import { raceOver, type EntryRow, type LeaderRow, type PredictionBoardRow, type PredictionRow, type RaceRow, type ReportRow, type Store } from './core.ts';

/** `invites`: code → places, e.g. { 'DEV-RALLY': 1000 } so dev sign-in works. */
export function createMemoryStore(invites: Record<string, number> = {}): Store {
  const codes = new Map(Object.entries(invites).map(([code, max]) => [code, { max, uses: 0 }]));
  const betaMinted = new Set<string>();
  const sessions = new Map<string, { wallet: string; expiresAt: number }>();
  const players = new Map<string, { created: string; lastSeen: string }>();
  const usernames = new Map<string, string>();
  const races = new Map<string, RaceRow>();
  let entries: EntryRow[] = [];
  const reports: ReportRow[] = [];
  let predictions: PredictionRow[] = [];
  const cups = new Map<number, CupRow>();
  let cupEntries: CupEntryRow[] = [];
  const rallyDays = new Map<string, RallyDayRow>();
  let rallyEntries: RallyEntryRow[] = [];

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
    async raceDays(wallets) {
      const out: Record<string, string[]> = {};
      for (const e of entries) if (e.slot > 0 && wallets.includes(e.wallet)) (out[e.wallet] ??= []).push(e.day);
      return out;
    },
    async racerNumber(wallet, before) {
      const p = players.get(wallet);
      if (!p || (before && Date.parse(p.created) >= before.getTime())) return null;
      return [...players.keys()].indexOf(wallet) + 1;
    },
    async racerNumbers(before) {
      const out: Record<string, number> = {};
      [...players.entries()].forEach(([wallet, p], i) => {
        if (!before || Date.parse(p.created) < before.getTime()) out[wallet] = i + 1;
      });
      return out;
    },
    async inviteIsFull(code) {
      const c = codes.get(code);
      return !!c && c.uses >= c.max;
    },
    async getBetaMinted(wallet) {
      return betaMinted.has(wallet);
    },
    async setBetaMinted(wallet) {
      betaMinted.add(wallet);
    },
    async countEntriesOnDay(wallet, day) {
      return entries.filter(e => e.wallet === wallet && e.day === day && e.slot > 0).length;
    },
    async heldSeats(wallet, day) {
      return entries.filter(e => e.wallet === wallet && e.day === day && e.slot === 0 && races.get(e.race_id)?.status === 'open').length;
    },
    async chargeSeat(raceId, wallet, day, slot) {
      if (entries.some(e => e.wallet === wallet && e.day === day && e.slot === slot)) return 'conflict';
      entries = entries.map(e => (e.race_id === raceId && e.wallet === wallet ? { ...e, day, slot } : e));
      return 'ok';
    },
    async insertRace(race) {
      races.set(race.id, clone(race));
    },
    async deleteRace(id) {
      races.delete(id);
      entries = entries.filter(e => e.race_id !== id);
      predictions = predictions.filter(p => p.race_id !== id);
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
      // Mirrors the partial unique index of 012: one waiting room per track.
      const clash = [...races.values()].some(r => r.kind === 'online' && r.status === 'open' && r.terrain === room.terrain && r.closes_at === null);
      if (clash) return 'conflict';
      races.set(room.id, clone(room));
      return 'ok';
    },
    async startCountdown(id, closesAt) {
      const r = races.get(id);
      if (r && r.status === 'open' && r.closes_at === null) races.set(id, { ...r, closes_at: closesAt });
    },
    async insertPrediction(row) {
      if (predictions.some(p => p.race_id === row.race_id && p.wallet === row.wallet)) return 'conflict';
      predictions.push(clone(row));
      return 'ok';
    },
    async deletePrediction(raceId, wallet) {
      predictions = predictions.filter(p => !(p.race_id === raceId && p.wallet === wallet));
    },
    async listPredictions(raceId) {
      return clone(predictions.filter(p => p.race_id === raceId));
    },
    async setPredictionResult(raceId, pick, position, points) {
      for (const p of predictions) if (p.race_id === raceId && p.pick === pick) { p.position = position; p.points = points; }
    },
    async predictionsFor(wallet, limit) {
      return predictions
        .filter(p => p.wallet === wallet && races.has(p.race_id))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, limit)
        .map(p => ({ ...clone(p), race: clone(races.get(p.race_id)!) }));
    },
    async predictionBoard(limit, now) {
      const by = new Map<string, PredictionBoardRow>();
      for (const p of predictions) {
        const race = races.get(p.race_id);
        if (!race || !raceOver(race, now) || p.position === null) continue;
        const row = by.get(p.wallet) ?? { wallet: p.wallet, picks: 0, points: 0, winners: 0, podiums: 0, last_pick: null };
        row.picks++;
        row.points += p.points;
        if (p.position === 1) row.winners++;
        else if (p.position <= 3) row.podiums++;
        if (!row.last_pick || p.created_at > row.last_pick) row.last_pick = p.created_at;
        by.set(p.wallet, row);
      }
      return sortPredictionBoard([...by.values()]).slice(0, limit);
    },
    async recentRooms(limit, now) {
      return clone([...races.values()]
        .filter(r => r.kind === 'online' && raceOver(r, now))
        .sort((a, b) => (b.finished_at ?? '').localeCompare(a.finished_at ?? ''))
        .slice(0, limit));
    },
    async insertReport(report) { reports.push(clone(report)); },
    async countReports(since, wallet) { return reports.filter(r => r.created_at >= since && r.wallet === wallet).length; },
    async playerJoinedAt(wallet) {
      return players.get(wallet)?.created ?? null;
    },
    async getCup(id) {
      return clone(cups.get(id) ?? null);
    },
    async latestCup() {
      const top = Math.max(0, ...cups.keys());
      return clone(cups.get(top) ?? null);
    },
    async insertCup(cup) {
      cups.set(cup.id, clone(cup));
    },
    async cupEntries(cupId) {
      return clone(cupEntries.filter(e => e.cup_id === cupId));
    },
    async insertCupEntry(entry) {
      if (!cupEntries.some(e => e.cup_id === entry.cup_id && e.wallet === entry.wallet)) cupEntries.push(clone(entry));
    },
    async deleteCupEntry(cupId, wallet) {
      cupEntries = cupEntries.filter(e => !(e.cup_id === cupId && e.wallet === wallet));
    },
    async cupRaces(cupId) {
      return clone([...races.values()].filter(r => r.cup_id === cupId));
    },
    async getRallyDay(day) {
      return clone(rallyDays.get(day) ?? null);
    },
    async insertRallyDay(row) {
      if (!rallyDays.has(row.day)) rallyDays.set(row.day, clone(row));
    },
    async rallyEntries(day) {
      return clone(rallyEntries.filter(e => e.day === day).sort((a, b) => a.registered_at.localeCompare(b.registered_at)));
    },
    async insertRallyEntry(entry) {
      if (!rallyEntries.some(e => e.day === entry.day && e.wallet === entry.wallet)) rallyEntries.push(clone(entry));
    },
    async deleteRallyEntry(day, wallet) {
      rallyEntries = rallyEntries.filter(e => !(e.day === day && e.wallet === wallet));
    },
    async rallyRaces(day) {
      return clone([...races.values()].filter(r => r.kind === 'rally' && (day === null || r.rally_day === day)));
    },
    async insertRallyRace(race) {
      // Mirrors the unique index of 015: one race per rally day and room.
      if ([...races.values()].some(r => r.kind === 'rally' && r.rally_day === race.rally_day && r.rally_room === race.rally_room)) return 'conflict';
      races.set(race.id, clone(race));
      return 'ok';
    },
    async insertCupRace(race) {
      // Mirrors the unique index of 013: one race per Cup round and room.
      if ([...races.values()].some(r => r.cup_id === race.cup_id && r.cup_round === race.cup_round && r.cup_room === race.cup_room)) return 'conflict';
      races.set(race.id, clone(race));
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

/** Points, then called winners, then fewer picks, then whoever got there first. Shared with the Postgres store. */
export function sortPredictionBoard(rows: PredictionBoardRow[]): PredictionBoardRow[] {
  return rows
    .filter(r => r.picks > 0)
    .sort((a, b) => b.points - a.points || b.winners - a.winners || a.picks - b.picks || (a.last_pick ?? '').localeCompare(b.last_pick ?? ''));
}

/** Points, then wins, then whoever got there first. Shared with the Postgres store. */
export function sortLeaderboard(rows: LeaderRow[]): LeaderRow[] {
  return rows
    .filter(r => r.races > 0)
    .sort((a, b) => b.points - a.points || b.wins - a.wins || (a.last_race ?? '').localeCompare(b.last_race ?? ''));
}
