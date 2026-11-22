/** Page buttons: ‹ 1 … 4 5 6 … 12 › (shared by the season board and the Daily Rally page). */
export function Pager({ page, pages, onPage, label = 'Pages' }: { page: number; pages: number; onPage: (page: number) => void; label?: string }) {
  if (pages <= 1) return null;
  const shown = new Set([1, pages, page - 1, page, page + 1].filter(p => p >= 1 && p <= pages));
  const list = [...shown].sort((a, b) => a - b);
  const items: (number | 'gap')[] = [];
  list.forEach((p, i) => {
    if (i > 0 && p - list[i - 1] > 1) items.push('gap');
    items.push(p);
  });
  return (
    <nav className="pager" aria-label={label}>
      <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">‹</button>
      {items.map((p, i) => p === 'gap'
        ? <span key={`gap-${i}`} className="pager-gap">…</span>
        : <button type="button" key={p} className={p === page ? 'on' : ''} aria-current={p === page ? 'page' : undefined} onClick={() => onPage(p)}>{p}</button>)}
      <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">›</button>
    </nav>
  );
}
