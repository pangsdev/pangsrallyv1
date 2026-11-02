/**
 * Browser client for the test-season server (supabase/functions/test-season).
 * Dev talks to the Vite stand-in at /api/test-season; production to the Edge Function.
 */
import { BrowserProvider } from 'ethers';
import { signInMessage, type TestRacer, type TestRaceResult } from '../race/testSeason';

/** The Supabase project's public URL (not a secret). Used when the host sets no VITE_SUPABASE_URL. */
const PROJECT_URL = 'https://rzpcppmzpyocoqnjwrwp.supabase.co';
const BASE: string = import.meta.env.VITE_TEST_SEASON_API
  || (import.meta.env.DEV ? '/api/test-season' : `${import.meta.env.VITE_SUPABASE_URL || PROJECT_URL}/functions/v1/test-season`);
const UNAVAILABLE = 'The race server is not available right now. Please try again in a few minutes.';
const SESSION_KEY = 'pangsrally_test_session';

export interface PlayerStatus {
  wallet: string;
  racesToday: number;
  dailyLimit: number;
  racesLeft: number;
  unlimited: boolean;
  points: number;
  races: number;
  wins: number;
  podiums: number;
  rank: number | null;
  resetsAt: string;
}

export interface RacePlayer {
  wallet: string;
  name: string;
  position: number | null;
  points: number;
}

export interface PublicRace {
  id: string;
  kind: 'bot' | 'online';
  terrain: string;
  status: 'open' | 'finished';
  createdAt: string;
  closesAt: string | null;
  finishedAt: string | null;
  seed: string | null;
  field: TestRacer[] | null;
  results: TestRaceResult[] | null;
  players: RacePlayer[];
  maxPlayers: number;
}

export interface LeaderboardPlayer {
  rank: number;
  wallet: string;
  name: string;
  points: number;
  races: number;
  wins: number;
  podiums: number;
}

export interface HistoryRow {
  raceId: string;
  kind: 'bot' | 'online';
  terrain: string;
  status: 'open' | 'finished';
  joinedAt: string;
  position: number | null;
  points: number;
}

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

interface Session { token: string; wallet: string }

export function getSession(): Session | null {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    return s && typeof s.token === 'string' && typeof s.wallet === 'string' ? s : null;
  } catch {
    return null;
  }
}

export function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}

async function call<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
  const session = getSession();
  let res: Response;
  try {
    res = await fetch(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(session ? { 'x-session': session.token } : {}) },
      body: JSON.stringify({ action, ...params }),
    });
  } catch {
    throw new ApiError(0, 'network', 'Cannot reach the race server. Check your connection and try again.');
  }
  const body = await res.json().catch(() => null);
  // Our server always answers with JSON { error, message }; anything else (HTML, empty 404/5xx) is the
  // hosting layer saying the function is not there or is down.
  if (!res.ok) {
    if (res.status === 401 && body?.error) clearSession();
    throw new ApiError(res.status, body?.error || 'unavailable', body?.message || UNAVAILABLE);
  }
  if (!body) throw new ApiError(res.status, 'unavailable', UNAVAILABLE);
  return body as T;
}

/** True when a browser wallet (MetaMask, Rabby, …) is injected. */
export function hasWallet(): boolean {
  return typeof window !== 'undefined' && !!(window as unknown as { ethereum?: unknown }).ethereum;
}

/** Opens this page inside the MetaMask mobile app's browser. */
export function metamaskDeepLink(): string {
  return `https://metamask.app.link/dapp/${window.location.host}${window.location.pathname}`;
}

/** Invite code from a shared link (?invite=CODE), if any. */
export function inviteFromUrl(): string | null {
  try { return new URLSearchParams(window.location.search).get('invite'); } catch { return null; }
}

/**
 * Connect the wallet and sign the (free) sign-in message. A wallet that has not joined yet
 * needs an invite code: `askInvite` is called with the reason and returns the code typed in
 * (or null to give up). The same signature is reused for the retry, so nobody signs twice.
 */
export async function signInWithWallet(askInvite: (reason: string) => Promise<string | null>): Promise<PlayerStatus> {
  const eth = (window as unknown as { ethereum?: unknown }).ethereum;
  if (!eth) throw new ApiError(0, 'no_wallet', 'No wallet found. Install MetaMask to join the test season.');
  // Check the server first so nobody is asked to sign a message that cannot be used.
  await call('leaderboard');
  const provider = new BrowserProvider(eth as never);
  await provider.send('eth_requestAccounts', []);
  const signer = await provider.getSigner();
  const address = await signer.getAddress();
  const message = signInMessage(address, new Date().toISOString());
  let signature: string;
  try {
    signature = await signer.signMessage(message);
  } catch {
    throw new ApiError(0, 'sign_rejected', 'Signature cancelled. Sign the message to join the test season.');
  }
  let inviteCode: string | null = inviteFromUrl();
  for (;;) {
    try {
      const res = await call<PlayerStatus & { token: string }>('login', { address, message, signature, ...(inviteCode ? { inviteCode } : {}) });
      try { localStorage.setItem(SESSION_KEY, JSON.stringify({ token: res.token, wallet: res.wallet })); } catch { /* private mode */ }
      const { token: _token, ...status } = res;
      return status;
    } catch (e) {
      if (!(e instanceof ApiError) || (e.code !== 'invite_required' && e.code !== 'invite_invalid')) throw e;
      inviteCode = await askInvite(e.code === 'invite_invalid' && inviteCode ? e.message : '');
      if (!inviteCode) throw new ApiError(0, 'invite_cancelled', 'The test season is invite-only. Ask the Pangs Rally team for a code.');
    }
  }
}

export const testSeason = {
  me: () => call<PlayerStatus>('me'),
  botRace: (terrain: string) => call<PlayerStatus & { race: PublicRace; you: { position: number; points: number } }>('bot-race', { terrain }),
  onlineJoin: (terrain: string) => call<{ race: PublicRace; serverTime: string }>('online-join', { terrain }),
  onlineStatus: (raceId: string) => call<{ race: PublicRace; serverTime: string }>('online-status', { raceId }),
  race: (raceId: string) => call<{ race: PublicRace }>('race', { raceId }),
  history: () => call<{ races: HistoryRow[] }>('history'),
  leaderboard: () => call<{ players: LeaderboardPlayer[] }>('leaderboard'),
};
