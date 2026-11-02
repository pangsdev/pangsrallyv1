/**
 * Beta pass gate for the test-season server: signs mint vouchers and reads
 * hasMinted() from PangsRallyBeta on chain. Off unless BETA_CONTRACT and
 * BETA_SIGNER_KEY are set.
 */
import { Contract, JsonRpcProvider, Wallet, getBytes, solidityPackedKeccak256 } from 'ethers';
import type { BetaGate } from './core.ts';

/** Robinhood Chain mainnet. */
export const BETA_DEFAULT_CHAIN_ID = 4663;
export const BETA_DEFAULT_RPC = 'https://rpc.mainnet.chain.robinhood.com';

export function createBetaGate(env: (name: string) => string | undefined): BetaGate | null {
  const contract = env('BETA_CONTRACT');
  const key = env('BETA_SIGNER_KEY');
  if (!contract || !key) return null;
  const chainId = Number(env('BETA_CHAIN_ID') || BETA_DEFAULT_CHAIN_ID);
  const signer = new Wallet(key);
  const provider = new JsonRpcProvider(env('BETA_RPC_URL') || BETA_DEFAULT_RPC, chainId, { staticNetwork: true });
  const beta = new Contract(contract, ['function hasMinted(address) view returns (bool)'], provider);
  return {
    contract,
    chainId,
    // Must match PangsRallyBeta.voucherHash: keccak256("PangsRallyBeta", chainid, contract, player), signed as an eth message.
    signVoucher: (wallet) => signer.signMessage(getBytes(solidityPackedKeccak256(
      ['string', 'uint256', 'address', 'address'], ['PangsRallyBeta', chainId, contract, wallet]))),
    hasMinted: async (wallet) => Boolean(await beta.hasMinted(wallet)),
  };
}
