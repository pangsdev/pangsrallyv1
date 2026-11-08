/**
 * Browser wallets. Every installed wallet extension (MetaMask, Rabby, OKX, …) announces itself through
 * EIP-6963, so the player can pick one when they connect. `window.ethereum` alone is whichever
 * extension grabbed it last (often Rabby), which left no way to choose another wallet.
 *
 * The pick is remembered (by the wallet's rdns) so the rest of the app (mint, claim, NFTs) talks to
 * the same wallet; `getEthereum()` falls back to `window.ethereum` when nothing was picked.
 */
export interface Eip1193 {
  request(a: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, fn: (...args: never[]) => void): void;
  removeListener?(event: string, fn: (...args: never[]) => void): void;
}
export interface WalletOption {
  /** reverse-DNS id, e.g. io.metamask, io.rabby, com.okex.wallet */
  rdns: string;
  name: string;
  /** data: URI the wallet ships for its own icon */
  icon: string;
  provider: Eip1193;
}

const PICK_KEY = 'pangsrally_wallet';
const found = new Map<string, WalletOption>();
const listeners = new Set<() => void>();

type AnnounceEvent = Event & { detail?: { info?: { rdns?: string; name?: string; icon?: string; uuid?: string }; provider?: Eip1193 } };

if (typeof window !== 'undefined') {
  window.addEventListener('eip6963:announceProvider', (e: Event) => {
    const { info, provider } = (e as AnnounceEvent).detail ?? {};
    if (!info || !provider) return;
    const rdns = info.rdns || info.uuid || info.name || 'wallet';
    if (found.has(rdns)) return;
    found.set(rdns, { rdns, name: info.name || 'Wallet', icon: typeof info.icon === 'string' && info.icon.startsWith('data:image/') ? info.icon : '', provider });
    listeners.forEach(fn => fn());
  });
  window.dispatchEvent(new Event('eip6963:requestProvider'));
}

/** Installed wallets that announced themselves (EIP-6963). */
export function listWallets(): WalletOption[] {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('eip6963:requestProvider'));
  return [...found.values()];
}

/** Calls `fn` whenever another wallet announces itself; returns the unsubscribe. */
export function onWalletsChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function legacyEthereum(): Eip1193 | null {
  if (typeof window === 'undefined') return null;
  return ((window as unknown as { ethereum?: Eip1193 }).ethereum) ?? null;
}

/** True when any browser wallet is there. */
export function hasAnyWallet(): boolean {
  return found.size > 0 || !!legacyEthereum();
}

export function pickWallet(rdns: string | null) {
  try {
    if (rdns) localStorage.setItem(PICK_KEY, rdns);
    else localStorage.removeItem(PICK_KEY);
  } catch { /* private mode */ }
}

function pickedRdns(): string | null {
  try { return localStorage.getItem(PICK_KEY); } catch { return null; }
}

/** The wallet the player connected with, or the browser's default one. */
export function getEthereum(): Eip1193 | null {
  const rdns = pickedRdns();
  return (rdns && found.get(rdns)?.provider) || legacyEthereum();
}

/**
 * Lets go of the site's wallet permission where the wallet supports it (MetaMask, Rabby), so the next
 * Connect asks again which account to use. Best effort: older wallets do not know the method.
 */
export async function forgetWallet() {
  const eth = getEthereum();
  pickWallet(null);
  try { await eth?.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] }); } catch { /* not supported */ }
}
