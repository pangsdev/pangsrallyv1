# Pangs Rally — handoff for Claude Code

English-only product. Owner chats in Turkish; **no Turkish copy, toasts, dates, or voice in the game or website.** Token ticker is **`$PANG`** (never `$PANGS`). **Do not show a contract address (CA) on the site.**

This file is the state of the project as of 1 Nov 2026 after a Cursor session that rebuilt bot-race visuals, commentary, and announcer plumbing.

---

## What this is

Web3 auto-racing game: players race **Pangolin NFTs** (Genesis + Beta Pass) on themed tracks. Horizontal left→right race because NFT art is side-view. 10 racers. Traits: **Body** (color), **Weather Adaptation**, **Speed**, **Burst Power**, **Endurance**. Matching Weather Adaptation to the track gives ~2.5% speed.

Stack: React 19 + Vite 8 + TypeScript, ethers v6, PixiJS 8.22, seedrandom, Supabase. Chain: Robinhood (`0x1237`). Run: `npm run dev` (Vite on `:5173`). Lint: `oxlint`. Build: `tsc -b && vite build`.

Main app is a view-state monolith: `src/App.tsx`. Race engine lives in `src/race/`. Bot race is the only fully new visual path.

---

## Product rules the owner already decided

| Rule | Detail |
|---|---|
| Language | English only in UI, litepaper, toasts, dates (`en-US`), commentary, voice |
| Token name | `$PANG` everywhere users see it |
| No CA | Do not add a contract-address ticker/copy box on landing or Vision |
| Voice | No `window.speechSynthesis`. Owner called browser TTS “robotic / disgusting” |
| Voice language | English race-caller only. No Turkish voice, ever |
| Beta pass | Test season racers must mint the free **Pangs Rally Beta** NFT (gas only, 1 per wallet) after the invite. `smart-contracts/contracts/PangsRallyBeta.sol`: mint needs a server-signed voucher (`beta-voucher` action, key `BETA_SIGNER_KEY`), so only invited wallets can mint; the game checks `hasMinted`. **Live since 2 Nov 2026:** contract `0xD131531DCee2D60eA0C134d2ca50297b065C0549` on Robinhood Chain (4663), owner = dev wallet, royalty 5% → treasury, token URI `ipfs://Qmf1rAoRYfpTbqdzk3PtFtsVTZbYEpPtNqd7YfJ7maHRbE` (details in `smart-contracts/deployments/PangsRallyBeta.robinhood.json`). Function secrets `BETA_CONTRACT`, `BETA_SIGNER_KEY`, `BETA_CHAIN_ID` are set; unset `BETA_CONTRACT` to turn the gate off. Deploy/upload: `scripts/deploy-beta.mjs`, `scripts/upload-beta-metadata.mjs`. Art: `scripts/make-beta-nft.mjs` → `design/beta-nft/`. Contract tests: copy to a non-iCloud folder (Desktop `smart-contracts/node_modules` is iCloud-evicted and Hardhat hangs). |
| Theme | **Dark only.** The light theme and its toggle were removed (Nov 2026); `index.html` pins `data-theme="dark"`. |
| Invites | Test season is invite-only for **new** wallets (registered wallets never need a code). Codes have N places: `npm run invite:create -- --uses 30 --note "…"`. Share link `https://pangsrally.com/?invite=CODE` pre-fills it. `TEST_OPEN_SIGNUP=1` (function secret) turns invites off. Dev code: `DEV-RALLY`. |
| Sign-in | **Test season: MetaMask only.** Connect + sign a free message (no gas). Guest Mode / Mint Rookie were removed. No wallet → modal (desktop: install MetaMask; phone: open in the MetaMask app browser). |
| Daily cap | 3 races/day per wallet (bot + online combined), **enforced server-side**, resets UTC midnight. Owner/testers exempt via `TEST_UNLIMITED_WALLETS`. |
| Points | No token yet. Every finish scores season points `25/18/15/12/10/8/6/4/2/1` on the Beta season leaderboard. Points count only once the race has run on screen: `test_races.finished_at` = result time + `RACE_LEAD_IN_SECONDS` + race length (`raceEndsAt` in `core.ts`); the leaderboard view (migration 007), `me`, history (`status: 'live'` until then) and profile ignore races before that. |
| Usernames | Players pick a racer name on Profile (`set-username`; rules `checkUsername` in `src/race/testSeason.ts`: 3-16 chars, letter first, letters/digits/_, no `0x…`, bot call names or staff words reserved, short blocklist; unique in any case via migration 008). Shown in the header, lobby, leaderboard, rooms and on the track tag (stored in the race `field`, so replays keep the name the racer had). The announcer still calls saddle numbers, never names. |
| Streaks | One race on a UTC day counts that day (`streakFor` in `src/race/testSeason.ts`, computed from `test_race_entries.day`, no table of its own). Badges `STREAK_BADGES` at 3/7/14/30 days follow the best streak, so a broken streak keeps them. Off-chain, cosmetic only: no rewards attached. UI in `src/components/Badges.tsx` (Profile card, leaderboard medal, unlock pop-up once per browser after the race). |
| Season name | Users see **Beta Season** (never "Test Season"); code, tables and the `test-season` function keep their old names. |
| Fairness | Test season: every racer (players + bots) runs on equal stats 50/50/50 → pure seeded luck, ~10% win each (verified by `npm run test:season`). |
| Token | `$PANGS` is cancelled. `$PANG` launches **after** the NFT mints; until then the site shows no token prizes, balances or fees. |

