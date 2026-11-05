#!/usr/bin/env node
/**
 * Prints the latest bug reports and ideas from the /report page, newest first.
 *
 *   npm run reports
 *   npm run reports -- --limit 50
 *
 * Reads VITE_SUPABASE_URL and SUPABASE_SECRET_KEY from .env (never printed).
 */
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8')
  .split('\n').map(l => l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)).filter(Boolean)
  .map(([, k, v]) => [k, v.replace(/^["']|["']$/g, '')]));
const url = env.VITE_SUPABASE_URL || 'https://rzpcppmzpyocoqnjwrwp.supabase.co';
const key = env.SUPABASE_SECRET_KEY;
if (!key) { console.error('SUPABASE_SECRET_KEY missing in .env'); process.exit(1); }
const i = process.argv.indexOf('--limit');
const limit = i > 0 ? Number(process.argv[i + 1]) : 20;

const res = await fetch(`${url}/rest/v1/test_reports?select=*&order=created_at.desc&limit=${limit}`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` },
});
if (!res.ok) { console.error(`Could not read reports (${res.status}).`); process.exit(1); }
const rows = await res.json();
if (!rows.length) console.log('No reports yet.');
for (const r of rows) {
  console.log(`\n[${r.created_at.slice(0, 16).replace('T', ' ')}] ${r.kind} / ${r.area} · ${r.wallet ?? 'signed out'}${r.contact ? ` · ${r.contact}` : ''}${r.page ? ` · ${r.page}` : ''}`);
  console.log(r.message);
}
