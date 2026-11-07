/**
 * Supabase Edge Function: cup-publish. Runs the Pangs Cup with nobody at the keyboard.
 *
 * Called every minute by pg_cron (migration 014). Each call
 *   1. asks the game server for the latest Cup (`cup` action), which also starts every round that is
 *      due, so rounds begin on time even when nobody has the page open;
 *   2. once the Grand Final has finished, writes the results and the Participant root on chain and
 *      turns on the Claim buttons (publish.ts; safe to repeat).
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

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  const secret = Deno.env.get('CUP_CRON_SECRET');
  if (secret && req.headers.get('x-cron-secret') !== secret) return reply(401, { error: 'unauthorized' });

  try {
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
      status, contract, signer,
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
