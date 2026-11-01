#!/usr/bin/env node
/**
 * One-time bake of announcer clips into public/audio/announcer/.
 * Vocabulary comes from src/race/announceClips.ts so the game and the
 * bake can never drift apart.
 *
 *   npm run bake:announcer -- --dry-run   list clips + character cost, no API calls
 *   npm run bake:announcer                record missing clips only
 *   npm run bake:announcer -- --force     re-record everything
 *   npm run bake:announcer -- --only=name-   record ids with this prefix
 *
 * Reads ELEVENLABS_API_KEY / ELEVENLABS_VOICE_ID / ELEVENLABS_MODEL_ID from .env.
 * The key is never printed.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public/audio/announcer');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const only = args.find(a => a.startsWith('--only='))?.slice('--only='.length) ?? '';

// Livelier and quicker than the first bake: low stability for a broadcast-caller delivery.
const VOICE_SETTINGS = { stability: 0.28, similarity_boost: 0.8, speed: 1.18 };
const OUTPUT_FORMAT = 'mp3_44100_64';

const { bakeVocabulary } = await loadVocabularyModule();
const vocab = bakeVocabulary().filter(e => e.id.startsWith(only));
const todo = vocab.filter(e => force || !existsSync(join(outDir, `${e.id}.mp3`)));
const chars = todo.reduce((n, e) => n + e.text.length, 0);

console.log(`${vocab.length} clips in vocabulary, ${todo.length} to record (${chars} characters).`);

if (dryRun) {
  for (const e of todo) console.log(`  ${e.id.padEnd(28)} ${e.text}`);
  process.exit(0);
}

mkdirSync(outDir, { recursive: true });

if (todo.length > 0) {
  const env = readEnv(join(root, '.env'));
  const apiKey = env.ELEVENLABS_API_KEY || process.env.ELEVENLABS_API_KEY || '';
  const voiceId = env.ELEVENLABS_VOICE_ID || 'onwK4e9ZLuTAKqWW03F9';
  const modelId = env.ELEVENLABS_MODEL_ID || 'eleven_flash_v2_5';
  if (!apiKey) {
    console.error('ELEVENLABS_API_KEY is not set in .env.');
    process.exit(1);
  }

  let done = 0;
  for (const entry of todo) {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=${OUTPUT_FORMAT}`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({ text: entry.text, model_id: modelId, voice_settings: VOICE_SETTINGS }),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 200);
      console.error(`\nStopped at ${entry.id}: HTTP ${res.status} ${detail}`);
      if ([401, 402, 429].includes(res.status)) break;
      continue;
    }
    writeFileSync(join(outDir, `${entry.id}.mp3`), Buffer.from(await res.arrayBuffer()));
    done++;
    process.stdout.write(`\r  recorded ${done}/${todo.length}`);
    await new Promise(r => setTimeout(r, 150));
  }
  process.stdout.write('\n');
}

// Manifest lists only clips that actually exist, so the client never stitches a gap.
const present = new Set(readdirSync(outDir).filter(f => f.endsWith('.mp3')).map(f => f.slice(0, -4)));
const clips = bakeVocabulary().map(e => e.id).filter(id => present.has(id));
writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify({ version: 1, clips }, null, 2)}\n`);
console.log(`manifest.json: ${clips.length} clips.`);

async function loadVocabularyModule() {
  const cache = join(root, 'node_modules/.cache/bake-announcer');
  mkdirSync(cache, { recursive: true });
  for (const file of ['callNames', 'announceClips']) {
    const src = readFileSync(join(root, 'src/race', `${file}.ts`), 'utf8');
    const { outputText } = ts.transpileModule(src, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
    });
    writeFileSync(join(cache, `${file}.mjs`), outputText.replace(/from '\.\/(\w+)'/g, "from './$1.mjs'"));
  }
  return import(pathToFileURL(join(cache, 'announceClips.mjs')).href);
}

function readEnv(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
}
