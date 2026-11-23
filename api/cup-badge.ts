/**
 * Metadata for the Pangs Cup soulbound badges from Cup #3 on (weekly Cups). Token id = cupId * 10 + tier
 * (PangsCup.sol badgeId); the cup-publish autopilot points each new Cup's five badges here with
 * setBadgeURI, so a weekly Cup needs no IPFS upload. Cups #1 and #2 keep their IPFS metadata.
 */
export const config = { runtime: 'edge' };

const TIERS: Record<number, { art: number; name: string; place?: string }> = {
  1: { art: 1, name: 'Champion', place: '1st' },
  2: { art: 2, name: '2nd Place', place: '2nd' },
  3: { art: 3, name: '3rd Place', place: '3rd' },
  4: { art: 4, name: 'Finalist', place: '4th-10th' },
  5: { art: 5, name: 'Participant' },
};

export default function handler(req: Request): Response {
  // /api/cup-badge/31 is rewritten to /api/cup-badge?id=31 (vercel.json)
  const url = new URL(req.url);
  const raw = url.searchParams.get('id') ?? url.pathname.split('/').pop() ?? '';
  const tokenId = Number(raw.replace(/\.json$/, ''));
  const cupId = Math.floor(tokenId / 10);
  const tier = TIERS[tokenId % 10];
  if (!Number.isInteger(tokenId) || cupId < 1 || !tier) {
    return new Response(JSON.stringify({ error: 'unknown badge' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }
  const origin = new URL(req.url).origin;
  const body = {
    name: `Pangs Cup #${cupId} ${tier.name}`,
    description: tier.place
      ? `Won in the Grand Final of Pangs Cup #${cupId}, the weekly tournament of Pangs Rally, the on-chain pangolin racing game. Soulbound: it stays with the wallet that raced. A keepsake with no cash value.`
      : `Raced in Pangs Cup #${cupId}, the weekly tournament of Pangs Rally, the on-chain pangolin racing game. Soulbound: it stays with the wallet that raced. A keepsake with no cash value.`,
    image: `${origin}/cup/badge-${tier.art}.webp`,
    external_url: 'https://pangsrally.com/cup',
    attributes: [
      { trait_type: 'Cup', value: `Pangs Cup #${cupId}` },
      { trait_type: 'Tier', value: tier.name },
      ...(tier.place ? [{ trait_type: 'Final place', value: tier.place }] : []),
      { trait_type: 'Season', value: 'Beta Season 2026' },
      { trait_type: 'Soulbound', value: 'Yes' },
    ],
  };
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600', 'Access-Control-Allow-Origin': '*' },
  });
}
