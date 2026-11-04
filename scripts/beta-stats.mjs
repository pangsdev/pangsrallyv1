#!/usr/bin/env node
/**
 * Beta season numbers, read from the live database (read only).
 *
 *   npm run beta:stats
 *
 * Reads VITE_SUPABASE_URL and SUPABASE_SECRET_KEY from .env (never printed).
 * Prints counts and invite code usage only, no wallet addresses.
 */
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8')
  .split('\n').map(l => l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)).filter(Boolean)
  .map(([, k, v]) => [k, v.replace(/^["']|["']$/g, '')]));
const url = env.VITE_SUPABASE_URL || 'https://rzpcppmzpyocoqnjwrwp.supabase.co';
const key = env.SUPABASE_SECRET_KEY;
if (!key) { console.error('SUPABASE_SECRET_KEY missing in .env'); process.exit(1); }
const headers = { apikey: key, Authorization: `Bearer ${key}` };

async function get(path, extra = {}) {
  const res = await fetch(`${url}/rest/v1/${path}`, { headers: { ...headers, ...extra } });
  if (!res.ok) { console.error(`Failed ${path} (${res.status}): ${await res.text()}`); process.exit(1); }
  return res;
}
const count = async (path) => Number((await get(path, { Prefer: 'count=exact', Range: '0-0' })).headers.get('content-range')?.split('/')[1] ?? 0);

const since = (h) => encodeURIComponent(new Date(Date.now() - h * 3600_000).toISOString());
const players = await count('test_players?select=wallet');
const minted = await count('test_players?select=wallet&beta_minted_at=not.is.null');
const named = await count('test_players?select=wallet&username=not.is.null');
const new24 = await count(`test_players?select=wallet&created_at=gte.${since(24)}`);
const active24 = await count(`test_players?select=wallet&last_seen=gte.${since(24)}`);
const races = await count('test_races?select=id');
const bot = await count('test_races?select=id&kind=eq.bot');
const online = await count('test_races?select=id&kind=eq.online');
const races24 = await count(`test_races?select=id&created_at=gte.${since(24)}`);

console.log('Beta season');
console.log(`  Registered players : ${players}  (+${new24} in the last 24h)`);
console.log(`  Active last 24h    : ${active24}`);
console.log(`  Minted Beta pass   : ${minted}`);
console.log(`  Picked a name      : ${named}`);
console.log(`  Races              : ${races}  (bot ${bot}, online ${online}; ${races24} in the last 24h)`);

const codes = await (await get('test_invite_codes?select=code,max_uses,uses,note,active,created_at&order=created_at.asc')).json();
console.log('\nInvite codes');
for (const c of codes) {
  const left = c.max_uses - c.uses;
  console.log(`  ${c.code.padEnd(14)} ${String(c.uses).padStart(3)}/${String(c.max_uses).padEnd(3)} used  ${left > 0 ? `${left} left` : 'FULL'}${c.active ? '' : '  (off)'}${c.note ? `  ${c.note}` : ''}`);
}
