/**
 * Shared NFT → race visual mapping.
 *
 * A racer has two looks:
 *  - "open" pose: the NFT's own artwork (side-view pangolin with its accessories)
 *  - "ball" pose: a transparent rolled-up ball whose colour follows the `Body` trait
 */

import tokenIndex from './token-index.json';

/** Collection bodies, plus `Aurora`: the teal → blue → purple body of teaser artworks 1, 4, 9 and 10. */
export type BodyColor = 'Brown' | 'Red' | 'Rainbow' | 'Blue' | 'Black' | 'Silver' | 'Albino' | 'Gold' | 'Aurora';

export const BODY_COLORS: BodyColor[] = ['Brown', 'Red', 'Rainbow', 'Blue', 'Black', 'Silver', 'Albino', 'Gold', 'Aurora'];

/** Legacy 2x2 sprite sheets (still used by the old live-race view and the lobby thumbnails). */
export const BODY_SPRITES: Record<BodyColor, string> = {
  Brown: '/pangolin_sprite.png',
  Red: '/pangolin_sprite_red.png',
  Rainbow: '/pangolin_sprite_rainbow.png',
  Blue: '/pangolin_sprite_blue.png',
  Black: '/pangolin_sprite_black.png',
  Silver: '/pangolin_sprite_silver.png',
  Albino: '/pangolin_sprite_albino.png',
  Gold: '/pangolin_sprite_gold.png',
  Aurora: '/pangolin_sprite_blue.png',
};

/** Transparent single-frame ball sprites generated from the sheets (public/sprites/). */
export const BALL_SPRITES: Record<BodyColor, string> = {
  Brown: '/sprites/ball_brown.png',
  Red: '/sprites/ball_red.png',
  Rainbow: '/sprites/ball_rainbow.png',
  Blue: '/sprites/ball_blue.png',
  Black: '/sprites/ball_black.png',
  Silver: '/sprites/ball_silver.png',
  Albino: '/sprites/ball_albino.png',
  Gold: '/sprites/ball_gold.png',
  Aurora: '/sprites/ball_aurora.png', // scripts/make-aurora-ball.mjs
};

/** Accent colour per body, used for name tags / trails / glow. */
export const BODY_ACCENT: Record<BodyColor, number> = {
  Brown: 0xb5783c,
  Red: 0xe0453c,
  Rainbow: 0xc85cff,
  Blue: 0x3fb6c9,
  Black: 0x6b6b7b,
  Silver: 0xc9d1dc,
  Albino: 0xf2e6d8,
  Gold: 0xf5c542,
  Aurora: 0x4a6fc4,
};

export interface NftAttribute { trait_type: string; value: string | number }

export function getBodyColor(attributes?: NftAttribute[] | null, fallback: BodyColor = 'Brown'): BodyColor {
  if (!attributes) return fallback;
  const body = attributes.find(a => a.trait_type === 'Body')?.value;
  return typeof body === 'string' && (BODY_COLORS as string[]).includes(body) ? (body as BodyColor) : fallback;
}

/** Reverse lookup: sheet path (as stored in DB / old code) → body colour. */
export function bodyColorFromSheetPath(path?: string | null): BodyColor {
  if (!path) return 'Brown';
  const hit = (Object.keys(BODY_SPRITES) as BodyColor[]).find(k => BODY_SPRITES[k] === path);
  return hit ?? 'Brown';
}

/** Normalises the many avatar/image formats used across the app into a loadable URL. */
export function resolveImageUrl(src?: string | null): string | null {
  if (!src) return null;
  if (src.startsWith('ipfs://')) return src.replace('ipfs://', 'https://ipfs.io/ipfs/');
  if (src.startsWith('http') || src.startsWith('/') || src.startsWith('data:')) return src;
  return `/${src}`;
}

export function getTraitNumber(attributes: NftAttribute[] | undefined, name: string, fallback: number): number {
  const v = attributes?.find(a => a.trait_type === name)?.value;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function getTraitString(attributes: NftAttribute[] | undefined, name: string): string | null {
  const v = attributes?.find(a => a.trait_type === name)?.value;
  return typeof v === 'string' ? v : null;
}

/* ------------------------------------------------------------------ */
/* Bundled token index                                                 */
/* ------------------------------------------------------------------ */

/** `[Body, Weather Adaptation, Speed, Burst Power, Endurance]` per token id, built from public/metadata. */
type TokenIndexEntry = [string, string | null, number, number, number];
const TOKEN_INDEX = tokenIndex as unknown as Record<string, TokenIndexEntry>;

export interface TokenTraits {
  body: BodyColor;
  weather: string | null;
  stats: { speed: number; burst: number; endurance: number };
}

/** Synchronous lookup of a token's racing traits (no network). Returns null for unknown ids. */
export function getTokenTraits(tokenId: number | string): TokenTraits | null {
  const e = TOKEN_INDEX[String(tokenId)];
  if (!e) return null;
  const body = (BODY_COLORS as string[]).includes(e[0]) ? (e[0] as BodyColor) : 'Brown';
  return { body, weather: e[1] ?? null, stats: { speed: e[2], burst: e[3], endurance: e[4] } };
}

/** Fetches the public metadata of a token and returns its Body colour (fallback when the index has no entry). */
export async function fetchBodyColorForToken(tokenId: number): Promise<{ body: BodyColor; attributes: NftAttribute[]; name: string } | null> {
  try {
    const res = await fetch(`/metadata/${tokenId}.json`);
    if (!res.ok) return null;
    const text = await res.text();
    if (!text.trim().startsWith('{')) return null;
    const json = JSON.parse(text);
    const attributes: NftAttribute[] = Array.isArray(json.attributes) ? json.attributes : [];
    return { body: getBodyColor(attributes), attributes, name: typeof json.name === 'string' ? json.name : `Pangs Rally #${tokenId}` };
  } catch {
    return null;
  }
}
