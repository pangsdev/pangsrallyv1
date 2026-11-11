import { useCallback, useEffect, useRef, useState } from 'react';
import { testSeason, type PlayerStatus, type RallyStatus } from '../testSeason/api';
import { POINTS_BY_POSITION } from '../race/testSeason';
import { clockText, day, ordinal, zoned } from './cupShared';
import './cup.css';
import './rally.css';

interface Props {
  player: PlayerStatus | null;
  onSignIn: () => void;
  /** open a rally race on the track */
  onWatch: (raceId: string) => void;
}

/** The rally from the server, refreshed often around the start. `now` follows the server clock. */
function useRally() {
  const [data, setData] = useState<RallyStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const skew = useRef(0);
  const load = useCallback(() => testSeason.rally()
    .then(d => { skew.current = Date.parse(d.serverTime) - Date.now(); setData(d); setError(null); })
    .catch(e => setError(e instanceof Error ? e.message : 'Could not load the Daily Rally.')), []);
  const live = data?.last?.rooms.some(r => !r.over);
  const soon = data ? Date.parse(data.next.startsAt) - Date.now() < 120_000 : false;
  useEffect(() => {
    load();
    const poll = setInterval(load, live || soon ? 4_000 : 20_000);
    const tick = setInterval(() => setNow(Date.now()), 500);
    return () => { clearInterval(poll); clearInterval(tick); };
  }, [load, live, soon]);
  return { data, setData, error, now: now + skew.current };
}

const letter = (room: number) => String.fromCharCode(64 + room);

