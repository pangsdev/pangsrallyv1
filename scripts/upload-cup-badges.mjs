#!/usr/bin/env node
/**
 * Pins one Cup's five badge images and their metadata to IPFS (Pinata), as two folders, and prints
 * the folder CID to pass to `npm run cup -- uris`. Token id = cupId * 10 + tier, so Cup #1 is 11-14.
 * Art: design/cup/badges/trophy-{gold,silver,bronze,violet,steel}.png (design/cup/badges/trophy.html).
 * Reads PINATA_JWT from .env (never printed).
 *
 *   node scripts/upload-cup-badges.mjs --id 1          # prints the metadata only
 *   node scripts/upload-cup-badges.mjs --id 1 --send   # uploads
 */
import { readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const env = Object.fromEntries(readFileSync(new URL('.env', root), 'utf8').split('\n')
  .map(l => l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)).filter(Boolean)
  .map(([, k, v]) => [k, v.replace(/^["']|["']$/g, '')]));
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };
const cupId = Number(arg('id'));
if (!(cupId > 0)) { console.error('Usage: --id 1 [--send]'); process.exit(1); }

const TIERS = [
  { tier: 1, art: 'gold', name: 'Champion', place: '1st' },
  { tier: 2, art: 'silver', name: '2nd Place', place: '2nd' },
  { tier: 3, art: 'bronze', name: '3rd Place', place: '3rd' },
  { tier: 4, art: 'violet', name: 'Finalist', place: '4th-10th' },
  { tier: 5, art: 'steel', name: 'Participant' },
];
const metadata = (t, imageCid) => ({
  name: `Pangs Cup #${cupId} ${t.name}`,
  description: t.tier === 5
    ? `Raced in Pangs Cup #${cupId}, the Beta Season tournament of Pangs Rally, the on-chain pangolin racing game. Soulbound: it stays with the wallet that raced. A keepsake with no cash value.`
    : `Won in the Grand Final of Pangs Cup #${cupId}, the Beta Season tournament of Pangs Rally, the on-chain pangolin racing game. Soulbound: it stays with the wallet that raced. A keepsake with no cash value.`,
  image: `ipfs://${imageCid}/${cupId * 10 + t.tier}.png`,
  external_url: 'https://pangsrally.com/cup',
  attributes: [
    { trait_type: 'Cup', value: `Pangs Cup #${cupId}` },
    { trait_type: 'Tier', value: t.name },
    ...(t.tier < 5 ? [{ trait_type: 'Final place', value: t.place }] : []),
    { trait_type: 'Season', value: 'Beta Season 2026' },
    { trait_type: 'Soulbound', value: 'Yes' },
  ],
});

if (!process.argv.includes('--send')) {
  for (const t of TIERS) console.log(`${cupId * 10 + t.tier}.json`, JSON.stringify(metadata(t, '<image folder CID>'), null, 2));
  console.log('\nPreview only. Add --send to upload.');
  process.exit(0);
}
if (!env.PINATA_JWT) { console.error('PINATA_JWT missing in .env'); process.exit(1); }
const auth = { Authorization: `Bearer ${env.PINATA_JWT}` };

async function pinFolder(name, files) {
  const form = new FormData();
  for (const f of files) form.append('file', new Blob([f.data], { type: f.type }), `${name}/${f.path}`);
  form.append('pinataMetadata', JSON.stringify({ name }));
  form.append('pinataOptions', JSON.stringify({ wrapWithDirectory: false }));
  const res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', { method: 'POST', headers: auth, body: form });
  if (!res.ok) { console.error(`${name} upload failed (${res.status}): ${await res.text()}`); process.exit(1); }
  return (await res.json()).IpfsHash;
}

const images = await pinFolder(`pangs-cup-${cupId}-images`, TIERS.map(t => ({
  path: `${cupId * 10 + t.tier}.png`, type: 'image/png', data: readFileSync(new URL(`design/cup/badges/trophy-${t.art}.png`, root)),
})));
const meta = await pinFolder(`pangs-cup-${cupId}-metadata`, TIERS.map(t => ({
  path: `${cupId * 10 + t.tier}.json`, type: 'application/json', data: JSON.stringify(metadata(t, images), null, 2),
})));
console.log(`Images:   ipfs://${images}`);
console.log(`Metadata: ipfs://${meta}`);
console.log(`Next: npm run cup -- uris --contract 0x… --cid ${meta} --id ${cupId} --send`);
