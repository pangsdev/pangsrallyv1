/**
 * Race-caller audio. Lines are stitched from baked clips under
 * public/audio/announcer (see announceClips.ts). Live TTS is only a
 * fallback for a whole line when the clips are missing.
 * The ElevenLabs key never leaves the server; live requests go to
 * /api/race-announce (dev) or the Supabase function (prod) and are cached.
 */
import { CLIP_BASE, CLIP_MANIFEST, planClips, type ClipPart } from './announceClips';

const MUTE_KEY = 'pangsrally_announcer_muted';
const CACHE_NAME = 'pangs-announce-v1';
/** Silence between stitched clips, seconds. */
const CLIP_GAP = 0.05;
/** Amplitude below this counts as leading/trailing silence. */
const SILENCE = 0.012;
/** Median RMS of the baked clips; quieter clips are raised, louder ones lowered. */
const TARGET_RMS = 0.095;
/** Never push a clip's peak past this, and never boost more than ~+5 dB. */
const PEAK_CEILING = 0.92;
const MAX_GAIN = 1.8;

let disabled = false;
let ctx: AudioContext | null = null;
let current: AudioBufferSourceNode[] = [];
let playingUntil = 0;
let manifest: Promise<Set<string>> | null = null;
const inflight = new Map<string, Promise<ArrayBuffer | null>>();
const decoded = new Map<string, Promise<AudioBuffer | null>>();

const ONES: Record<number, string> = {
  0: 'zero', 1: 'one', 2: 'two', 3: 'three', 4: 'four',
  5: 'five', 6: 'six', 7: 'seven', 8: 'eight', 9: 'nine',
};
const TEENS: Record<number, string> = {
  10: 'ten', 11: 'eleven', 12: 'twelve', 13: 'thirteen', 14: 'fourteen',
  15: 'fifteen', 16: 'sixteen', 17: 'seventeen', 18: 'eighteen', 19: 'nineteen',
};
const TENS: Record<number, string> = {
  20: 'twenty', 30: 'thirty', 40: 'forty', 50: 'fifty',
  60: 'sixty', 70: 'seventy', 80: 'eighty', 90: 'ninety',
};
const ORDINALS: Record<number, string> = {
  1: 'first', 2: 'second', 3: 'third', 4: 'fourth', 5: 'fifth',
  6: 'sixth', 7: 'seventh', 8: 'eighth', 9: 'ninth', 10: 'tenth',
};

export function isAnnouncerMuted(): boolean {
  try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; }
}

export function setAnnouncerMuted(muted: boolean) {
  try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch { /* ignore */ }
  if (muted) stopAnnounce();
}

/** Call from a click so later race lines can play without autoplay blocks. */
export function unlockAnnounce() {
  const ac = audioContext();
  if (ac && ac.state === 'suspended') void ac.resume().catch(() => { /* ignore */ });
  void loadManifest();
}

/**
 * Start-light beep for the 3-2-1 countdown ("dit, dit, dit, diiit"), synthesised with Web Audio so it
 * needs no file. Kept quiet under the caller and silent when the announcer is muted.
 */
export function playStartBeep(kind: 'tick' | 'go') {
  if (isAnnouncerMuted()) return;
  const ac = audioContext();
  if (!ac || ac.state !== 'running') return;
  const t = ac.currentTime + 0.01;
  const len = kind === 'go' ? 0.62 : 0.16;
  const peak = kind === 'go' ? 0.085 : 0.07;
  const out = ac.createGain();
  out.gain.setValueAtTime(0, t);
  out.gain.linearRampToValueAtTime(peak, t + 0.012);            // fast attack, no click
  out.gain.setValueAtTime(peak, t + len - 0.06);
  out.gain.exponentialRampToValueAtTime(0.0001, t + len);        // soft release
  // A mellow tone: a triangle wave with a quiet octave on top, through a low-pass.
  const tone = ac.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 2600;
  tone.connect(out).connect(ac.destination);
  const freq = kind === 'go' ? 1046.5 : 523.25;                   // C6 for GO, C5 for the ticks
  for (const [mult, level, type] of [[1, 1, 'triangle'], [2, 0.18, 'sine']] as const) {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.value = freq * mult;
    g.gain.value = level;
    osc.connect(g).connect(tone);
    osc.start(t);
    osc.stop(t + len + 0.02);
  }
}

