#!/usr/bin/env node
/**
 * Pins the Beta pass artwork and its metadata JSON to IPFS (Pinata) and prints
 * the token URI to pass to the contract. Reads PINATA_JWT from .env (never printed).
 *
 *   node scripts/upload-beta-metadata.mjs            # uploads
 *   node scripts/upload-beta-metadata.mjs --dry-run  # prints the metadata only
 */
import { readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const env = Object.fromEntries(readFileSync(new URL('.env', root), 'utf8').split('\n')
  .map(l => l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)).filter(Boolean)
  .map(([, k, v]) => [k, v.replace(/^["']|["']$/g, '')]));
const dry = process.argv.includes('--dry-run');

const metadata = (image) => ({
  name: 'Pangs Rally Beta',
  description: 'Test Season pass for Pangs Rally, the on-chain pangolin racing game. Free to mint (gas only), one per invited racer. Your racer wears it on the track during the test season.',
  image,
  external_url: 'https://pangsrally.com',
  attributes: [
    { trait_type: 'Edition', value: 'Beta' },
    { trait_type: 'Season', value: 'Test Season 2026' },
    { trait_type: 'Body', value: 'Beta' },
    { trait_type: 'Background', value: 'Lavender' },
  ],
});

if (dry) {
  console.log(JSON.stringify(metadata('ipfs://<image CID>'), null, 2));
  process.exit(0);
}
if (!env.PINATA_JWT) { console.error('PINATA_JWT missing in .env'); process.exit(1); }
const auth = { Authorization: `Bearer ${env.PINATA_JWT}` };

const form = new FormData();
form.append('file', new Blob([readFileSync(new URL('design/beta-nft/beta-lavender.png', root))], { type: 'image/png' }), 'pangs-rally-beta.png');
form.append('pinataMetadata', JSON.stringify({ name: 'pangs-rally-beta.png' }));
const img = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', { method: 'POST', headers: auth, body: form });
if (!img.ok) { console.error(`Image upload failed (${img.status}): ${await img.text()}`); process.exit(1); }
const imageCid = (await img.json()).IpfsHash;

const meta = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
  method: 'POST',
  headers: { ...auth, 'Content-Type': 'application/json' },
  body: JSON.stringify({ pinataContent: metadata(`ipfs://${imageCid}`), pinataMetadata: { name: 'pangs-rally-beta.json' } }),
});
if (!meta.ok) { console.error(`Metadata upload failed (${meta.status}): ${await meta.text()}`); process.exit(1); }
const metaCid = (await meta.json()).IpfsHash;

console.log(`Image:     ipfs://${imageCid}`);
console.log(`Token URI: ipfs://${metaCid}`);
