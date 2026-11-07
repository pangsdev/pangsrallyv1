/**
 * Pangs Cup Participant badge: the Merkle tree of a Cup's racers, built the same way by the admin
 * script (root → `setParticipants`) and the Cup page (proof → `claimParticipant`), and matching
 * PangsCup.sol: leaf = keccak256(bytes.concat(keccak256(abi.encode(wallet, cupId)))), pairs sorted
 * before hashing (OpenZeppelin MerkleProof).
 *
 * Plain TypeScript with no TS-only syntax at runtime, so Node (scripts/cup-admin.mjs, tests) can
 * import it directly.
 */
import { AbiCoder, concat, getAddress, keccak256 } from 'ethers';

export function participantLeaf(wallet: string, cupId: number): string {
  return keccak256(keccak256(AbiCoder.defaultAbiCoder().encode(['address', 'uint256'], [getAddress(wallet), cupId])));
}

const hashPair = (a: string, b: string) => keccak256(concat(a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a]));

/** Every level of the tree, leaves first (sorted, so the order of `wallets` does not matter). */
function levels(wallets: string[], cupId: number): string[][] {
  const unique = [...new Set(wallets.map(w => w.toLowerCase()))];
  if (!unique.length) throw new Error('No racers.');
  const out = [unique.map(w => participantLeaf(w, cupId)).sort()];
  while (out[out.length - 1].length > 1) {
    const prev = out[out.length - 1];
    const next: string[] = [];
    // An odd node at the end moves up as it is.
    for (let i = 0; i < prev.length; i += 2) next.push(i + 1 < prev.length ? hashPair(prev[i], prev[i + 1]) : prev[i]);
    out.push(next);
  }
  return out;
}

export function participantRoot(wallets: string[], cupId: number): string {
  const all = levels(wallets, cupId);
  return all[all.length - 1][0];
}

/** The proof for one racer, or null when the wallet did not race in this Cup. */
export function participantProof(wallets: string[], cupId: number, wallet: string): string[] | null {
  const all = levels(wallets, cupId);
  let index = all[0].indexOf(participantLeaf(wallet, cupId));
  if (index < 0) return null;
  const proof: string[] = [];
  for (let l = 0; l < all.length - 1; l++) {
    const sibling = index ^ 1;
    if (sibling < all[l].length) proof.push(all[l][sibling]);
    index >>= 1;
  }
  return proof;
}
