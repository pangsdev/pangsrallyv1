import type { CSSProperties } from 'react';
import type { PlayerStatus } from '../testSeason/api';
import './lobby.css';
import { BETA_RACER_ART, POINTS_BY_POSITION, ROOM_SLOT_MINUTES, shortWallet } from '../race/testSeason';
import { BALL_SPRITES } from '../race/sprites';
import { ClockIcon, FlagIcon, TrackBadge } from './Icons';

interface Props {
  categoryInfo: any;
  player: PlayerStatus;
  onSelectMode: (mode: 'bot' | 'online') => void;
  onBack: () => void;
}

export default function RaceLobby({ categoryInfo, player, onSelectMode, onBack }: Props) {
  const canRace = player.unlimited || player.racesLeft > 0;
  const resets = new Date(player.resetsAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const terrain = categoryInfo?.terrain ?? 'Forest';

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
                ? `${player.racesLeft} of ${player.dailyLimit} races left today`
                : `Daily limit reached · new races at ${resets}`}
          </div>
        </header>

        <div className="lobby-grid">
          <aside className="lobby-side">
            <div className="lobby-me">
              <img src={BETA_RACER_ART} alt="" />
              <div style={{ minWidth: 0 }}>
                <div className="lobby-me-title">Your Beta racer</div>
                <div className="lobby-me-wallet">{shortWallet(player.wallet)}</div>
                <div className="lobby-me-stats">
                  <span><strong>{player.points}</strong> pts</span>
                  <span><strong>{player.wins}</strong> wins</span>
                  <span>Rank <strong>{player.rank ?? '—'}</strong></span>
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

            <button className="lobby-mode online" disabled={!canRace} onClick={() => onSelectMode('online')}>
              <div className="lobby-mode-art crowd" aria-hidden="true">
                {[1, 0, 2].map((k, i) => <img key={k} src={BETA_RACER_ART} alt="" style={{ '--i': i } as CSSProperties} />)}
              </div>
              <h3>Online Race</h3>
              <p>Pick a room and race other players. A new room starts every {ROOM_SLOT_MINUTES} minutes; empty lanes get bots.</p>
              <div className="lobby-chips"><span>Real players</span><span>Up to 10</span><span>Up to {POINTS_BY_POSITION[0]} pts</span></div>
              <span className="lobby-cta">{canRace ? 'See Rooms' : 'Limit Reached'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
