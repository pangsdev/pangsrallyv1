import { useEffect, useRef, useState } from 'react';
import RaceRoom from './RaceRoom';
import { testSeason, type PublicRace } from '../testSeason/api';
import { FIELD_SIZE } from '../race/testSeason';
import '../race/race.css';

interface Props {
  categoryInfo: any;
  playerWallet: string;
  /** resume a room the player already joined (from My Races); otherwise join one */
  raceId?: string | null;
  onBack: () => void;
  /** refresh the player's status after the race */
  onFinished?: () => void;
}

const POLL_MS = 2000;

/**
 * Online test race: join (or resume) a room, wait while it fills, then replay
 * the server's result on the track. The room starts after its wait even if
 * the player leaves; the result and points stay in My Races.
 */
export default function OnlineRoom({ categoryInfo, playerWallet, raceId, onBack, onFinished }: Props) {
  const terrain: string = categoryInfo?.terrain || 'Forest';
  const [room, setRoom] = useState<PublicRace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  /** server clock minus browser clock, so the countdown matches the server */
  const skew = useRef(0);
  const joined = useRef<Promise<{ race: PublicRace; serverTime: string }> | null>(null);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // StrictMode runs this twice; join only once.
    joined.current ??= raceId ? testSeason.onlineStatus(raceId) : testSeason.onlineJoin(terrain);

    const apply = (res: { race: PublicRace; serverTime: string }) => {
      skew.current = Date.parse(res.serverTime) - Date.now();
      setRoom(res.race);
      return res.race;
    };
    const poll = async (id: string) => {
      try {
        const race = apply(await testSeason.onlineStatus(id));
        if (!stopped && race.status === 'open') timer = setTimeout(() => poll(id), POLL_MS);
      } catch {
        if (!stopped) timer = setTimeout(() => poll(id), POLL_MS * 2); // keep trying through network blips
      }
    };
    joined.current.then(res => {
      if (stopped) return;
      const race = apply(res);
      if (race.status === 'open') timer = setTimeout(() => poll(race.id), POLL_MS);
    }).catch(err => {
      if (!stopped) setError(err instanceof Error ? err.message : 'Could not join a room.');
    });

    const tick = setInterval(() => setNow(Date.now()), 250);
    return () => { stopped = true; clearTimeout(timer); clearInterval(tick); };
  }, [raceId, terrain]);

  if (room?.status === 'finished') {
    return (
      <RaceRoom
        categoryInfo={categoryInfo}
        title="Online Race"
        playerWallet={playerWallet}
        loadRace={() => Promise.resolve({ race: room })}
        onBack={onBack}
        onFinished={onFinished}
      />
    );
  }

  const secondsLeft = room?.closesAt ? Math.max(0, Math.ceil((Date.parse(room.closesAt) - (now + skew.current)) / 1000)) : null;
  const players = room?.players ?? [];

  return (
    <div className="rr-root">
      <div className="rr-header">
        <button className="rr-btn" onClick={onBack}>← Back to Lobby</button>
        <div style={{ textAlign: 'center' }}>
          <h2 className="rr-title" style={{ color: '#00c8ff' }}>{categoryInfo?.icon} {terrain} Track · Online Race</h2>
          <p className="rr-sub">Test Season · Equal stats for everyone · luck decides</p>
        </div>
        <div className="rr-header-spacer" />
      </div>

      <div className="or-wrap">
        {error ? (
          <div className="rr-error">
            <div style={{ fontSize: '2.5rem' }}>🌐</div>
            <p>{error}</p>
            <button className="rr-btn primary" onClick={onBack}>Back to Lobby</button>
          </div>
        ) : !room ? (
          <div className="rr-error">
            <div className="rr-spinner" style={{ margin: '0 auto' }} />
            <p>Finding a room…</p>
          </div>
        ) : (
          <div className="or-card">
            <div className="or-count">
              <div className="or-count-num">{secondsLeft ?? '–'}<span>s</span></div>
              <div className="or-count-label">{players.length >= FIELD_SIZE ? 'Room full — starting' : secondsLeft === 0 ? 'Starting…' : 'until the race starts'}</div>
            </div>
            <p className="or-note">
              <strong>{players.length}</strong> of {FIELD_SIZE} players joined. Empty lanes are filled with bots when the timer runs out.
            </p>
            <div className="or-seats">
              {Array.from({ length: FIELD_SIZE }, (_, i) => {
                const p = players[i];
                const me = p?.wallet === playerWallet;
                return (
                  <div key={i} className={`or-seat ${p ? 'taken' : ''} ${me ? 'me' : ''}`}>
                    <span className="or-seat-dot" />
                    <span>{p ? (me ? `${p.name} (You)` : p.name) : 'Open seat'}</span>
                  </div>
                );
              })}
            </div>
            <p className="or-leave">
              You can leave this page: the race still runs, your points are saved, and you can watch the replay in <strong>My Races</strong>.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
