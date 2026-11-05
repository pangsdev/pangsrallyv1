import { useEffect, useRef, useState } from 'react';
import { seatNote, testSeason, type RoomSummary } from '../testSeason/api';
import { OPEN_ROOMS, ROOM_SLOT_MINUTES } from '../race/testSeason';
import type { PlayerStatus } from '../testSeason/api';
import { ClockIcon, TrackBadge } from './Icons';
import './lobby.css';

interface Props {
  categoryInfo: any;
  player: PlayerStatus;
  /** open the waiting room of a room the player has a seat in */
  onOpenRoom: (roomId: string) => void;
  onBack: () => void;
  onJoined: () => void;
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
 * Online rooms made by the game: the next few start times, seats taken, and a Join button.
 * Joining spends one of the day's races; the player can then leave and come back for the replay.
 */
export default function OnlineRooms({ categoryInfo, player, onOpenRoom, onBack, onJoined }: Props) {
  const terrain: string = categoryInfo?.terrain || 'Forest';
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
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
              <span>{terrain} Track · a new room every {ROOM_SLOT_MINUTES} minutes</span>
            </div>
          </div>
          <div className={`lobby-pill ${canRace ? 'ok' : 'out'}`}>
            <ClockIcon size={15} />
            {player.unlimited ? 'Unlimited races (tester)' : `${player.racesLeft} of ${player.dailyLimit} races left today${seatNote(player)}`}
          </div>
        </header>

        <p className="rooms-intro">
          The game keeps {OPEN_ROOMS} rooms open. Each starts at its time, or as soon as all 10 seats are taken; empty lanes get bots.
          Joining uses one of your daily races. You can leave after joining: the race still runs and the replay waits in <strong>My Races</strong>.
        </p>
        {error && <div className="rooms-error">{error}</div>}

        <div className="rooms-list">
          {!rooms ? (
            <div className="rooms-loading"><div className="rr-spinner" /></div>
          ) : rooms.map(room => {
            const start = Date.parse(room.startsAt);
            const left = start - (now + skew.current);
            const full = room.players >= room.maxPlayers;
            return (
              <article key={room.id} className={`rooms-card ${room.joined ? 'in' : ''}`}>
                <div className="rooms-time">
                  <strong>{new Date(start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</strong>
                  <span>{startsIn(left)}</span>
                </div>
                <div className="rooms-seats">
                  <div className="rooms-bar"><span style={{ width: `${(room.players / room.maxPlayers) * 100}%` }} /></div>
                  <span>{room.players} of {room.maxPlayers} players</span>
                </div>
                <button
                  className={`rooms-join ${room.joined ? 'in' : ''}`}
                  disabled={joining !== null || (!room.joined && (full || !canRace))}
                  onClick={() => join(room)}
                >
                  {room.joined ? "You're in · Open" : joining === room.id ? 'Joining…' : full ? 'Full' : canRace ? 'Join' : 'Limit reached'}
                </button>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}
