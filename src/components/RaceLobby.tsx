import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { seatNote, testSeason, type PlayerStatus, type RallyStatus } from '../testSeason/api';
import './lobby.css';
import { BETA_RACER_ART, FIELD_SIZE, POINTS_BY_POSITION, shortWallet } from '../race/testSeason';
import { BALL_SPRITES } from '../race/sprites';
import { ClockIcon, FlagIcon, TrackBadge } from './Icons';
import HeroRunner from './HeroRunner';

interface Props {
  categoryInfo: any;
  player: PlayerStatus;
  onSelectMode: (mode: 'bot' | 'online' | 'daily') => void;
  onBack: () => void;
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(sec).padStart(2, '0')}`;
};

/** Live board for the Daily Rally: the countdown to the start and who is in. */
function RallyBoard() {
  const [rally, setRally] = useState<RallyStatus | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const skew = useRef(0);

  useEffect(() => {
    let live = true;
    const load = () => testSeason.rally()
      .then(r => { if (!live) return; skew.current = Date.parse(r.serverTime) - Date.now(); setRally(r); })
      .catch(() => {});
    load();
    const poll = setInterval(load, 20_000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { live = false; clearInterval(poll); clearInterval(tick); };
  }, []);

  const start = rally ? Date.parse(rally.next.startsAt) : null;
  const left = start ? start - (now + skew.current) : 0;
  const count = rally?.next.registered ?? 0;
  const shown = Math.min(count, FIELD_SIZE);
  return (
    <div className="lobby-board" aria-hidden="true">
      <div className="lobby-board-top">
        <span className="lobby-board-live"><i /> {rally?.me?.registered ? "You're in" : 'Next rally'}</span>
        <strong>{start ? new Date(start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''}</strong>
      </div>
      <div className="lobby-board-clock">{!rally ? '…' : clock(left)}</div>
      <div className="lobby-board-seats">
        {Array.from({ length: FIELD_SIZE }, (_, i) => (
          <span key={i} className={i < shown ? 'on' : ''}>{i < shown && <img src={BETA_RACER_ART} alt="" />}</span>
        ))}
      </div>
      <div className="lobby-board-foot">{count} {count === 1 ? 'racer' : 'racers'} in · bots fill empty seats</div>
    </div>
  );
}

export default function RaceLobby({ categoryInfo, player, onSelectMode, onBack }: Props) {
  const canRace = player.unlimited || player.racesLeft > 0;
  const resets = new Date(player.resetsAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const terrain = categoryInfo?.terrain ?? 'Forest';
  // 18:00 UTC in the player's own time, e.g. "9:00 PM GMT+3"
  const dailyTime = new Date(Date.UTC(2026, 0, 1, 18)).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });

  return (
    <div className="lobby-root">
      <div className="lobby-inner">
        <header className="lobby-top">
          <button onClick={onBack} className="lobby-back">← Tracks</button>
          <div className="lobby-title">
            <TrackBadge terrain={terrain} size={40} />
            <div>
              <h2>{terrain} Track</h2>
              <span>{categoryInfo?.name} · Beta Season</span>
            </div>
          </div>
          <div className={`lobby-pill ${canRace ? 'ok' : 'out'}`}>
            {canRace ? <FlagIcon size={15} /> : <ClockIcon size={15} />}
            {player.unlimited
              ? 'Unlimited races (tester)'
              : canRace
                ? `${player.racesLeft} of ${player.dailyLimit} races left today${seatNote(player)}`
                : `Daily limit reached · new races at ${resets}`}
          </div>
        </header>

        <div className="lobby-grid">
          <aside className="lobby-side">
            <div className="lobby-me">
              <img src={BETA_RACER_ART} alt="" />
              <div style={{ minWidth: 0 }}>
                <div className="lobby-me-title">Your Beta racer</div>
                <div className="lobby-me-wallet">{player.username ?? shortWallet(player.wallet)}</div>
                <div className="lobby-me-stats">
                  <span><strong>{player.points}</strong> pts</span>
                  <span><strong>{player.wins}</strong> wins</span>
                  <span>Rank <strong>{player.rank ?? '—'}</strong></span>
                  {player.streak.current > 0 && <span><strong>{player.streak.current}</strong> day streak</span>}
                </div>
              </div>
            </div>
            <p className="lobby-rules">
              Every pangolin races on <strong>equal stats</strong>, so luck decides: each racer has a 1-in-10 shot.
              Every finish scores season points.
            </p>
            <ol className="lobby-points" aria-label="Points by finish">
              {POINTS_BY_POSITION.map((p, i) => <li key={i} className={i < 3 ? 'top' : ''}><span>{i + 1}</span>{p}</li>)}
            </ol>
          </aside>

          <div className="lobby-modes">
            <button className="lobby-mode bot" disabled={!canRace} onClick={() => onSelectMode('bot')}>
              <div className="lobby-mode-art" aria-hidden="true">
                {(['Brown', 'Aurora', 'Blue'] as const).map((b, i) => <img key={b} src={BALL_SPRITES[b]} alt="" style={{ '--i': i } as CSSProperties} />)}
              </div>
              <h3>Bot Race</h3>
              <p>You against 9 bots. Starts right away.</p>
              <div className="lobby-chips"><span>Instant</span><span>9 bots</span><span>Up to {POINTS_BY_POSITION[0]} pts</span></div>
              <span className="lobby-cta">{canRace ? 'Race Now' : 'Limit Reached'}</span>
            </button>

            <button className="lobby-mode online" onClick={() => onSelectMode('daily')}>
              <div className="lobby-runner" aria-hidden="true">
                <HeroRunner art="/landing/runner-beta.webp" ball={BALL_SPRITES.Beta} className="lobby-runner-canvas" />
              </div>
              <h3>Daily Rally</h3>
              <p>One race a day for everyone, at {dailyTime}. Join for free: it uses none of your daily races. Rally points have their own leaderboard.</p>
              <RallyBoard />
              <div className="lobby-chips"><span>Every day</span><span>Free entry</span><span>Up to {POINTS_BY_POSITION[0]} pts</span></div>
              <span className="lobby-cta">Join the Rally</span>
            </button>
            {(player.bookedSeats?.length ?? 0) > 0 && (
              <button className="lobby-seat-link" onClick={() => onSelectMode('online')}>You still hold a seat in an online room · See it</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
