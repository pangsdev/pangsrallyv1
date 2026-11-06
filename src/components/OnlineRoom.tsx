import { useEffect, useRef, useState } from 'react';
import RaceRoom from './RaceRoom';
import { PREDICTIONS_ON, testSeason, type PublicRace } from '../testSeason/api';
import { FIELD_SIZE, ROOM_FULL_COUNTDOWN_SECONDS } from '../race/testSeason';
import '../race/race.css';
import { TrackBadge } from './Icons';
import { startsIn } from './OnlineRooms';
import { PickPanel } from './Predictions';

interface Props {
  categoryInfo: any;
  playerWallet: string;
  /** resume a room the player already joined (from My Races); otherwise join one */
  raceId?: string | null;
  onBack: () => void;
  /** refresh the player's status after the race */
  onFinished?: () => void;
}

/** Poll fast near the start; a waiting room only needs to show seats filling up. */
const pollMs = (msLeft: number | null) => (msLeft !== null && msLeft < 90_000 ? 2000 : 5000);
const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
};

/**
 * Online test race: join (or resume) a room, wait while real players fill it,
 * then replay the server's result on the track. A full room starts even if the
 * player leaves this page; the result and points stay in My Races.
 */
export default function OnlineRoom({ categoryInfo, playerWallet, raceId, onBack, onFinished }: Props) {
  const terrain: string = categoryInfo?.terrain || 'Forest';
  const [room, setRoom] = useState<PublicRace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  /** server clock minus browser clock, so the countdown matches the server */
  const skew = useRef(0);
  const joined = useRef<Promise<{ race: PublicRace; serverTime: string }> | null>(null);
  const [pick, setPick] = useState<{ pick: number | null; crowd: number[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [copyNote, setCopyNote] = useState<string | null>(null);
  const roomId = room?.id;

  useEffect(() => {
    if (PREDICTIONS_ON && roomId) testSeason.prediction(roomId).then(setPick).catch(() => {});
  }, [roomId]);

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
    const left = (race: PublicRace) => (race.closesAt ? Date.parse(race.closesAt) - (Date.now() + skew.current) : null);
    const poll = async (id: string) => {
      try {
        const race = apply(await testSeason.onlineStatus(id));
        if (!stopped && race.status === 'open') timer = setTimeout(() => poll(id), pollMs(left(race)));
      } catch {
        if (!stopped) timer = setTimeout(() => poll(id), 10_000); // keep trying through network blips
      }
    };
    joined.current.then(res => {
      if (stopped) return;
      const race = apply(res);
      if (race.status === 'open') timer = setTimeout(() => poll(race.id), pollMs(left(race)));
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

  const msLeft = room?.closesAt ? Math.max(0, Date.parse(room.closesAt) - (now + skew.current)) : null;
  const players = room?.players ?? [];
  const waiting = !!room && !room.closesAt;
  const seated = players.some(p => p.wallet === playerWallet);
  const seatsLeft = FIELD_SIZE - players.length;

  const takeSeat = async () => {
    if (!room) return;
    setBusy(true);
    setError(null);
    try {
      const res = await testSeason.onlineJoin(terrain, room.id);
      skew.current = Date.parse(res.serverTime) - Date.now();
      setRoom(res.race);
      onFinished?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not take this seat.');
    } finally {
      setBusy(false);
    }
  };

  const giveBack = async () => {
    if (!room) return;
    setBusy(true);
    try {
      await testSeason.onlineLeave(room.id);
      onBack();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not give your seat back.');
      setBusy(false);
    }
  };

  const copyLink = async () => {
    if (!room) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/room/${room.id}`);
      setCopyNote('Link copied');
    } catch {
      setCopyNote('Could not copy');
    }
    setTimeout(() => setCopyNote(null), 2000);
  };

  return (
    <div className="rr-root">
      <div className="rr-header">
        <button className="rr-btn" onClick={onBack}>← Rooms</button>
        <div style={{ textAlign: 'center' }}>
          <h2 className="rr-title" style={{ color: '#00c8ff' }}><TrackBadge terrain={terrain} size={26} style={{ marginRight: 8, verticalAlign: '-5px' }} />{terrain} Track · Online Race</h2>
          <p className="rr-sub">Beta Season · Equal stats for everyone · luck decides</p>
        </div>
        <div className="rr-header-spacer" />
      </div>

      <div className="or-wrap">
        {error ? (
          <div className="rr-error">
            <div style={{ fontSize: '2.5rem' }}>🌐</div>
            <p>{error}</p>
            <button className="rr-btn primary" onClick={onBack}>Back to Rooms</button>
          </div>
        ) : !room ? (
          <div className="rr-error">
            <div className="rr-spinner" style={{ margin: '0 auto' }} />
            <p>Opening the room…</p>
          </div>
        ) : (
          <div className="or-card">
            <div className="or-count">
              <div className="or-count-num">{waiting ? `${players.length}/${FIELD_SIZE}` : clock(msLeft ?? 0)}</div>
              <div className="or-count-label">
                {waiting ? `${seatsLeft} ${seatsLeft === 1 ? 'seat' : 'seats'} left` : msLeft === 0 ? 'Starting…'
                  : `${players.length >= FIELD_SIZE ? 'Room full · ' : ''}starts at ${new Date(Date.parse(room.closesAt!)).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} · ${startsIn(msLeft ?? 0)}`}
              </div>
            </div>
            <p className="or-note">
              {waiting
                ? <>No bots in this room. When the last seat is taken, the race starts {ROOM_FULL_COUNTDOWN_SECONDS / 60} minutes later.</>
                : <>All seats are taken. Stay here to watch the race start.</>}
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
            {waiting && (
              <div className="or-actions">
                {seated
                  ? <button type="button" className="rr-btn" disabled={busy} onClick={giveBack}>Give back my seat</button>
                  : <button type="button" className="rr-btn primary" disabled={busy} onClick={takeSeat}>{busy ? 'Taking your seat…' : 'Take a seat'}</button>}
                <button type="button" className="rr-btn" onClick={copyLink}>{copyNote ?? 'Copy invite link'}</button>
              </div>
            )}
            {pick && msLeft !== 0 && (
              <div className="or-pick">
                <PickPanel raceId={room.id} myPick={pick.pick} crowd={pick.crowd} onPicked={(p, crowd) => setPick({ pick: p, crowd })} />
              </div>
            )}
            <p className="or-leave">
              {waiting
                ? <>Your seat uses one of today's races only when the race starts. You can leave this page and come back from <strong>My Races</strong>.</>
                : <>You can leave this page: the race still runs, your points are saved, and you can watch the replay in <strong>My Races</strong>.</>}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