export default function RallyPage({ player, onSignIn, onWatch }: Props) {
  const { data, setData, error, now } = useRally();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  if (!data) {
    return <section className="cup-root"><div className="cup-inner"><div className="cup-loading">{error ?? <span className="rr-spinner" />}</div></div></section>;
  }

  const { next, last, me } = data;
  const startsIn = Date.parse(next.startsAt) - now;
  const lastIsToday = last && last.day === new Date(now).toISOString().slice(0, 10);
  const liveNow = !!last?.rooms.some(r => !r.over);

  const act = async (fn: () => Promise<RallyStatus>) => {
    setBusy(true);
    setNote(null);
    try { setData(await fn()); } catch (e) { setNote(e instanceof Error ? e.message : 'Something went wrong.'); } finally { setBusy(false); }
  };

  const cta = !player
    ? <button className="cup-btn" onClick={onSignIn}>Connect wallet to join</button>
    : me?.registered
      ? <><span className="cup-in">✓ You're in</span><button className="cup-btn ghost" disabled={busy} onClick={() => act(testSeason.rallyLeave)}>Leave</button></>
      : <button className="cup-btn" disabled={busy} onClick={() => act(testSeason.rallyRegister)}>{busy ? 'Joining…' : 'Join the rally'}</button>;

  const mineRoom = last?.rooms.find(r => r.mine);

  return (
    <section className="cup-root rally-root">
      <div className="cup-inner">
        <div className="cup-hero">
          <div>
            <span className="cup-eyebrow">{liveNow ? <><i className="cup-live-dot" />Racing now</> : 'Every day · Free entry'}</span>
            <h1>Daily <em>Rally</em></h1>
            <p className="cup-sub">One race a day at {zoned(next.startsAt)}. Everyone who joins is drawn into rooms of 10; bots fill the empty seats. Rally points go on their own leaderboard.</p>
            <div className="cup-when">
              <div><b>{day(next.startsAt)}</b><span>Next rally</span></div>
              <div><b>{zoned(next.startsAt)}</b><span>{data.hourUtc}:00 UTC</span></div>
              <div><b>{next.registered}</b><span>{next.registered === 1 ? 'Racer in' : 'Racers in'}</span></div>
            </div>
            <div className="cup-ctas">
              {cta}
              <small>Needs a Beta pass. Uses none of your daily races. You can close the page: your race still runs.</small>
              <div className="cup-clock"><span>Starts in</span><b>{clockText(startsIn)}</b></div>
            </div>
            {note && <p className="cup-note">{note}</p>}
          </div>

          <aside className="cup-prizes rally-mine">
            <h3>Your rally</h3>
            {me ? (
              <>
                <div className="rally-mine-row"><span>Rally points</span><b>{me.points}</b></div>
                <div className="rally-mine-row"><span>Rank</span><b>{me.rank ?? '—'}</b></div>
                {me.result && last ? (
                  <div className="rally-mine-last">
                    <span>{lastIsToday ? "Today's" : "Yesterday's"} rally</span>
                    <b>{ordinal(me.result.position)} · +{me.result.points} pts</b>
                    {me.raceId && <button className="cup-btn ghost sm" onClick={() => onWatch(me.raceId!)}>Watch your race</button>}
                  </div>
                ) : mineRoom && me.raceId ? (
                  <div className="rally-mine-last">
                    <span>Your room is racing</span>
                    <b>Room {letter(mineRoom.room)}</b>
                    <button className="cup-btn sm" onClick={() => onWatch(me.raceId!)}>Watch live</button>
                  </div>
                ) : (
                  <p className="rally-mine-empty">{me.registered ? `You race at ${zoned(next.startsAt)}.` : 'Join to race in the next rally.'}</p>
                )}
              </>
            ) : (
              <p className="rally-mine-empty">Connect your wallet to join and see your rally points.</p>
            )}
            <ol className="rally-points" aria-label="Rally points by finish">
              {POINTS_BY_POSITION.slice(0, 5).map((p, i) => <li key={i}><span>{ordinal(i + 1)}</span>{p}</li>)}
              <li><span>…</span>{POINTS_BY_POSITION[POINTS_BY_POSITION.length - 1]}</li>
            </ol>
          </aside>
        </div>

        <div className="rally-grid">
          <div className="cup-card">
            <h3>{last ? `${lastIsToday ? "Today's" : "Yesterday's"} rally` : 'Rooms'} {last && <small>{day(last.startsAt)}</small>}</h3>
            {!last ? (
              <p className="rally-empty">The rooms are drawn at the start. Join before {zoned(next.startsAt)} to get a seat.</p>
            ) : (
              <div className="rally-rooms">
                {last.rooms.map(r => (
                  <div key={r.raceId} className={`rally-room ${r.mine ? 'mine' : ''}`}>
                    <div className="rally-room-head">
                      <b>Room {letter(r.room)}</b>
                      <span className={r.over ? 'done' : 'live'}>{r.over ? 'Finished' : <><i className="cup-live-dot" />Racing</>}</span>
                      <button className="cup-btn ghost sm" onClick={() => onWatch(r.raceId)}>{r.over ? 'Replay' : 'Watch'}</button>
                    </div>
                    {r.podium ? (
                      <ol className="rally-podium">{r.podium.map(p => <li key={p.name}><em>{ordinal(p.position)}</em>{p.name}</li>)}</ol>
                    ) : (
                      <p className="rally-names">{r.names.join(' · ')}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
            {next.entrants.length > 0 && (
              <div className="cup-entrants rally-entrants">
                <h4>In the next rally <small>{next.entrants.length}</small></h4>
                <div>{next.entrants.map(n => <span key={n}>{n}</span>)}</div>
              </div>
            )}
          </div>

          <div className="cup-card">
            <h3>Rally leaderboard <small>Beta Season</small></h3>
            {data.board.length === 0 ? (
              <p className="rally-empty">No rally points yet. The first rally fills this table.</p>
            ) : (
              <div className="rally-board">
                <div className="rally-board-row head"><span>#</span><span>Racer</span><span>Rallies</span><span>Wins</span><span>Pts</span></div>
                {data.board.map(r => (
                  <div key={r.rank} className={`rally-board-row ${r.me ? 'me' : ''} ${r.rank <= 3 ? `top${r.rank}` : ''}`}>
                    <span>{r.rank}</span><span className="name">{r.name}</span><span>{r.rallies}</span><span>{r.wins}</span><b>{r.points}</b>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
