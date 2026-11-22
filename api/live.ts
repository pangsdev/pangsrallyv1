/**
 * Public game data through Vercel's cache: GET /api/live?a=cup|rally|leaderboard[&page=N][&cupId=N].
 *
 * Every visitor of the Cup, Daily Rally and leaderboard pages polls this instead of the Supabase game
 * server. The CDN keeps each answer a few seconds, so however many people watch, Supabase sees about one
 * request per answer per few seconds (its data quota is what ran out in Nov 2026). Only signed-out data:
 * no session goes through here; the pages work out "me" from the wallet lists in the reply.
 */
export const config = { runtime: 'edge' };

const GAME_SERVER = 'https://rzpcppmzpyocoqnjwrwp.supabase.co/functions/v1/test-season';
/** Seconds the CDN keeps an answer. */
const TTL: Record<string, number> = { cup: 4, rally: 4, leaderboard: 30 };

const json = (body: string, status: number, cache: string) =>
  new Response(body, { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=0, must-revalidate', 'Vercel-CDN-Cache-Control': cache } });

export default async function handler(req: Request): Promise<Response> {
  const q = new URL(req.url).searchParams;
  const action = q.get('a') ?? '';
  const ttl = TTL[action];
  if (!ttl) return json(JSON.stringify({ error: 'unknown_action', message: 'Unknown action.' }), 404, 'no-store');
  const body: Record<string, unknown> = { action };
  const page = Number(q.get('page'));
  if (action === 'leaderboard' && Number.isInteger(page) && page > 0 && page < 10_000) body.page = page;
  const cupId = Number(q.get('cupId'));
  if (action === 'cup' && Number.isInteger(cupId) && cupId > 0 && cupId < 100_000) body.cupId = cupId;
  try {
    const res = await fetch(GAME_SERVER, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const text = await res.text();
    // Keep good answers (and "no Cup" 404s) briefly; never cache a server error.
    const cache = res.ok || res.status === 404 ? `max-age=${ttl}, stale-while-revalidate=${ttl * 3}` : 'no-store';
    return json(text, res.status, cache);
  } catch {
    return json(JSON.stringify({ error: 'unavailable', message: 'The race server is not available right now.' }), 503, 'no-store');
  }
}
