/**
 * Baked announcer lines. Every spoken line is recorded as ONE complete
 * sentence so the voice keeps natural phrasing, commas and breaths; lines are
 * never stitched from fragments. Racers are called by saddle number, so the
 * set of possible lines is finite and is enumerated here.
 *
 * `LINES` is the single source of wording: commentary.ts builds its calls
 * from it and bakeVocabulary() enumerates the same builders, so the game and
 * the bake cannot drift apart.
 *
 * Pure module (no browser / Vite globals): scripts/bake-announcer.mjs
 * imports it to know what to record.
 */

export const CLIP_BASE = '/audio/announcer';
export const CLIP_MANIFEST = `${CLIP_BASE}/manifest.json`;

export const BAKED_TRACKS = ['Forest', 'Desert', 'Volcanic', 'Midnight'] as const;
export const MAX_NUMBER = 10;
export const BURST_VARIANTS = 4;

const ORDINAL_WORDS = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
const NUMBER_WORDS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

const call = (n: number) => `Number ${n}`;

export const LINES = {
  lineUp: (track: string) => `They're lining up on the ${track} Track.`,
  off: () => "And they're off!",
  breaksOnTop: (n: number) => `${call(n)} breaks on top!`,
  takesLead: (n: number) => `${call(n)} surges to the front, and takes the lead!`,
  halfway: (n: number) => `Halfway, and ${call(n)} leads.`,
  /** `close`: the lead is under about two lengths. */
  turnsHome: (n: number, close: boolean) => close
    ? `${call(n)} turns for home, with a narrow lead.`
    : `${call(n)} turns for home, and has opened up a clear lead!`,
  tooClose: (n: number) => `${call(n)} just in front, and it's too close to call!`,
  stumbles: (n: number) => `${call(n)} stumbles, and the lead is wide open!`,
  wins: (n: number) => `${call(n)} wins it!`,
  winsByNose: (n: number) => `${call(n)} wins it, by a nose!`,
  /** A racer's speed burst. `v` picks the wording, so the caller does not repeat himself. */
  burst: (n: number, v: number) => [
    `Wow, ${call(n)} just hit the turbo!`,
    `Look at ${call(n)} go, what a burst of speed!`,
    `${call(n)} finds another gear!`,
    `${call(n)} is absolutely flying now!`,
  ][v % BURST_VARIANTS],
  youBurst: (v: number) => ['Wow, you just hit the turbo!', 'You find another gear!'][v % 2],
  /** The player's own lines say "you", so one set of clips fits every lane (the player's lane is random). */
  comesHome: (place: number) => `You come home ${ORDINAL_WORDS[place]}.`,
  chargesUp: (place: number) => `You charge up to ${ORDINAL_WORDS[place]}!`,
};

export type ClipPart = { kind: 'clip'; id: string };

export interface BakeEntry {
  id: string;
  text: string;
}

/** Everything the bake script records. */
export function bakeVocabulary(): BakeEntry[] {
  const lines: string[] = [LINES.off()];
  for (const track of BAKED_TRACKS) lines.push(LINES.lineUp(track));
  for (let n = 1; n <= MAX_NUMBER; n++) {
    lines.push(
      LINES.breaksOnTop(n), LINES.takesLead(n), LINES.halfway(n),
      LINES.turnsHome(n, true), LINES.turnsHome(n, false),
      LINES.tooClose(n), LINES.stumbles(n), LINES.wins(n), LINES.winsByNose(n),
    );
    for (let v = 0; v < BURST_VARIANTS; v++) lines.push(LINES.burst(n, v));
  }
  lines.push(LINES.youBurst(0), LINES.youBurst(1));
  for (let p = 2; p <= MAX_NUMBER; p++) lines.push(LINES.comesHome(p));
  for (let p = 1; p <= 3; p++) lines.push(LINES.chargesUp(p));
  return lines.map(text => ({ id: lineClipId(text), text: spokenText(text) }));
}

/** Clip id (= mp3 file stem) for a commentary line. */
export function lineClipId(text: string): string {
  return `line-${text.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
}

/** Text sent to the voice: digits become words so the delivery is natural. */
export function spokenText(text: string): string {
  return text.replace(/Number (\d+)/g, (_, d) => `Number ${NUMBER_WORDS[Number(d)] ?? d}`);
}

/**
 * The clip for a commentary line. Always a single whole-sentence clip; when
 * it was not baked, the caller falls back to speaking the line live.
 */
export function planClips(text: string): ClipPart[] | null {
  const line = text.trim();
  return line ? [{ kind: 'clip', id: lineClipId(line) }] : null;
}
