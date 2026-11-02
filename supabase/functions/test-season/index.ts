/**
 * Supabase Edge Function: test-season game server.
 *
 *   POST /functions/v1/test-season   { "action": "...", ...params }
 *   Authorization: Bearer <session token from the "login" action> (optional for public actions)
 *
 * Deploy (after `npm run sync:server`):
 *   npx supabase functions deploy test-season --no-verify-jwt
 * Secrets: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase;
 *   optional TEST_UNLIMITED_WALLETS = comma-separated wallets exempt from the daily limit (and invites);
 *   optional TEST_OPEN_SIGNUP = 1 lets new wallets join without an invite code;
 *   optional BETA_CONTRACT + BETA_SIGNER_KEY (+ BETA_CHAIN_ID, BETA_RPC_URL) turn on the Beta pass gate.
 */
import { createClient } from '@supabase/supabase-js';
import { verifyMessage } from 'ethers';
import { handle, type Deps } from './core.ts';
import { createSupabaseStore } from './supabaseStore.ts';
import { createBetaGate } from './beta.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-session, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

const deps: Deps = {
  store: createSupabaseStore(db),
  verifyMessage: (message, signature) => verifyMessage(message, signature),
  sha256Hex: async (text) => {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  },
  randomHex: (bytes) => [...crypto.getRandomValues(new Uint8Array(bytes))].map(b => b.toString(16).padStart(2, '0')).join(''),
  uuid: () => crypto.randomUUID(),
  now: () => new Date(),
  unlimitedWallets: new Set((Deno.env.get('TEST_UNLIMITED_WALLETS') ?? '').split(',').map(w => w.trim().toLowerCase()).filter(Boolean)),
  inviteRequired: Deno.env.get('TEST_OPEN_SIGNUP') !== '1',
  beta: createBetaGate((name) => Deno.env.get(name)),
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json(400, { error: 'bad_request' }); }

  const token = req.headers.get('x-session');
  const reply = await handle(deps, String(body.action ?? ''), body, token);
  return json(reply.status, reply.body);
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
