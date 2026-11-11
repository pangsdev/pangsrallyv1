import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { verifyMessage } from 'ethers'
import { handle, type Deps } from './supabase/functions/test-season/core.ts'
import { createMemoryStore } from './supabase/functions/test-season/memoryStore.ts'
import { createBetaGate } from './supabase/functions/test-season/beta.ts'
import { newCup } from './supabase/functions/test-season/cup.ts'

const MAX_CHARS = 160

function announcePlugin(env: Record<string, string>) {
  const handler = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = req.url?.split('?')[0] || ''
    if (url !== '/api/race-announce') return next()

    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      res.end()
      return
    }
    if (req.method !== 'POST') {
      res.statusCode = 405
      res.end()
      return
    }

    const apiKey = env.ELEVENLABS_API_KEY || ''
    const voiceId = env.ELEVENLABS_VOICE_ID || 'onwK4e9ZLuTAKqWW03F9'
    const modelId = env.ELEVENLABS_MODEL_ID || 'eleven_flash_v2_5'
    if (!apiKey) {
      res.statusCode = 503
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: 'Announce is not configured' }))
      return
    }

    try {
      const raw = await readBody(req)
      const text = String(JSON.parse(raw || '{}').text || '').trim()
      if (!text || text.length > MAX_CHARS) {
        res.statusCode = 400
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'Invalid text' }))
        return
      }

      const eleven = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: modelId,
          output_format: 'mp3_22050_32',
          voice_settings: {
            stability: 0.38,
            similarity_boost: 0.8,
            speed: 1.12,
          },
        }),
      })

      if (!eleven.ok) {
        res.statusCode = eleven.status === 401 || eleven.status === 402 || eleven.status === 429
          ? eleven.status
          : 502
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'Voice unavailable' }))
        return
      }

      const buf = Buffer.from(await eleven.arrayBuffer())
      res.statusCode = 200
      res.setHeader('Content-Type', 'audio/mpeg')
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      res.end(buf)
    } catch {
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: 'Announce failed' }))
    }
  }

  return {
    name: 'race-announce-proxy',
    configureServer(server: { middlewares: { use: Function } }) {
      server.middlewares.use(handler)
    },
    configurePreviewServer(server: { middlewares: { use: Function } }) {
      server.middlewares.use(handler)
    },
  }
}

/**
 * Dev-only stand-in for the `test-season` Edge Function: the same game logic
 * (supabase/functions/test-season/core.ts) on an in-memory store, so sign-in,
 * races and the leaderboard work under `npm run dev` without Supabase.
 * Restarting the dev server wipes it. Set VITE_TEST_SEASON_API to hit the real function instead.
 * Invite codes in dev: off unless DEV_INVITE_GATE=1, then DEV-RALLY (or TEST_DEV_INVITE from .env).
 */
