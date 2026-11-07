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
| Invites | Test season is invite-only for **new** wallets (registered wallets never need a code). Codes have N places: `npm run invite:create -- --uses 30 --note "…"`. Share link `https://pangsrally.com/?invite=CODE` pre-fills it. `TEST_OPEN_SIGNUP=1` (function secret) turns invites off. Local dev server: no invite step (the live codes only exist in the live database); `DEV_INVITE_GATE=1` turns it on with code `DEV-RALLY`. |
| Sign-in | **Test season: MetaMask only.** Connect + sign a free message (no gas). Guest Mode / Mint Rookie were removed. No wallet → modal (desktop: install MetaMask; phone: open in the MetaMask app browser). |
| Daily cap | 5 races/day per wallet (bot + online combined), **enforced server-side**, resets UTC midnight. Owner/testers exempt via `TEST_UNLIMITED_WALLETS`. |
| Points | No token yet. Every finish scores season points `25/18/15/12/10/8/6/4/2/1` on the Beta season leaderboard. Points count only once the race has run on screen: `test_races.finished_at` = result time + `RACE_LEAD_IN_SECONDS` + race length (`raceEndsAt` in `core.ts`); the leaderboard view (migration 007), `me`, history (`status: 'live'` until then) and profile ignore races before that. |
| Predictions | Free game, no token, no value. One final pick (saddle number 1-10) per wallet per online room, locked until the start, uses no daily race, needs the Beta pass. Winner +10, 2nd/3rd +3 (`predictionPointsFor`). Own points, never mixed with season points. Numbers, not racers, because bots and lanes are only fixed at the start. **Not live:** the code ships switched off (`PREDICTIONS_ON` in `src/testSeason/api.ts` is true only on the dev server; server needs `TEST_PREDICTIONS=1`). Table `test_predictions` + view `test_prediction_board` (migration 011, not applied yet). UI `src/components/Predictions.tsx` (`PickPanel` in rooms and waiting room; Prediction League at `/predictions`, tab on the Leaderboard). Never call it betting or show odds. |
| Room seeds | `online-<random>`, never built from the room id: the id is public and the race code ships to browsers, so an id-based seed reveals the result. |
| Usernames | Players pick a racer name on Profile (`set-username`; rules `checkUsername` in `src/race/testSeason.ts`: 3-16 chars, letter first, letters/digits/_, no `0x…`, bot call names or staff words reserved, short blocklist; unique in any case via migration 008). Shown in the header, lobby, leaderboard, rooms and on the track tag (stored in the race `field`, so replays keep the name the racer had). The announcer still calls saddle numbers, never names. |
| Streaks | One race on a UTC day counts that day (`streakFor` in `src/race/testSeason.ts`, computed from `test_race_entries.day`, no table of its own). Badges `STREAK_BADGES` at 3/7/14/30 days follow the best streak, so a broken streak keeps them. Off-chain, cosmetic only: no rewards attached. UI in `src/components/Badges.tsx` (Profile card, leaderboard medal, unlock pop-up once per browser after the race). |
| Early Pangolin badge | Every wallet that joins during the Beta Season gets it, with its place in sign-up order (`racerNumber` on `me`, from `test_players.created_at`, no table of its own). Set the function secret `BETA_SEASON_END` (ISO time) when the season ends: wallets joining from then on get none, earlier ones keep theirs. Cosmetic only, no rewards. `SeasonBadge` / `SeasonCard` in `src/components/Badges.tsx`, pop-up once per browser. Art: `scripts/make-early-badge.mjs` → `public/badges/early-pangolin.webp` (the Beta racer, not mirrored so the β pin reads right). The badge text tells players only that they joined early, not that it closes. Do not delete rows from `test_players`: that would shift the numbers. |
| Bug reports | `/report` (`src/components/ReportPage.tsx`, opened from the wallet menu and the landing footer) saves to `test_reports` (migration 009) through the `report` action. Works signed out. Limits per UTC day: 5 per wallet, 30 shared by signed-out visitors. Read them with `npm run reports`. |
| Wallet menu | Clicking the name in the header opens `WalletMenu` (Profile, Report a bug, Disconnect). Signing out always takes its own click. |
| Online rooms | Real players only, no bots. One room per track waits (`closes_at` null) until all 10 seats are taken, however long that takes; then it starts `ROOM_FULL_COUNTDOWN_SECONDS` (5 min) later and the next room opens at once. Seats close and are locked during the countdown. Migration 012. |
| Seats | A seat is `slot 0` in `test_race_entries`: it keeps one race back (`heldSeats`, `racesLeft` goes down, `racesToday` does not) and becomes a real race of the day when the race starts (`chargeSeat`). One seat at a time. `online-leave` gives it back free until the room is full. `me.bookedSeats` holds the start times, null while waiting; `seatNote` shows them beside the counter. |
| Pangs Cup | One-evening tournament (`supabase/functions/test-season/cup.ts`, migration 013, page `/cup`, broadcast screen `/cup/live`). Registered racers (Beta pass, free, `seats` cap (default 50; `npm run cup -- update --id N --seats N` adds seats), closes 30 min before Round 1; **at least 10 racers** (`MIN_CUP_RACERS`) or the Cup shows as `postponed` and runs nothing until `cup -- update --starts` gives it a new date, registrations kept) run 4 qualifying rounds in fresh random rooms of 10 (rooms split evenly, bots fill short rooms and score nothing), 25/18/15… points, ties: wins, second places, seeded draw. Top 10 race one Grand Final, points reset; the final sets tiers 1/2/3/4. Cup races use no daily race and give no season points (no `test_race_entries`). Rounds resolve lazily room by room (unique index on `cup_id, cup_round, cup_room`). Seeds = `cup-` + sha256(secret:round:room); the secret's SHA-256 is public from the start and the secret after the final. Team wallets `CUP_TEAM_WALLETS` cannot enter. Prizes: 30 USDG (15/10/5) + Genesis whitelist for the podium + soulbound badge NFT for all 10 finalists, plus a soulbound **Participant** badge (tier 5, steel `RACER` trophy) every racer can claim (`setParticipants` writes one Merkle root of the racers, `claimParticipant(cupId, proof)`; tree in `src/testSeason/cupMerkle.ts`, shared by `cup -- publish` and the Cup page; the server lists the racers' wallets in `participants` after the final), paid by `smart-contracts/contracts/PangsCup.sol` (ERC-1155, owner writes results with `setResults`, finalists `claim`, 30-day USDG window, tests in `smart-contracts/test/PangsCup.test.cjs`). USDG on Robinhood Chain: `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` (6 decimals, from Paxos's list). Admin: `npm run cup -- create|status|deploy|uris|fund|publish` (preview unless `--send`), badges `node scripts/upload-cup-badges.mjs`. Art: `design/cup/badges/trophy.html`. Broadcast host **Rico Scales** (`RicoHost.tsx`): a booth camera shot made from the owner's two booth stills, smiling with the mouth shut, and mouth open (`design/cup/rico/rico-booth-{closed,open}.webp`; the owner swapped in the smiling shut still because the first one looked unhappy; `scripts/make-rico.mjs` → `public/cup/rico.webp` + `rico-talk.webp`). Nothing is redrawn: the open-mouth face is aligned onto the shut frame (scale 1.0207, shift +13.1/+17.7) and kept only inside a soft oval over the snout/mouth/eye. The crop leaves out the left window, which shows horses. Lip flap comes from the caller's own audio via `announcerLevel()` / `onAnnounce()` in `announce.ts` (a passive analyser): hysteresis on the voice level, about 3 flaps per second. The camera punches in on each new line. Lines between races never name racers. Not live until migration 013, a deploy and `cup create --send`. |
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
- Client: `src/testSeason/api.ts` (session in `localStorage pangsrally_test_session`, header `x-session`), `RaceRoom.tsx` (replays a server race: bot / online / replay), `OnlineRooms.tsx` (room list) + `OnlineRoom.tsx` (waiting room). Rooms are made by the game (see Online rooms above), `RaceLobby.tsx`, `SeasonPages.tsx` (leaderboard, My Races with replays, sign-in gate, no-wallet modal).
- Online rooms resolve lazily (any rooms/status/history/me call after the start time). A player who closes the page is still scored.
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

**Track** (`PixiRaceTrack.tsx`): Pixi scene, camera follows leader. NFT open-pose cutout (Web Worker chroma-key) then curl into Body-colored ball sprites (`public/sprites/ball_*.png`). Gallop is a rigged MeshPlane (racerRig.ts), not image-shake. Countdown 3-2-1 sits **on the live track**, then GO. Two-stage load: scenery first, avatars second, 900 ms jog-in, then countdown.

**Course look** (Nov 2026, `PixiRaceTrack.tsx`, all four themes): kerbs on both edges (`theme.kerb`), boards with our logo on dark and light panels and `On Robinhood Chain`, alternating, framed panels on legs (name only, black on #ccff00; their brand guidelines bar the feather alone, altered logos and use in NFTs or collectibles, so no Robinhood logo without their approval) with a running rail (`theme.rail`), covered grandstands along the course (`standAt`), start/finish gantries beside the lanes, ground = texture at two scales + generated patches (`patchTexture`) so it does not look tiled.

**Racer motion** (`src/race/racerRig.ts`, Nov 2026): one flat image on a 26×20 mesh. All 11 arts share the same base, so the four paws sit at fixed canvas fractions and each leg is its own mesh region. Four-beat walk blends into a gallop by real speed; stride rate follows ground speed, with a quick minimum cadence in the gallop (`cadence`) so it reads as running. Curl bends the body along its spine into a ring over the ball sprite; uncurl is the reverse. Render-only: `simulation.ts` is untouched, so results and replays do not change. `HeroRunner.tsx` (landing, Online card) still has the older simple motion.

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
- `You come home fourth.` / `You charge up to second!` (player lines say "you": the player's lane is random, so one clip fits every lane)
- `Wow, Number 2 just hit the turbo!` and 3 other wordings / `You find another gear!` (speed-burst reactions: at most 3 per race, front five or the player, ~1.35 per race)

**Racers are called by saddle number 1–10** (owner's choice), shown on the track badge and standings. Never say token ids. Call names (`callNames.ts`) still label racers on screen; players show as short wallets.

**Rico Scales in every race** (Nov 2026): `RicoHost` sits in the race room side column (`rr-rico`, below Live Standings, replacing the old Rally Call panel) for bot, online, replay and Cup races, with the latest 3 calls; the caption bar under the track shows his face (`public/cup/rico-face.webp`). Styles in `src/components/rico.css`.

**Pangs Cup calls**: Cup races carry `cup: { round, final }` (`publicRace` in `core.ts`); the caller then says `LINES.cupLineUp(first)` / `cupFinalLineUp()` and `cupWins(n)` / `cupChampion(n)` instead of the plain line-up and winner lines, and the broadcast board says `cupWelcome` / `cupAfterRound` / `cupFinalTen` / `cupOver` / `cupPostponed` out loud. **No round numbers in any Cup line** (owner: a Cup may have more rounds later, and re-recording per round is wasteful). Still saddle numbers only. Until a Cup clip is recorded, `speakCall(text, priority, fallback)` plays the plain clip (`LINES.lineUp`/`LINES.wins`) under the Cup text; board lines stay silent. **Recording status (8 Nov 2026):** none of the 28 Cup clips are recorded yet; the ElevenLabs free quota (10k/month) ran out. Run `npm run bake:announcer` after the quota resets or on a paid plan; it records only the missing ones.

**Lip flap** (`RicoHost.tsx`): opens when the voice level rises 30% over the dip before it, shuts when it falls 20% from that syllable's peak or after 220 ms (holds 60/50 ms). Tuned offline on all 149 baked clips: every clip gets at least one opening per word, about 1.2 per syllable.

**Audio is baked, one whole sentence per clip** (owner: no stitching, natural commas/breaths). 149 clips in `public/audio/announcer/` + `manifest.json`, recorded by `npm run bake:announcer` (Daniel, `eleven_v3`, stability 0, excited audio tags in `excited()` of the bake script; the owner found the flat flash v2.5 delivery too dull). A line without a clip falls back to live TTS, which fails quiet when unavailable.

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
- Functions: `claim-verify` (prize signature; removed from Supabase Nov 2026, source kept: before any redeploy take the amount from the server, not the request), `race-join` (stubby), `race-announce` (ElevenLabs proxy).
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
