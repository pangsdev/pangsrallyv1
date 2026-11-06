import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { seatNote, testSeason, type PlayerStatus, type RoomSummary } from '../testSeason/api';
import './lobby.css';
import { BETA_RACER_ART, FIELD_SIZE, POINTS_BY_POSITION, ROOM_FULL_COUNTDOWN_SECONDS, shortWallet } from '../race/testSeason';
import { BALL_SPRITES } from '../race/sprites';
import { ClockIcon, FlagIcon, TrackBadge } from './Icons';
import HeroRunner from './HeroRunner';

interface Props {
  categoryInfo: any;
  player: PlayerStatus;
  onSelectMode: (mode: 'bot' | 'online') => void;
  onBack: () => void;
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(sec).padStart(2, '0')}`;
};

/** Live board for the online room: the 10 seats filling up, then a ticking countdown once it is full. */
function NextRoomBoard({ terrain }: { terrain: string }) {
  const [room, setRoom] = useState<RoomSummary | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const skew = useRef(0);

  useEffect(() => {
    let live = true;
    const load = () => testSeason.rooms(terrain)
      .then(r => {
        if (!live) return;
        skew.current = Date.parse(r.serverTime) - Date.now();
        setRoom(r.rooms[0] ?? null);
      })
      .catch(() => {});
    load();
    const poll = setInterval(load, 15_000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { live = false; clearInterval(poll); clearInterval(tick); };
  }, [terrain]);

  const start = room?.startsAt ? Date.parse(room.startsAt) : null;
  const left = start ? start - (now + skew.current) : 0;
  const taken = room?.players ?? 0;
  const open = FIELD_SIZE - taken;
  return (
    <div className="lobby-board" aria-hidden="true">
      <div className="lobby-board-top">
        <span className="lobby-board-live"><i /> {start ? 'Room full' : 'Open room'}</span>
        <strong>{start ? new Date(start).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : `${taken}/${FIELD_SIZE}`}</strong>
      </div>
      <div className={`lobby-board-clock ${start ? '' : 'seats'}`}>{!room ? '…' : !start ? `${open} ${open === 1 ? 'seat' : 'seats'} left` : left > 0 ? clock(left) : 'Starting'}</div>
      <div className="lobby-board-seats">
        {Array.from({ length: FIELD_SIZE }, (_, i) => (
          <span key={i} className={i < taken ? 'on' : ''}>{i < taken && <img src={BETA_RACER_ART} alt="" />}</span>
        ))}
      </div>
      <div className="lobby-board-foot">{taken} of {FIELD_SIZE} seats taken{room?.joined ? ' · you are in' : ''}</div>
    </div>
  );
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

            <button className="lobby-mode online" disabled={!canRace} onClick={() => onSelectMode('online')}>
              <div className="lobby-runner" aria-hidden="true">
                <HeroRunner art="/landing/runner-beta.webp" ball={BALL_SPRITES.Beta} className="lobby-runner-canvas" />
              </div>
              <h3>Online Race</h3>
              <p>Race real players, no bots. When all {FIELD_SIZE} seats are taken, the race starts {ROOM_FULL_COUNTDOWN_SECONDS / 60} minutes later. A seat uses one of today's races when the race starts.</p>
              <NextRoomBoard terrain={terrain} />
              <div className="lobby-chips"><span>Real players</span><span>No bots</span><span>Up to {POINTS_BY_POSITION[0]} pts</span></div>
              <span className="lobby-cta">{canRace ? 'See Rooms' : 'Limit Reached'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