function testSeasonDevPlugin(env: Record<string, string>) {
  const deps: Deps = {
    store: createMemoryStore({ [env.TEST_DEV_INVITE || 'DEV-RALLY']: 1000 }),
    verifyMessage,
    sha256Hex: async (t) => createHash('sha256').update(t).digest('hex'),
    randomHex: (n) => randomBytes(n).toString('hex'),
    uuid: () => randomUUID(),
    now: () => new Date(),
    predictions: true,
    unlimitedWallets: new Set((env.TEST_UNLIMITED_WALLETS || '').split(',').map(w => w.trim().toLowerCase()).filter(Boolean)),
    // Local testing: any wallet signs in without a code (the live invite codes only exist in the live
    // database). DEV_INVITE_GATE=1 brings the invite step back, with the code DEV-RALLY.
    inviteRequired: env.DEV_INVITE_GATE === '1' && env.TEST_OPEN_SIGNUP !== '1',
    // .env carries the live BETA_* values for the scripts; dev only enforces the Beta pass with DEV_BETA_GATE=1
    // (point BETA_RPC_URL / BETA_CHAIN_ID / BETA_CONTRACT at a local chain to rehearse a mint).
    beta: env.DEV_BETA_GATE === '1' ? createBetaGate((name) => env[name]) : null,
    // DEV_RALLY_MINUTE_UTC=1325 moves the Daily Rally start to 22:05 UTC, to rehearse a start locally.
    rallyMinuteUtc: env.DEV_RALLY_MINUTE_UTC ? Number(env.DEV_RALLY_MINUTE_UTC) : undefined,
    cupTeamWallets: new Set((env.CUP_TEAM_WALLETS || '').split(',').map(w => w.trim().toLowerCase()).filter(Boolean)),
  }
  // A dev Cup to rehearse on, with 12 named demo racers already in: registration open for
  // DEV_CUP_MINUTES (default 6), 2-minute rounds. Three minutes after a Grand Final has run on
  // screen the next one opens on its own, so /cup/live can be watched at any time.
  const DEMO_RACERS = ['Mossback', 'Kiro_77', 'Nightroll', 'TurboScale', 'Lunar', 'ZeroDrag', 'Pinecone', 'RollingJoe', 'Emberfoot', 'Slate', 'Quill', 'Ironpaw']
  const rehearse = async (id: number, minutes: number) => {
    const cup = await newCup(deps, { id, starts_at: new Date(Date.now() + minutes * 60_000).toISOString(), round_minutes: 2, final_gap_minutes: 3, register_close_minutes: 1 })
    await deps.store.insertCup(cup)
    for (const name of DEMO_RACERS) {
      const wallet = '0x' + createHash('sha256').update(`dev-racer:${name}`).digest('hex').slice(0, 40)
      await deps.store.upsertPlayer(wallet, new Date(0))
      await deps.store.setUsername(wallet, name)
      await deps.store.insertCupEntry({ cup_id: id, wallet, registered_at: new Date().toISOString() })
    }
  }
  let rehearsing = rehearse(1, Number(env.DEV_CUP_MINUTES || 6))
  const nextRehearsal = async () => {
    await rehearsing
    const cup = await deps.store.latestCup()
    if (!cup) return
    const final = (await deps.store.cupRaces(cup.id)).find(r => r.cup_round === cup.qualifying_rounds + 1)
    if (final && Date.parse(final.finished_at ?? '') + 3 * 60_000 < Date.now()) rehearsing = rehearse(cup.id + 1, 2)
    await rehearsing
  }

  const handler = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if ((req.url?.split('?')[0] || '') !== '/api/test-season') return next()
    if (req.method !== 'POST') {
      res.statusCode = 405
      res.end()
      return
    }
    let body: Record<string, unknown> = {}
    try { body = JSON.parse((await readBody(req)) || '{}') } catch { /* empty body → unknown action */ }
    const token = req.headers['x-session']
    if (body.action === 'cup') await nextRehearsal()
    const reply = await handle(deps, String(body.action ?? ''), body, typeof token === 'string' ? token : null)
    res.statusCode = reply.status
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(reply.body))
  }

  return {
    name: 'test-season-dev',
    configureServer(server: { middlewares: { use: Function } }) {
      server.middlewares.use(handler)
    },
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // VITE_* values are inlined into the public bundle: refuse to build with a secret key in one.
  const leaked = Object.keys(env).filter(k => k.startsWith('VITE_') && /^(sb_secret_|service_role)/.test(env[k] || ''))
  if (leaked.length) throw new Error(`${leaked.join(', ')} holds a secret key; VITE_ variables are public. Use a publishable key.`)
  return {
    plugins: [react(), announcePlugin(env), testSeasonDevPlugin(env)],
    build: {
      target: 'es2020',
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined
            if (id.includes('/pixi.js/') || id.includes('/@pixi/')) return 'pixi'
            if (id.includes('/ethers/') || id.includes('/@noble/') || id.includes('/@adraffy/') || id.includes('/aes-js/')) return 'ethers'
            if (id.includes('/@supabase/')) return 'supabase'
            if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) return 'react'
            return undefined
          },
        },
      },
      chunkSizeWarningLimit: 900,
    },
    optimizeDeps: {
      include: ['react', 'react-dom', 'ethers', 'pixi.js', '@supabase/supabase-js', 'seedrandom'],
    },
  }
})
