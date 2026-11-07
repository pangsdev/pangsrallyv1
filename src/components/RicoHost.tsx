import { useEffect, useRef, useState } from 'react';
import { announcerLevel, onAnnounce } from '../race/announce';
import './rico.css';

/**
 * Rico Scales, the Pangs Cup race caller, on the broadcast screen: a booth camera shot built from
 * the owner's two stills (scripts/make-rico.mjs), mouth shut and mouth open. Nothing is redrawn:
 * the open-mouth face is a layer over the shut one, and the caller's own audio opens and shuts it
 * syllable by syllable (lip flap). The camera drifts slowly and punches in on every new line.
 *
 * Used in every race view (RaceRoom: `log` lists the latest calls) and on the Pangs Cup broadcast
 * board (`line`: what he says between races).
 */
export default function RicoHost({ line, log, className = '' }: { line?: string; log?: string[]; className?: string }) {
  const root = useRef<HTMLDivElement>(null);
  const cam = useRef<HTMLDivElement>(null);
  const mouth = useRef<HTMLImageElement>(null);
  const [said, setSaid] = useState<string | null>(null);

  useEffect(() => onAnnounce(text => {
    setSaid(text);
    const el = cam.current;
    if (!el) return;
    el.classList.remove('punch');
    void el.offsetWidth; // restart the punch-in
    el.classList.add('punch');
  }), []);

  useEffect(() => {
    let raf = 0;
    let smooth = 0;
    let open = false;
    let since = -1e9;  // when the mouth last changed
    let valley = 1;    // quietest level since the mouth shut
    let top = 0;       // loudest level since it opened
    const setMouth = (o: boolean, t: number) => {
      open = o;
      since = t;
      if (mouth.current) mouth.current.style.opacity = o ? '1' : '0';
    };
    const loop = (t: number) => {
      const lv = announcerLevel();
      // Meter: fast attack, slower release, so it reads as speech and not flicker.
      smooth = lv > smooth ? smooth + (lv - smooth) * 0.6 : smooth * 0.86;
      root.current?.style.setProperty('--lv', smooth.toFixed(3));

      // Lip flap, one opening per syllable: open when the voice rises 30% over the dip before it,
      // shut when it falls 20% from that syllable's peak (or after 220 ms, so long vowels flap too).
      // Tuned on all 149 baked clips: every clip gets at least one opening per word, ~1.2 per
      // syllable, ~4 per second. Holds of 60/50 ms keep it slower than a real mouth can move.
      if (open) {
        top = Math.max(top, lv);
        const held = t - since;
        if (held > 60 && (lv < top * 0.8 || lv < 0.04 || held > 220)) { setMouth(false, t); valley = lv; }
      } else {
        valley = Math.min(valley, lv);
        if (t - since > 50 && lv > 0.056 && lv > valley * 1.3) { setMouth(true, t); top = lv; }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const text = line ?? said ?? 'Welcome to the Pangs Cup!';
  return (
    <div className={`rico ${className}`} ref={root}>
      <div className="rico-head">
        <div className="rico-name"><b>Rico Scales</b><span>Race caller · Pangs Radio</span></div>
        <div className="rico-eq" aria-hidden="true">{[0.7, 1, 0.55, 0.9, 0.65].map((k, i) => <span key={i} style={{ '--k': k } as React.CSSProperties} />)}</div>
      </div>
      <div className="rico-cam">
        <div className="rico-drift">
          <div className="rico-shot" ref={cam}>
            <img src="/cup/rico.webp" alt="Rico Scales, the race caller, in the commentary booth" />
            <img className="rico-mouth" ref={mouth} src="/cup/rico-talk.webp" alt="" />
          </div>
        </div>
        <span className="rico-camtag"><i />CAM 1 · BOOTH</span>
        <span className="rico-onair">ON AIR</span>
      </div>
      {log ? (
        log.length ? (
          <ul className="rico-log" aria-live="polite">
            {log.slice(0, 3).map((l, i) => <li key={`${log.length - i}-${l}`}>{l}</li>)}
          </ul>
        ) : <p className="rico-log-empty">Rico calls the race when something happens.</p>
      ) : <p className="rico-line" key={text}>{text}</p>}
    </div>
  );
}