export function stopAnnounce() {
  for (const src of current) {
    try { src.stop(); } catch { /* already stopped */ }
  }
  current = [];
  playingUntil = 0;
}

/** Spoken form ElevenLabs should read. Keeps #208 from becoming "hash 208". */
export function spokenForm(text: string): string {
  return text
    .replace(/#(\d+)/g, (_, n) => `number ${digitRun(n)}`)
    .replace(/\b(\d+(?:\.\d+)?)m\b/g, '$1 meters')
    .replace(/\b(\d+)(st|nd|rd|th)\b/g, (_, n, suf) => ORDINALS[Number(n)] || `${n}${suf}`)
    .replace(/\bYours\b/g, 'Yours')
    .replace(/\s+/g, ' ')
    .trim();
}

function digitRun(n: string): string {
  if (n.length <= 2) return sayNumber(Number(n));
  return [...n].map(d => (d === '0' ? 'oh' : ONES[Number(d)] ?? d)).join(' ');
}

function sayNumber(n: number): string {
  if (n < 10) return ONES[n];
  if (n < 20) return TEENS[n];
  if (n < 100) {
    const t = Math.floor(n / 10) * 10;
    const r = n % 10;
    return r ? `${TENS[t]} ${ONES[r]}` : TENS[t];
  }
  return String(n);
}

export function warmCall(text: string): void {
  if (isAnnouncerMuted() || !text) return;
  void resolveLine(text);
}

export function speakCall(text: string, priority = 5): void {
  if (isAnnouncerMuted() || !text) return;

  void (async () => {
    const buffers = await resolveLine(text);
    if (!buffers || isAnnouncerMuted()) return;
    if (priority < 9 && isPlaying()) return;
    playBuffers(buffers);
  })();
}

/** Baked clips when every part is available, otherwise the whole line live. */
async function resolveLine(text: string): Promise<AudioBuffer[] | null> {
  const plan = planClips(text);
  if (plan && (await loadManifest()).size > 0) {
    const parts = await Promise.all(plan.map(resolvePart));
    if (parts.every((b): b is AudioBuffer => b !== null)) return parts;
  }
  const spoken = spokenForm(text);
  if (!spoken) return null;
  const live = await decodeOnce(`live:${spoken}`, () => fetchAnnounce(spoken));
  return live ? [live] : null;
}

async function resolvePart(part: ClipPart): Promise<AudioBuffer | null> {
  const baked = await loadManifest();
  return baked.has(part.id) ? decodeOnce(part.id, () => fetchClip(part.id)) : null;
}

function loadManifest(): Promise<Set<string>> {
  if (!manifest) {
    manifest = fetch(CLIP_MANIFEST)
      .then(r => (r.ok ? r.json() : null))
      .then((m: { clips?: string[] } | null) => new Set(m?.clips ?? []))
      .catch(() => new Set<string>());
  }
  return manifest;
}

async function fetchClip(id: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(`${CLIP_BASE}/${id}.mp3`);
    return res.ok ? res.arrayBuffer() : null;
  } catch {
    return null;
  }
}

function decodeOnce(key: string, load: () => Promise<ArrayBuffer | null>): Promise<AudioBuffer | null> {
  let job = decoded.get(key);
  if (!job) {
    job = (async () => {
      const ac = audioContext();
      const buf = await load();
      if (!ac || !buf) return null;
      try {
        // decodeAudioData detaches its input; keep the cached copy intact.
        return evenOutLevel(trimSilence(ac, await ac.decodeAudioData(buf.slice(0))));
      } catch {
        return null;
      }
    })();
    decoded.set(key, job);
    // Failed loads may succeed later (e.g. live TTS came back online).
    void job.then(b => { if (!b) decoded.delete(key); });
  }
  return job;
}

function announceUrl(): string {
  if (import.meta.env.DEV) return '/api/race-announce';
  const base = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!base) return '/api/race-announce';
  return `${base.replace(/\/$/, '')}/functions/v1/race-announce`;
}

