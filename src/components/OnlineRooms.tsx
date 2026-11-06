import { useEffect, useRef, useState } from 'react';
import { PREDICTIONS_ON, seatNote, testSeason, type RoomSummary } from '../testSeason/api';
import { FIELD_SIZE, ROOM_FULL_COUNTDOWN_SECONDS } from '../race/testSeason';
import type { PlayerStatus } from '../testSeason/api';
import { ClockIcon, TrackBadge } from './Icons';
import { PickPanel } from './Predictions';
import './lobby.css';

interface Props {
  categoryInfo: any;
  player: PlayerStatus;
  /** open the waiting room of a room the player has a seat in */
  onOpenRoom: (roomId: string) => void;
  onBack: () => void;
  onJoined: () => void;
  onPredictions: () => void;
}

const REFRESH_MS = 10_000;

/** "in 1 h 05 min", "in 12 min", "in 40 s" */
export function startsIn(ms: number): string {
  if (ms <= 0) return 'starting now';
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `in ${s} s`;
  const m = Math.ceil(s / 60);
  if (m < 60) return `in ${m} min`;
  return `in ${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

/**
 * Online rooms made by the game: the room filling up, and any full room counting down to its start.
 * A seat keeps one of the day's races back and uses it when the race starts.
 */
export default function OnlineRooms({ categoryInfo, player, onOpenRoom, onBack, onJoined, onPredictions }: Props) {
  const terrain: string = categoryInfo?.terrain || 'Forest';
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [picking, setPicking] = useState<string | null>(null);
  const skew = useRef(0);
  const canRace = player.unlimited || player.racesLeft > 0;

  useEffect(() => {
    let live = true;
    const load = () => testSeason.rooms(terrain)
      .then(r => { if (!live) return; skew.current = Date.parse(r.serverTime) - Date.now(); setRooms(r.rooms); setError(null); })
      .catch(e => { if (live) setError(e.message); });
    load();
    const poll = setInterval(load, REFRESH_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { live = false; clearInterval(poll); clearInterval(tick); };
  }, [terrain]);

  const join = async (room: RoomSummary) => {
    if (room.joined) return onOpenRoom(room.id);
    setJoining(room.id);
    try {
      const res = await testSeason.onlineJoin(terrain, room.id);
      onJoined();
      onOpenRoom(res.race.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not join this room.');
      testSeason.rooms(terrain).then(r => setRooms(r.rooms)).catch(() => {});
    } finally {
      setJoining(null);
    }
  };

  return (
    <div className="lobby-root">
      <div className="lobby-inner">
        <header className="lobby-top">
          <button onClick={onBack} className="lobby-back">← Modes</button>
          <div className="lobby-title">
            <TrackBadge terrain={terrain} size={40} />
            <div>
              <h2>Online Rooms</h2>
              <span>{terrain} Track · real players only</span>
            </div>
          </div>
          <div className={`lobby-pill ${canRace ? 'ok' : 'out'}`}>
            <ClockIcon size={15} />
            {player.unlimited ? 'Unlimited races (tester)' : `${player.racesLeft} of ${player.dailyLimit} races left today${seatNote(player)}`}
          </div>
        </header>

        <p className="rooms-intro">
          No bots here. A room waits until all {FIELD_SIZE} seats are taken, then the race starts {ROOM_FULL_COUNTDOWN_SECONDS / 60} minutes later and a new room opens.
          Your seat uses one of today's races only when the race starts, and you can give it back until the room is full.
          {PREDICTIONS_ON && <>{' '}Predicting who wins is free, even if you do not race: <button type="button" className="rooms-link" onClick={onPredictions}>see the Prediction League</button>.</>}
        </p>
        {error && <div className="rooms-error">{error}</div>}

        <div className="rooms-list">
          {!rooms ? (
            <div className="rooms-loading"><div className="rr-spinner" /></div>
          ) : rooms.map(room => {
            const start = room.startsAt ? Date.parse(room.startsAt) : null;
            const left = start ? start - (now + skew.current) : 0;
            const full = start !== null || room.players >= room.maxPlayers;
            const open = room.maxPlayers - room.players;
            return (
              <article key={room.id} className={`rooms-card ${room.joined ? 'in' : ''}`}>
                <div className="rooms-time">
                  <strong>{start ? new Date(start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : `${open} ${open === 1 ? 'seat' : 'seats'} left`}</strong>
                  <span>{start ? startsIn(left) : 'Waiting for players'}</span>
                </div>
                <div className="rooms-seats">
                  <div className="rooms-bar"><span style={{ width: `${(room.players / room.maxPlayers) * 100}%` }} /></div>
                  <span>{room.players} of {room.maxPlayers} players</span>
                  {room.names.length > 0 && <span className="rooms-names">{room.names.join(' · ')}</span>}
                </div>
                <button
                  className={`rooms-join ${room.joined ? 'in' : ''}`}
                  disabled={joining !== null || (!room.joined && (full || !canRace))}
                  onClick={() => join(room)}
                >
                  {room.joined ? "You're in · Open" : joining === room.id ? 'Joining…' : full ? 'Full' : canRace ? 'Take a seat' : 'Limit reached'}
                </button>
                {PREDICTIONS_ON && <button
                  type="button"
                  className={`rooms-predict ${room.myPick ? 'done' : ''}`}
                  aria-expanded={picking === room.id}
                  onClick={() => setPicking(picking === room.id ? null : room.id)}
                >
                  {room.myPick ? `Your pick: Number ${room.myPick}` : 'Predict the winner'}
                </button>}
                {PREDICTIONS_ON && picking === room.id && (
                  <div className="rooms-pick">
                    <PickPanel
                      raceId={room.id}
                      myPick={room.myPick}
                      crowd={room.crowd}
                      onPicked={(pick, crowd) => setRooms(list => list?.map(r => r.id === room.id ? { ...r, myPick: pick, crowd } : r) ?? null)}
                    />
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}
