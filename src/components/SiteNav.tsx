import { useEffect, useRef, useState } from 'react';

/** The views the header can open (a subset of App's views). */
export type NavView = 'rally' | 'daily' | 'cup' | 'leaderboard' | 'how-to-play' | 'inventory' | 'marketplace' | 'laboratory';

interface Props {
  /** App's current view */
  view: string;
  go: (view: NavView) => void;
  /** a Pangs Cup exists */
  hasCup: boolean;
}

/** Views that belong to each main item, so the item stays lit on its inner pages. */
const RACE_VIEWS = ['rally', 'race-lobby', 'bot-race', 'online-rooms', 'online-race', 'room-browser', 'race-room', 'live-race'];

const MORE: { view: NavView; label: string; soon?: boolean }[] = [
  { view: 'inventory', label: 'My Collection' },
  { view: 'marketplace', label: 'Marketplace', soon: true },
  { view: 'laboratory', label: 'Laboratory', soon: true },
];

/** Header navigation: five main items and a "More" menu (inline on phones). */
export default function SiteNav({ view, go, hasCup }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', esc); };
  }, [open]);

  const item = (target: NavView, label: string, active: boolean, extra = '') => (
    <button type="button" className={`nav-item ${active ? 'active' : ''} ${extra}`} aria-current={active ? 'page' : undefined} onClick={() => { setOpen(false); go(target); }}>
      {label}
    </button>
  );
  const moreActive = MORE.some(m => m.view === view);

  return (
    <nav className="nav-links" aria-label="Main">
      {item('rally', 'Race', RACE_VIEWS.includes(view))}
      {item('daily', 'Daily Rally', view === 'daily')}
      {hasCup && item('cup', 'Pangs Cup', view === 'cup', 'nav-cup')}
      {item('leaderboard', 'Leaderboard', view === 'leaderboard' || view === 'predictions')}
      {item('how-to-play', 'Vision', view === 'how-to-play')}
      <div className={`nav-more ${open ? 'open' : ''}`} ref={root}>
        <button type="button" className={`nav-item nav-more-btn ${moreActive ? 'active' : ''}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}>
          More
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3 4.5 3 3 3-3" /></svg>
        </button>
        <div className="nav-more-menu" role="menu">
          {MORE.map(m => (
            <button key={m.view} type="button" role="menuitem" className={`nav-item ${view === m.view ? 'active' : ''}`} onClick={() => { setOpen(false); go(m.view); }}>
              {m.label}{m.soon && <span className="nav-soon">Soon</span>}
            </button>
          ))}
        </div>
      </div>
    </nav>
  );
}
