/** Visual theme per track terrain. Colours are 0xRRGGBB numbers for Pixi. */
export interface TrackTheme {
  id: string;
  skyTop: number;
  skyBottom: number;
  /** tileable ground texture, or null to use a flat colour */
  groundTexture: string | null;
  groundColor: number;
  /** wash of groundColor over a busy ground texture (0–1) */
  groundCalm?: number;
  /** darkening overlay on the road band (0–1) */
  roadShade: number;
  laneLine: number;
  laneLineAlpha: number;
  edgeColor: number;
  /** far → near mountain ranges */
  farHills: number[];
  /** colour of the dense tree/rock silhouette band on the horizon */
  treeline: number;
  decor: 'trees' | 'cacti' | 'rocks' | 'pines';
  decorColors: number[];
  trunk: number;
  dust: number;
  dustAlpha: number;
  /** celestial body: colour + glow colour (sun / moon) */
  sun: { color: number; glow: number; x: number; y: number; rays: boolean };
  /** cloud tint (null = no clouds) */
  cloud: number | null;
  /** ambient drifting particles */
  ambient: 'leaves' | 'sand' | 'embers' | 'fireflies';
  ambientColors: number[];
  /** fence + bunting colours */
  fence: number;
  /** running rail along the far side */
  rail: number;
  /** how much the track's edge colour tones down the trackside boards (0–1) */
  boardShade: number;
  /** kerb stripes along both edges of the course */
  kerb: [number, number];
  bunting: number[];
  ember?: number;
  stars?: boolean;
  hudAccent: string;
}

export const THEMES: Record<string, TrackTheme> = {
  forest: {
    id: 'forest',
    skyTop: 0x5fa6d9,
    skyBottom: 0xdcefc9,
    groundTexture: '/forest_track.webp',
    groundColor: 0x4f8a3a,
    groundCalm: 0.62,
    roadShade: 0.22,
    laneLine: 0xffffff,
    laneLineAlpha: 0.3,
    edgeColor: 0x2f5a2a,
    farHills: [0x8fb6c9, 0x6f9a8a, 0x4f7f58],
    treeline: 0x2c5a35,
    decor: 'trees',
    decorColors: [0x2e6b34, 0x3c8a3f, 0x24552b, 0x4f9a46],
    trunk: 0x4a2e18,
    dust: 0xc9a66b,
    dustAlpha: 0.55,
    sun: { color: 0xfff4c2, glow: 0xffe9a0, x: 0.78, y: 0.3, rays: true },
    cloud: 0xffffff,
    ambient: 'leaves',
    ambientColors: [0x7bc26a, 0xb9d86a, 0xd9a24a],
    fence: 0x8a5a2b,
    boardShade: 0.16,
    rail: 0xf4f6f2,
    kerb: [0xd8342a, 0xf4f4f0],
    bunting: [0xff5e5e, 0xffd54a, 0x5ec8ff, 0x7cfc9a, 0xff9ddb],
    hudAccent: '#b8ce55',
  },
  desert: {
    id: 'desert',
    skyTop: 0xe9a35a,
    skyBottom: 0xfbe6b8,
    groundTexture: '/desert_track.webp',
    groundColor: 0xe0b86a,
    roadShade: 0.16,
    laneLine: 0x7a4a16,
    laneLineAlpha: 0.28,
    edgeColor: 0xb8863e,
    farHills: [0xe3b57a, 0xcf9a5c, 0xb07a44],
    treeline: 0xa8703a,
    decor: 'cacti',
    decorColors: [0x5c8f3f, 0x4c7a34, 0x6ea04a, 0x9a7a4a],
    trunk: 0x7a4a2a,
    dust: 0xe8cf9a,
    dustAlpha: 0.7,
    sun: { color: 0xfff1c9, glow: 0xffc37a, x: 0.22, y: 0.26, rays: true },
    cloud: 0xfff3dd,
    ambient: 'sand',
    ambientColors: [0xf3dcae, 0xe7c88e],
    fence: 0x9a6a3a,
    boardShade: 0.16,
    rail: 0xf2e6cf,
    kerb: [0xc9552a, 0xf4e8cf],
    bunting: [0xff7a3a, 0xffd54a, 0xffffff, 0xd9534f],
    hudAccent: '#e67e22',
  },
  volcanic: {
    id: 'volcanic',
    skyTop: 0x1a0a10,
    skyBottom: 0x8a2f1e,
    groundTexture: '/volcanic_track.webp',
    groundColor: 0x2b2224,
    roadShade: 0.1,
    laneLine: 0xff7a2a,
    laneLineAlpha: 0.26,
    edgeColor: 0x1a1214,
    farHills: [0x5a2622, 0x3f1a18, 0x2a0f10],
    treeline: 0x241214,
    decor: 'rocks',
    decorColors: [0x3b2f30, 0x2b2122, 0x4a3a3a, 0x5a2a20],
    trunk: 0x2a1a1a,
    dust: 0x8a8a8a,
    dustAlpha: 0.5,
    sun: { color: 0xff9a4a, glow: 0xff4a1a, x: 0.5, y: 0.34, rays: false },
    cloud: null,
    ambient: 'embers',
    ambientColors: [0xff7a2a, 0xffb347, 0xff4a1a],
    fence: 0x3a2a2a,
    boardShade: 0.42,
    rail: 0x8a7670,
    kerb: [0xff5a1f, 0x2a2224],
    bunting: [0xff7a2a, 0xffd54a, 0xff4a1a],
    ember: 0xff7a2a,
    hudAccent: '#e74c3c',
  },
  midnight: {
    id: 'midnight',
    skyTop: 0x060818,
    skyBottom: 0x27306a,
    groundTexture: '/midnight_track.webp',
    groundColor: 0x1f2748,
    roadShade: 0.25,
    laneLine: 0x9fb3ff,
    laneLineAlpha: 0.28,
    edgeColor: 0x0d1130,
    farHills: [0x252c5e, 0x1a2047, 0x121636],
    treeline: 0x0b1030,
    decor: 'pines',
    decorColors: [0x101a3a, 0x0c1430, 0x172247, 0x0a0f26],
    trunk: 0x0a0a1e,
    dust: 0x9fb3ff,
    dustAlpha: 0.45,
    sun: { color: 0xf4f1dc, glow: 0x9fb3ff, x: 0.76, y: 0.28, rays: false },
    cloud: 0x3a4480,
    ambient: 'fireflies',
    ambientColors: [0xcfff7a, 0xfff79a],
    fence: 0x2a2f55,
    boardShade: 0.5,
    rail: 0xaab6ff,
    kerb: [0x6a5cff, 0xdfe4ff],
    bunting: [0x9fb3ff, 0xff9ddb, 0xcfff7a],
    stars: true,
    hudAccent: '#9b59b6',
  },
};

export function getTheme(terrain?: string | null): TrackTheme {
  const key = (terrain || 'forest').toLowerCase();
  return THEMES[key] ?? THEMES.forest;
}