---

## Test season (built Nov 2026)

Server-authoritative: the browser never decides results or points.

- `src/race/testSeason.ts` — shared pure rules: field builder (players + bots, equal stats), points table, daily limit, sign-in message, `runTestRace`.
- `supabase/functions/test-season/` — game server. `core.ts` (platform-neutral logic: login, me, bot-race, online-join, online-status, race, history, leaderboard), `supabaseStore.ts` (Postgres), `memoryStore.ts` (dev/tests), `index.ts` (Edge Function entry). `race/` is **generated** by `npm run sync:server` from `src/race` — edit the originals.
- `supabase/migrations/004_test_invites.sql` — `test_invite_codes` + `test_players.invite_code`; `test_join_with_invite(wallet, code)` registers and takes a place atomically (no over-fill). Applied live 2 Nov 2026 via `supabase db query --linked -f …`.
- `supabase/migrations/003_test_season.sql` — `test_players`, `test_sessions`, `test_races`, `test_race_entries` (unique `(wallet, day, slot)` enforces the daily limit), view `test_leaderboard`. RLS on, no policies: only the function's service role touches them.
- Dev: `vite.config.ts` serves `/api/test-season` with the same core on an in-memory store (wiped on restart). Prod: `${VITE_SUPABASE_URL}/functions/v1/test-season`. Override with `VITE_TEST_SEASON_API`.
- Client: `src/testSeason/api.ts` (session in `localStorage pangsrally_test_session`, header `x-session`), `RaceRoom.tsx` (replays a server race: bot / online / replay), `OnlineRooms.tsx` (room list) + `OnlineRoom.tsx` (waiting room). Rooms are made by the game: `OPEN_ROOMS` (3) per track, start every `ROOM_SLOT_MINUTES` (30) on the clock; a full room starts at once and a new room takes its start time; bots fill empty lanes (migration 006 keeps one open room per start time), `RaceLobby.tsx`, `SeasonPages.tsx` (leaderboard, My Races with replays, sign-in gate, no-wallet modal).
- Online rooms resolve lazily (any rooms/status/history/me call after the start time). A player who leaves is still scored.
- `npm run test:season` — 16 end-to-end checks (signatures, parallel daily-limit abuse, online rooms, replay determinism, fairness).

