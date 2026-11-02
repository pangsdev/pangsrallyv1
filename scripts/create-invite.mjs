#!/usr/bin/env node
/**
 * Creates a test-season invite code in the live database.
 *
 *   npm run invite:create -- --uses 30 --note "First 30 testers"
 *   npm run invite:create -- --code RALLY-FRIENDS --uses 5
 *
 * Reads VITE_SUPABASE_URL and SUPABASE_SECRET_KEY from .env (never printed).
 * Prints only the code and its share link.
 */
import { readFileSync } from 'node:fs';
import { randomInt } from 'node:crypto';

const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8')
  .split('\n').map(l => l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)).filter(Boolean)
  .map(([, k, v]) => [k, v.replace(/^["']|["']$/g, '')]));
const url = env.VITE_SUPABASE_URL || 'https://rzpcppmzpyocoqnjwrwp.supabase.co';
const key = env.SUPABASE_SECRET_KEY;
if (!key) { console.error('SUPABASE_SECRET_KEY missing in .env'); process.exit(1); }

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
// No 0/O, 1/I/L: codes get read out and typed by hand.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const code = (arg('code') || `RALLY-${Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')}`).toUpperCase();
const uses = Number(arg('uses', '30'));
if (!/^[A-Z0-9-]{4,32}$/.test(code) || !(uses >= 1)) { console.error('Bad --code or --uses'); process.exit(1); }

const res = await fetch(`${url}/rest/v1/test_invite_codes`, {
  method: 'POST',
  headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
  body: JSON.stringify({ code, max_uses: uses, note: arg('note', null) }),
});
if (!res.ok) { console.error(`Failed (${res.status}): ${await res.text()}`); process.exit(1); }
console.log(`Invite code: ${code}  (${uses} places)`);
console.log(`Share link:  https://pangsrally.com/?invite=${code}`);
