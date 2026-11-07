/**
 * Race caller. Speaks when the standings actually change — same seed +
 * field always produces the same calls (replay-ready). Racers are called by
 * their saddle number ("Number 7"), the same number the HUD shows.
 * All wording lives in LINES (announceClips.ts) so every line can be baked
 * as one complete recorded sentence.
 */
import type { RaceSimulation } from './simulation';
import { LINES } from './announceClips';

export type UiRacePhase = 'loading' | 'countdown' | 'running' | 'finished';

export interface CommentaryCall {
  id: string;
  text: string;
  priority: number;
  at: number;
  /** a plain line whose clip may be played when this one has not been recorded */
  fallback?: string;
}

export interface CommentaryState {
  lastAt: number;
  lastLeaderId: string | null;
  lastLeaderAt: number;
  playerBest: number;
  stumbled: Set<string>;
  flags: Set<string>;
  /** burst reactions so far, and when the last one was */
  bursts: number;
  lastBurstAt: number;
}

export function createCommentaryState(): CommentaryState {
  return {
    lastAt: -99,
    lastLeaderId: null,
    lastLeaderAt: -99,
    playerBest: 99,
    stumbled: new Set(),
    flags: new Set(),
    bursts: 0,
    lastBurstAt: -99,
  };
}

export interface CommentaryContext {
  sim: RaceSimulation;
  uiPhase: UiRacePhase;
  countdown: number;
  seed: string;
  terrain: string;
  /** A Pangs Cup race: the line-up and the winner's call name the round. */
  cup?: CupCallInfo | null;
}

export interface CupCallInfo {
  round: number;
  final: boolean;
}

/** The pre-race line (also warmed before the countdown, so it plays on time). */
export function lineUpLine(terrain: string, cup?: CupCallInfo | null): string {
  if (cup?.final) return LINES.cupFinalLineUp();
  if (cup) return LINES.cupLineUp(cup.round === 1);
  return LINES.lineUp(terrainName(terrain));
}

const COOLDOWN = 3.2;
/** Lead (metres) under which the caller says "narrow lead" (about two lengths). */
const NARROW_LEAD_M = 5;
/** Burst reactions colour the race; they must not bury the calls that matter. */
const MAX_BURST_CALLS = 3;
const BURST_CALL_GAP = 5;
/** A burst is called only while it has this long left, so the words land on the speed-up. */
const BURST_MIN_LEFT = 0.6;
/** Bursts at the back of the field are left out, except the player's. */
const BURST_MAX_POSITION = 5;

export function considerCall(state: CommentaryState, ctx: CommentaryContext): CommentaryCall | null {
  const { sim, uiPhase, terrain, cup } = ctx;
  const t = sim.started ? sim.time : 0;

  // Pre-race: one line. The 3-2-1 on screen already does the rest.
  if (uiPhase === 'countdown' && !state.flags.has('set')) {
    return emit(state, 'set', 5, t, lineUpLine(terrain, cup), cup ? LINES.lineUp(terrainName(terrain)) : undefined);
  }
  if (uiPhase !== 'running' && uiPhase !== 'finished') return null;

  const sorted = sim.standings();
  const leader = sorted[0];
  const second = sorted[1];
  if (!leader) return null;

  const gap = second ? Math.max(0, leader.distance - second.distance) : 0;
  const leadPct = leader.distance / sim.totalDistance;
  const player = sim.racers.find(r => r.isPlayer) ?? null;

  if (sim.started && t < 1.4 && !state.flags.has('off')) {
    return emit(state, 'off', 10, t, LINES.off());
  }

  const firstHome = sorted.find(r => r.finishTime !== null);
  if (firstHome && !state.flags.has('winner')) {
    const photo = second?.finishTime !== null && Math.abs((firstHome.finishTime ?? 0) - (second?.finishTime ?? 0)) < 0.18;
    const line = cup?.final ? LINES.cupChampion(firstHome.number)
      : cup ? LINES.cupWins(firstHome.number)
      : photo ? LINES.winsByNose(firstHome.number) : LINES.wins(firstHome.number);
    return emit(state, 'winner', 10, t, line, cup ? LINES.wins(firstHome.number) : undefined);
  }

  if (player && player.finishTime !== null && player.position > 1 && !state.flags.has('youhome')) {
    return emit(state, 'youhome', 8, t, LINES.comesHome(player.position));
  }

  if (!canSpeak(state, t, 5)) return null;

  if (leadPct > 0.9 && !leader.finishTime && second && !second.finishTime && gap < 2.4 && !state.flags.has('photo')) {
    return emit(state, 'photo', 8, t, LINES.tooClose(leader.number));
  }

  if (leadPct > 0.78 && !state.flags.has('stretch')) {
    return emit(state, 'stretch', 7, t, LINES.turnsHome(leader.number, !second || gap < NARROW_LEAD_M));
  }

  if (state.bursts < MAX_BURST_CALLS && t - state.lastBurstAt >= BURST_CALL_GAP && canSpeak(state, t, 5)) {
    const hot = sorted.filter(r => r.burstLeft > BURST_MIN_LEFT && r.finishTime === null && (r.isPlayer || r.position <= BURST_MAX_POSITION));
    const racer = hot.find(r => r.isPlayer) ?? hot[0];
    if (racer) {
      const v = state.bursts + racer.number;
      state.bursts++;
      state.lastBurstAt = t;
      return emit(state, `burst-${racer.id}-${Math.floor(t)}`, 5, t, racer.isPlayer ? LINES.youBurst(v) : LINES.burst(racer.number, v));
    }
  }

  if (leadPct > 0.48 && leadPct < 0.72 && !state.flags.has('halfway')) {
    return emit(state, 'halfway', 5, t, LINES.halfway(leader.number));
  }

  if (state.lastLeaderId && leader.id !== state.lastLeaderId && t > 2 && t - state.lastLeaderAt > 2.8) {
    state.lastLeaderId = leader.id;
    state.lastLeaderAt = t;
    return emit(state, `lead-${leader.id}-${Math.floor(t)}`, 6, t, LINES.takesLead(leader.number));
  }

  if (!state.lastLeaderId && t > 1.5) {
    state.lastLeaderId = leader.id;
    state.lastLeaderAt = t;
    if (!state.flags.has('earlylead')) {
      return emit(state, 'earlylead', 5, t, LINES.breaksOnTop(leader.number));
    }
  }

  if (
    player &&
    player.position <= 3 &&
    t > 3 &&
    !player.finishTime &&
    player.position < state.playerBest &&
    !state.flags.has(`you-${player.position}`)
  ) {
    state.playerBest = player.position;
    return emit(state, `you-${player.position}`, 6, t, LINES.chargesUp(player.position));
  }
  if (player && player.position < state.playerBest) state.playerBest = player.position;

  if (leader.stumbleLeft > 0.35 && !state.stumbled.has(leader.id) && canSpeak(state, t, 5)) {
    state.stumbled.add(leader.id);
    return emit(state, `stumble-${leader.id}`, 6, t, LINES.stumbles(leader.number));
  }

  return null;
}

function terrainName(terrain: string): string {
  return (terrain || 'Forest').trim().replace(/\s*track$/i, '');
}

function canSpeak(state: CommentaryState, t: number, priority: number): boolean {
  if (priority >= 9) return true;
  return t - state.lastAt >= (priority >= 7 ? 1.8 : COOLDOWN);
}

function emit(state: CommentaryState, flag: string, priority: number, at: number, text: string, fallback?: string): CommentaryCall {
  state.flags.add(flag);
  state.lastAt = at;
  return { id: `${flag}-${Math.round(at * 100)}`, text, priority, at, fallback };
}