### Racer art and ball colours (must match)
- Players race in the **Beta pass** (`BETA_RACER_ART` = `public/beta/beta-racer.webp`, body `Beta`, `ball_beta.png`); bots wear only the 10 public teasers (`public/nft-images/1-10.webp`; the rest of the art stays out of git until the mint). Their bodies come from `TEASER_BODIES` in `src/race/testSeason.ts`, checked against the art: 1/4/9/10 `Aurora` (teal→blue→purple, own ball `ball_aurora.png` from `scripts/make-aurora-ball.mjs`), 2/7 `Blue`, 3/5/6/8 `Brown`. `npm run test:season` fails if a racer's ball does not match.
- **Do not take bodies from `token-index.json` / `public/metadata` for the local images**: the teasers are promo drawings, and even the full local `public/nft-images/{id}.webp` set does not line up with `metadata/{id}.json` (e.g. #12 is "Blue" in metadata but brown in the image; likely the metadata shuffle in `shuffle_and_upload.cjs`). After the mint, take image *and* Body from the same on-chain metadata.

### Troubleshooting
- "The race server is not available right now": the `test-season` function is unreachable. Production URL is `https://<project>.supabase.co/functions/v1/test-season`; `src/testSeason/api.ts` falls back to this project's public URL when `VITE_SUPABASE_URL` is unset, so hosting needs no env var for it.
- Nov 2026: a transient local-network DNS failure made the project host look dead for a while; the project itself was `ACTIVE_HEALTHY` all along. Check with `supabase projects list` before assuming it is paused.
- On the owner's Mac `npx supabase …` hangs (`~/.npmrc` has `prefix=`, which clashes with nvm; also Node 18 is first on PATH). Use the official release binary instead (verify its sha256 against the GitHub release digest) or fix nvm.

### Status (2 Nov 2026)
`test-season` is **deployed** to project `rzpcppmzpyocoqnjwrwp` and migration 003 is applied. Live end-to-end passed (sign-in, forged-signature rejection, session check, bot race, history, leaderboard). Redeploy after changing `core.ts` / `src/race/*`: `npm run sync:server`, then `supabase functions deploy test-season --no-verify-jwt --use-api --project-ref rzpcppmzpyocoqnjwrwp`.

### Deploy (first time)
1. Rotate the Supabase secret key; put a **publishable** key in `VITE_SUPABASE_ANON_KEY` (the old value was an `sb_secret_` key → it would ship in the JS bundle).
2. Run `supabase/migrations/003_test_season.sql` in the Supabase SQL editor.
3. `npx supabase login`, then `npm run sync:server && npx supabase functions deploy test-season --no-verify-jwt --project-ref rzpcppmzpyocoqnjwrwp`.
4. Optional secret: `npx supabase secrets set TEST_UNLIMITED_WALLETS=0xowner…` (same var in `.env` for dev).

## What works now (Bot Race)

`src/components/BotRaceRoom.tsx` + `src/race/*` is the current game.

**Simulation** (`simulation.ts`): seed + racer inputs → deterministic 60 Hz fixed-step race. Same seed + field = same finish. Distance 400 m. Phases: idle → running → curling (0.45 s) → rolling → finished. Curl after ≥2.4 s once speed ≥55% max. Form noise, 1–2 bursts, optional stumble. `generateBots` picks real token ids 1–1000.

**Track** (`PixiRaceTrack.tsx`): Pixi scene, camera follows leader. NFT open-pose cutout (Web Worker chroma-key) then curl into Body-colored ball sprites (`public/sprites/ball_*.png`). Gallop is a MeshPlane deform, not image-shake. Countdown 3-2-1 sits **on the live track**, then GO. Two-stage load: scenery first, avatars second, 900 ms jog-in, then countdown.

**Themes** (`themes.ts`): Forest / Desert / Volcanic / Midnight all exist (sky, sun/moon, decor, ground webp, particles). **Lobby locks Class 4/3/2** (`entry: 'Locked'` in `App.tsx` `mockCategories`). Only Forest is playable from UI. Midnight could map to collection trait `Snow` if unlocked.

**NFTs in bot race**: selected wallet NFT (or guest) uses its image + Body + traits. Beta Pass → Gold + `/beta-pass-nft.png`. Guest → `nft-images/1.webp` + rainbow ball, stats 15/15/15. Bots use `token-index.json` (1000 tokens) + `/nft-images/{id}.webp`.

`fetchMyNFTs` reads the Endurance trait (fallback 50).

---

## Commentary + voice

**Fact-only caller, horse-race delivery.** `src/race/commentary.ts` speaks only when something real happens. All wording lives in `LINES` (`src/race/announceClips.ts`), e.g.:

- `They're lining up on the Forest Track.` / `And they're off!`
- `Number 4 breaks on top!` / `Number 6 surges to the front, and takes the lead!`
- `Halfway, and Number 6 leads.` / `Number 6 turns for home, with a narrow lead.`
- `Number 6 just in front, and it's too close to call!` / `Number 6 wins it, by a nose!`
- `Number 5 comes home fourth.` / `Number 5 charges up to second!` (player lines, baked for lane 5 only)

**Racers are called by saddle number 1–10** (owner's choice), shown on the track badge and standings. Never say token ids. Call names (`callNames.ts`) still label racers on screen; players show as short wallets.

**Audio is baked, one whole sentence per clip** (owner: no stitching, natural commas/breaths). 107 clips in `public/audio/announcer/` + `manifest.json`, recorded by `npm run bake:announcer` (Daniel, flash v2.5, stability 0.28, speed 1.18). A line without a clip (e.g. player lines for a lane ≠ 5 in online rooms) falls back to live TTS, which fails quiet when unavailable.

**ElevenLabs (free plan) is wired but not the end state.**

- Key must **never** go in frontend / `VITE_*` / git.
- Dev: Vite middleware `POST /api/race-announce` in `vite.config.ts` reads `ELEVENLABS_API_KEY` from `.env`.
- Prod stub: `supabase/functions/race-announce/index.ts` (not necessarily deployed).
- Client: `src/race/announce.ts` — Cache API, mute (`pangsrally_announcer_muted`), fail-quiet on 402/429, `#208` spoken as `number two oh eight` (legacy; names should make this rare).
- Voice: premade **Daniel** `onwK4e9ZLuTAKqWW03F9`, model `eleven_flash_v2_5`. Free plan: Voice Library voices often fail via API; stick to premade.
- Unlock: `unlockAnnounce()` on Race Now click so autoplay works.

**Security:** an ElevenLabs key was pasted into a prior chat and written to gitignored `.env`. Treat it as leaked. Rotate in ElevenLabs, update `.env` / Supabase secrets, never paste keys into chat.

---

## What is not done / still old

| Area | State |
|---|---|
| **Old room code** | `OnlineRaceRoom.tsx` / `BotRaceRoom.tsx` are no longer imported (replaced by `OnlineRoom` / `RaceRoom`); safe to delete. |
| **Other maps** | Visuals ready, UI locked. |
| **Legacy live-race** in `App.tsx` | Old CSS race still exists (`live-race` view). Dead-ish room-browser path. |
| **Breeding / laboratory** | UI “Coming Soon”. |
| **Genesis mint** | Button locked. |

Replays: every test race stores `seed` + `field` in `test_races`; `RaceRoom` rebuilds it with `new RaceSimulation(seed, field, opts)` (My Races → Replay).

---

## Website / economy copy

User-facing `$PANG` is already renamed (landing, Vision/Litepaper, lobby, prizes, inventory, referral, toasts). Solidity / ABI symbols may still say PANGS — do not surface that.

Litepaper: `src/components/Litepaper.tsx` (“The Vision”). No CA there.

---

## Data / backend

- Supabase client: `src/supabaseClient.ts` (`races`, `race_participants`, `users`, leaderboard).
- Rooms: `supabase/migrations/002_race_rooms.sql` — `race_rooms` + `race_room_players` (seed, map, nft_token_id, sprite, results).
- Functions: `claim-verify` (prize signature), `race-join` (stubby), `race-announce` (ElevenLabs proxy).
- Token traits bundle: `src/race/token-index.json` (~1000 tokens, ~33 KB). Prefer this over fetching `/metadata/*.json`.
- Local `public/nft-images` + `public/metadata` can be iCloud-evicted on the owner’s Mac (Desktop) and make first load very slow. Production should host webp, not rely on iCloud.

Env (gitignored `.env`): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_BETA_PASS_CONTRACT_ADDRESS`, `ELEVENLABS_*`. Also contains wallet/treasury/Pinata secrets — **never commit `.env`.** `VITE_SUPABASE_ANON_KEY` has looked like a secret key (`sb_secret_…`); do not expose it further. Do not print `.env` in replies.

---

## Contracts (do not advertise addresses on the site)

Used in app (env override preferred):

- Genesis NFT: `VITE_CONTRACT_ADDRESS` or fallback in `App.tsx`
- Beta Pass: `VITE_BETA_PASS_CONTRACT_ADDRESS`
- Marketplace / racing: `src/contracts.ts`
- `$PANG` token address in `contracts.ts` is still zero placeholder

Solidity under `smart-contracts/contracts/`: `PangsRallyOfficial.sol`, `PangsRallyBetaPass.sol`, `PangsRallyGen1.sol`, marketplace, racing, deprecated originals.

On-chain rename exists (`setName` / `pangolinNames`) but costs gas. Race tag is the off-chain caller name.

---

## Test path

1. Landing → **Join the Test Season** → MetaMask connect + sign.
2. Rally → Class 5 Forest **View Rooms** → **Bot Race** or **Online Race**.
3. Daily limit is server-side. In dev it resets when the Vite server restarts; or add your wallet to `TEST_UNLIMITED_WALLETS` in `.env`.
4. Without MetaMask (e.g. the in-app browser) you can inject a test signer: see how `scripts/test-season-check.mjs` signs with `ethers.Wallet.createRandom()`.

---

## Suggested next work (owner priority, in order)

1. **Deploy the test season** (see Test season → Deploy) and host the site for phone testing.
3. **Unlock other maps** (or leave locked as product) — themes already work.
4. **Persist bot + online races** (`seed` + racer list) and **Watch Replay** on Pixi track from My Races. Online: join/leave, resolve when full, replay later.
5. **Port OnlineRaceRoom** to Pixi + same commentary/call names.
6. Guest Mode without MetaMask if owner wants walk-in testers.
7. Rotate leaked ElevenLabs key; scrub any key from chat/logs.

---

## Code map

```
src/App.tsx                 views, wallet, mint/guest, inventory, old live-race
src/components/RaceLobby.tsx  bot vs online + race tag
src/components/BotRaceRoom.tsx  current race UX
src/components/OnlineRaceRoom.tsx  OLD race — do not copy its visuals
src/components/Litepaper.tsx  Vision
src/race/simulation.ts      deterministic physics
src/race/PixiRaceTrack.tsx  renderer
src/race/themes.ts          4 tracks
src/race/sprites.ts         Body / balls / token-index
src/race/commentary.ts      fact-only caller
src/race/callNames.ts       Ember/Pike/… + race tags
src/race/announce.ts        ElevenLabs client (no key)
src/race/cutout*.ts         NFT background removal
src/race/race.css           booth + HUD
vite.config.ts              /api/race-announce proxy (dev)
supabase/functions/race-announce/  prod TTS proxy
```

Do not reintroduce: black-screen countdown, bounce-only “running”, `$PANGS`, Turkish UI, browser `speechSynthesis`, CA on marketing pages, `#tokenId` as the spoken racer name.
