/**
 * Polls the game server only while the page is on screen: a tab left open in the background asks
 * nothing, and it catches up at once when it comes back. The server's data quota is shared by every
 * player, so idle tabs must not use it.
 */
export function pollWhileVisible(load: () => unknown, everyMs: number, opts: { background?: boolean } = {}): () => void {
  const visible = () => opts.background || typeof document === 'undefined' || document.visibilityState !== 'hidden';
  const id = setInterval(() => { if (visible()) load(); }, everyMs);
  const onShow = () => { if (document.visibilityState === 'visible') load(); };
  document.addEventListener('visibilitychange', onShow);
  return () => { clearInterval(id); document.removeEventListener('visibilitychange', onShow); };
}
