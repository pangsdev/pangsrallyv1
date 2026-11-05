import { useEffect, useRef, useState } from 'react';

interface Props {
  label: string;
  points: number | null;
  onProfile: () => void;
  onReport: () => void;
  onDisconnect: () => void;
}

/** The signed-in badge in the header. Clicking it opens a menu; signing out takes its own click. */
export default function WalletMenu({ label, points, onProfile, onReport, onDisconnect }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const pick = (action: () => void) => () => { setOpen(false); action(); };

  return (
    <div className="wm" ref={root}>
      <button type="button" className="wallet-connected-badge glass-panel wm-badge" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <span className="wallet-dot"></span>
        <span className="wm-name">{label}</span>
        {points !== null && <span className="wallet-points">{points} pts</span>}
        <svg className={`wm-caret ${open ? 'up' : ''}`} width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3 4.5 3 3 3-3" /></svg>
      </button>
      {open && (
        <div className="wm-menu" role="menu">
          <button type="button" role="menuitem" onClick={pick(onProfile)}>Profile</button>
          <button type="button" role="menuitem" onClick={pick(onReport)}>Report a bug</button>
          <div className="wm-line" />
          <button type="button" role="menuitem" className="wm-danger" onClick={pick(onDisconnect)}>Disconnect</button>
        </div>
      )}
    </div>
  );
}
