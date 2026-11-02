/**
 * Reads Pangs Rally Beta passes from Robinhood Chain for the Profile and Inventory pages.
 * The contract has no "tokens of owner" view, so ownership comes from its Transfer events
 * (the RPC allows CORS and up to 10M blocks per query, hence the chunks).
 */
import { JsonRpcProvider, getAddress, zeroPadValue, id as topicOf } from 'ethers';

const RPC = 'https://rpc.mainnet.chain.robinhood.com';
const CHAIN_ID = 4663;
/** Block of the deploy tx (smart-contracts/deployments/PangsRallyBeta.robinhood.json). */
const DEPLOY_BLOCK = 0x639f231;
const CHUNK = 9_000_000;
const TRANSFER = topicOf('Transfer(address,address,uint256)');
const ZERO = zeroPadValue('0x00', 32);

export interface BetaPassInfo {
  /** token ids the wallet holds now */
  owned: number[];
  /** the token this wallet minted itself, if any */
  minted: number | null;
}

let provider: JsonRpcProvider | null = null;

export async function fetchBetaPasses(contract: string, wallet: string): Promise<BetaPassInfo> {
  provider ??= new JsonRpcProvider(RPC, CHAIN_ID, { staticNetwork: true });
  const me = zeroPadValue(getAddress(wallet), 32);
  const latest = await provider.getBlockNumber();
  const logs = [];
  for (let from = DEPLOY_BLOCK; from <= latest; from += CHUNK) {
    const to = Math.min(latest, from + CHUNK - 1);
    const [inbound, outbound] = await Promise.all([
      provider.getLogs({ address: contract, fromBlock: from, toBlock: to, topics: [TRANSFER, null, me] }),
      provider.getLogs({ address: contract, fromBlock: from, toBlock: to, topics: [TRANSFER, me] }),
    ]);
    logs.push(...inbound, ...outbound);
  }
  logs.sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);
  const owned = new Set<number>();
  let minted: number | null = null;
  for (const log of logs) {
    const tokenId = Number(BigInt(log.topics[3]));
    if (log.topics[2] === me) {
      owned.add(tokenId);
      if (log.topics[1] === ZERO) minted = tokenId;
    } else {
      owned.delete(tokenId);
    }
  }
  return { owned: [...owned].sort((a, b) => a - b), minted };
}