async function fetchAnnounce(spoken: string): Promise<ArrayBuffer | null> {
  if (disabled) return null;
  const cached = await readCache(spoken);
  if (cached) return cached;

  const pending = inflight.get(spoken);
  if (pending) return pending;

  const job = (async () => {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
      if (anon && !import.meta.env.DEV) headers.Authorization = `Bearer ${anon}`;

      const res = await fetch(announceUrl(), {
        method: 'POST',
        headers,
        body: JSON.stringify({ text: spoken }),
      });
      if (res.status === 402 || res.status === 429) {
        disabled = true;
        return null;
      }
      if (!res.ok) return null;
      const buf = await res.arrayBuffer();
      if (buf.byteLength < 200) return null;
      await writeCache(spoken, buf);
      return buf;
    } catch {
      return null;
    } finally {
      inflight.delete(spoken);
    }
  })();

  inflight.set(spoken, job);
  return job;
}

function audioContext(): AudioContext | null {
  if (ctx) return ctx;
  try {
    ctx = new AudioContext();
  } catch {
    return null;
  }
  return ctx;
}

function isPlaying(): boolean {
  return !!ctx && current.length > 0 && ctx.currentTime < playingUntil;
}

function playBuffers(buffers: AudioBuffer[]) {
  const ac = audioContext();
  if (!ac) return;
  stopAnnounce();
  if (ac.state === 'suspended') void ac.resume().catch(() => { /* autoplay block — next click unlocks */ });

  let at = ac.currentTime + 0.02;
  const sources = buffers.map((buf, i) => {
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.connect(ac.destination);
    src.start(at);
    at += buf.duration + (i < buffers.length - 1 ? CLIP_GAP : 0);
    return src;
  });
  current = sources;
  playingUntil = at;
  sources[sources.length - 1].onended = () => {
    if (current === sources) {
      current = [];
      playingUntil = 0;
    }
  };
}

/** ElevenLabs pads each clip; trim it so stitched lines flow. */
function trimSilence(ac: AudioContext, buf: AudioBuffer): AudioBuffer {
  const data = buf.getChannelData(0);
  let start = 0;
  let end = data.length - 1;
  while (start < end && Math.abs(data[start]) < SILENCE) start++;
  while (end > start && Math.abs(data[end]) < SILENCE) end--;
  const pad = Math.floor(buf.sampleRate * 0.02);
  start = Math.max(0, start - pad);
  end = Math.min(data.length, end + pad);
  const length = end - start;
  if (length <= 0 || length >= buf.length) return buf;

  const out = ac.createBuffer(buf.numberOfChannels, length, buf.sampleRate);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    out.copyToChannel(buf.getChannelData(c).subarray(start, end), c);
  }
  return out;
}

/** Baked clips vary ~7 dB in loudness; pull each toward one RMS so stitched lines sound even. */
function evenOutLevel(buf: AudioBuffer): AudioBuffer {
  const data = buf.getChannelData(0);
  let sq = 0;
  let peak = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    sq += v * v;
    const a = Math.abs(v);
    if (a > peak) peak = a;
  }
  const rms = Math.sqrt(sq / Math.max(1, data.length));
  if (rms < 1e-4 || peak < 1e-4) return buf;
  const gain = Math.min(TARGET_RMS / rms, PEAK_CEILING / peak, MAX_GAIN);
  if (Math.abs(gain - 1) < 0.03) return buf;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const ch = buf.getChannelData(c);
    for (let i = 0; i < ch.length; i++) ch[i] *= gain;
  }
  return buf;
}

async function readCache(spoken: string): Promise<ArrayBuffer | null> {
  try {
    const cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(cacheKey(spoken));
    return hit ? hit.arrayBuffer() : null;
  } catch {
    return null;
  }
}

async function writeCache(spoken: string, buf: ArrayBuffer) {
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(cacheKey(spoken), new Response(buf, { headers: { 'Content-Type': 'audio/mpeg' } }));
  } catch { /* private mode */ }
}

function cacheKey(spoken: string): string {
  return `/announce-cache/${encodeURIComponent(spoken)}`;
}
