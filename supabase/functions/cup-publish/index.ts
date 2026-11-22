/**
 * Supabase Edge Function: cup-publish. Runs the Pangs Cup with nobody at the keyboard.
 *
 * Called every minute by pg_cron (migration 014). Each call
 *   1. asks the game server for the latest Cup (`cup` action), which also starts every round that is
 *      due, so rounds begin on time even when nobody has the page open;
 *   2. once the Grand Final has finished, writes the results and the Participant root on chain and
 *      turns on the Claim buttons (publish.ts; safe to repeat);
 *   3. until this week's Cup exists (weekly Cups, every Sunday 20:00 UTC), asks the game server to schedule it;
 *   4. in the first minutes after 18:00 UTC, asks for the Daily Rally (`rally` action), which draws and
 *      runs that day's rooms, so the rally starts on time even when nobody has the page open.
 *
 * Secrets: CUP_OPERATOR_KEY (the wallet that owns PangsCup; holds only gas), CUP_CONTRACT, optional
 * CUP_RPC_URL. Anyone may call it: it only ever does what is due (start rounds, publish a finished
 * Cup once), so an extra call changes nothing. Optional CUP_CRON_SECRET makes it answer only callers
 * that send it as x-cron-secret.
 * Deploy: supabase functions deploy cup-publish --no-verify-jwt --use-api --project-ref rzpcppmzpyocoqnjwrwp
 */
import { createClient } from '@supabase/supabase-js';
import { JsonRpcProvider, Wallet } from 'ethers';
import { publishCup, type CupStatusReply } from './publish.ts';

const RPC = Deno.env.get('CUP_RPC_URL') ?? 'https://rpc.mainnet.chain.robinhood.com';
const CHAIN_ID = 4663;
const url = Deno.env.get('SUPABASE_URL')!;
const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

/** Sunday 20:00 UTC of the Monday-Sunday (UTC) week that `ms` falls in (same as cup.ts weeklyCupStart). */
function weeklyCupStart(ms: number): number {
  const d = new Date(ms);
  const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - ((d.getUTCDay() + 6) % 7) * 86_400_000;
  return monday + 6 * 86_400_000 + 20 * 3_600_000;
}

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  const secret = Deno.env.get('CUP_CRON_SECRET');
  if (secret && req.headers.get('x-cron-secret') !== secret) return reply(401, { error: 'unauthorized' });

  // Daily Rally start (rally.ts, RALLY_HOUR_UTC = 18): only near the start, and never in the Cup's way.
  const minute = new Date().getUTCHours() * 60 + new Date().getUTCMinutes();
  if (minute >= 18 * 60 && minute < 18 * 60 + 10) {
    try {
      const r = await fetch(`${url}/functions/v1/test-season`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'rally' }),
      });
      console.log(JSON.stringify({ rally: r.status }));
    } catch (e) {
      console.error('rally start', e);
    }
  }

  try {
    // Only wake the game server while a Cup is running or waiting to be published: the full Cup status is
    // large, and asking for it every minute of every day used up the project's data quota.
    const { data: latest, error: cupErr } = await db.from('test_cups')
      .select('id, starts_at, round_minutes, qualifying_rounds, final_gap_minutes, claim_contract')
      .order('id', { ascending: false }).limit(1).maybeSingle();
    if (cupErr) throw new Error(`Reading the latest Cup failed: ${cupErr.message}`);
    if (!latest) return reply(200, { status: 'no-cup' });
    const nowMs = Date.now();
    const start = Date.parse(latest.starts_at);
    const finalAt = start + ((latest.qualifying_rounds - 1) * latest.round_minutes + latest.final_gap_minutes) * 60_000;
    // Weekly Cup: until this week's Cup exists, ask the game server to schedule it (it decides whether the
    // previous Cup is done; WEEKLY_CUP=0 on test-season turns this off).
    const weekCup = weeklyCupStart(nowMs);
    if (Date.parse(latest.starts_at) < weekCup && nowMs < weekCup - 30 * 60_000) {
      try {
        const r = await fetch(`${url}/functions/v1/test-season`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cup-weekly' }),
        });
        console.log(JSON.stringify({ weekly: await r.json() }));
      } catch (e) {
        console.error('weekly cup', e);
      }
    }
    if (latest.claim_contract) return reply(200, { status: 'published', cupId: latest.id });
    if (nowMs < start - 60_000 || nowMs > finalAt + 24 * 3_600_000) return reply(200, { status: 'idle', cupId: latest.id });

    const res = await fetch(`${url}/functions/v1/test-season`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cup' }),
    });
    if (res.status === 404) return reply(200, { status: 'no-cup' });
    const status = await res.json() as CupStatusReply;
    if (!res.ok) return reply(502, { error: 'game server', detail: status });

    const key = Deno.env.get('CUP_OPERATOR_KEY');
    const contract = Deno.env.get('CUP_CONTRACT');
    if (status.cup.state !== 'finished' || status.cup.claimContract) {
      return reply(200, { status: status.cup.claimContract ? 'published' : 'waiting', cupId: status.cup.id, cupState: status.cup.state });
    }
    if (!key || !contract) return reply(500, { error: 'CUP_OPERATOR_KEY or CUP_CONTRACT is not set' });

    const signer = new Wallet(key, new JsonRpcProvider(RPC, CHAIN_ID, { staticNetwork: true }));
    const outcome = await publishCup({
      status, contract, signer, badgeBase: 'https://pangsrally.com/api/cup-badge',
      markPublished: async (cupId, address) => {
        const { error } = await db.from('test_cups').update({ claim_contract: address }).eq('id', cupId);
        if (error) throw new Error(`Saving claim_contract failed: ${error.message}`);
      },
    });
    console.log(JSON.stringify(outcome));
    return reply(outcome.status === 'blocked' ? 409 : 200, outcome);
  } catch (e) {
    console.error(e);
    return reply(500, { error: e instanceof Error ? e.message : String(e) });
  }
});
