/**
 * Small UI icons drawn as inline SVG (they follow `currentColor`), plus the track
 * badge, so the site does not lean on emoji, which render differently per device.
 */
import type { CSSProperties } from 'react';

type IconProps = { size?: number; className?: string; style?: CSSProperties };
const svg = (size: number) => ({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true });

export function FlagIcon({ size = 16, ...p }: IconProps) {
  return <svg {...svg(size)} {...p}><path d="M5 21V4" /><path d="M5 4h11l-2 4 2 4H5" /></svg>;
}
export function LockIcon({ size = 16, ...p }: IconProps) {
  return <svg {...svg(size)} {...p}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>;
}
export function ClockIcon({ size = 16, ...p }: IconProps) {
  return <svg {...svg(size)} {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
}

const TRACK_ART: Record<string, string> = {
  Forest: '/forest_track.webp',
  Desert: '/desert_track.webp',
  Volcanic: '/volcanic_track.webp',
  Midnight: '/midnight_track.webp',
};

/** Round badge cut from the track's own ground art. */
export function TrackBadge({ terrain, size = 28, style }: { terrain: string; size?: number; style?: CSSProperties }) {
  const src = TRACK_ART[terrain];
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block', width: size, height: size, borderRadius: '50%', flex: 'none', verticalAlign: 'middle',
        background: src ? `url(${src}) center/cover` : 'var(--bg-panel-light)',
        boxShadow: 'inset 0 0 0 2px rgba(255,255,255,0.25), 0 2px 6px rgba(0,0,0,0.35)',
        ...style,
      }}
    />
  );
}
