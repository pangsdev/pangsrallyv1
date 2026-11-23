import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getSession, testSeason, withRallyMe, type PlayerStatus, type RallyBoardEntry, type RallyStatus } from '../testSeason/api';
import { Pager } from './Pager';
import { POINTS_BY_POSITION } from '../race/testSeason';
import { clockText, day, ordinal, zoned } from './cupShared';
import './cup.css';
import './rally.css';
import { pollWhileVisible } from '../testSeason/poll';

interface Props {
  player: PlayerStatus | null;
  onSignIn: () => void;
  /** open a rally race on the track */
  onWatch: (raceId: string) => void;
}

/**
 * The rally as everyone sees it, read through the site cache (often around the start); the signed-in
 * player's part is worked out in the browser (withRallyMe). An answer from join/leave goes in with
 * setData, and older cached answers are skipped until the cache has caught up. `now` follows the server clock.
 */
function useRally() {
  const [raw, setRaw] = useState<RallyStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const skew = useRef(0);
  const fresh = useRef(0);
  const load = useCallback(() => testSeason.rallyPublic()
    .then(({ data: d, age }) => {
      skew.current = Date.parse(d.serverTime) + age * 1000 - Date.now();
      if (Date.parse(d.serverTime) < fresh.current) return;
      setRaw(d);
      setError(null);
    })
    .catch(e => setError(e instanceof Error ? e.message : 'Could not load the Daily Rally.')), []);
  const setData = useCallback((d: RallyStatus) => { fresh.current = Date.parse(d.serverTime); setRaw(d); }, []);
  const live = raw?.last?.rooms.some(r => !r.over);
  const soon = raw ? Date.parse(raw.next.startsAt) - Date.now() < 120_000 : false;
  useEffect(() => {
    load();
    const stop = pollWhileVisible(load, live || soon ? 5_000 : 60_000);
    const tick = setInterval(() => setNow(Date.now()), 500);
    return () => { stop(); clearInterval(tick); };
  }, [load, live, soon]);
  const wallet = getSession()?.wallet ?? null;
  const data = useMemo(() => (raw ? withRallyMe(raw, wallet) : null), [raw, wallet]);
  return { data, setData, error, now: now + skew.current };
}

const ROOMS_PER_PAGE = 12;
const BOARD_PER_PAGE = 15;

const letter = (room: number) => String.fromCharCode(64 + room);

export default function RallyPage({ player, onSignIn, onWatch }: Props) {
  const { data, setData, error, now } = useRally();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [roomPage, setRoomPage] = useState(1);
  const [find, setFind] = useState('');
  const [tab, setTab] = useState<'week' | 'all'>('week');
  const [boardPage, setBoardPage] = useState(1);

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
  // undefined: no weekly table on this server; null: no points this week yet
  const weekRow = data.week ? data.week.board.find(r => r.me) ?? null : undefined;

  return (
    <section className="cup-root rally-root">
      <div className="cup-inner">
        <div className="cup-hero">
          <div>
            <span className="cup-eyebrow">{liveNow ? <><i className="cup-live-dot" />Racing now</> : 'Every day · Free entry'}</span>
            <h1>Daily <em>Rally</em></h1>
            <p className="cup-sub">One race a day at {zoned(next.startsAt)}. Everyone who joins is drawn into rooms of 10; bots fill the empty seats. Rally points go on their own leaderboard{data.week?.cupSeats ? <>, and the week's top {data.week.cupSeats} keep a seat in Monday's Pangs Cup</> : null}.</p>
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
                <div className="rally-mine-row"><span>All-time rank</span><b>{me.rank ?? '—'}</b></div>
                {weekRow !== undefined && (
                  <div className="rally-mine-row"><span>This week</span><b>{weekRow ? `#${weekRow.rank} · ${weekRow.points} pts` : '—'}</b></div>
                )}
                {weekRow && data.week && weekRow.rank <= data.week.cupSeats && <p className="rally-mine-seat">✓ You keep a seat in Monday's Pangs Cup</p>}
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
          <RoomsCard data={data} lastIsToday={!!lastIsToday} page={roomPage} setPage={setRoomPage} find={find} setFind={setFind} onWatch={onWatch} />
          <BoardCard data={data} tab={tab} setTab={t => { setTab(t); setBoardPage(1); }} page={boardPage} setPage={setBoardPage} />
        </div>
      </div>
    </section>
  );
}

/** Today's (or yesterday's) rooms: my room first, a name search, and pages of twelve compact tiles. */
function RoomsCard({ data, lastIsToday, page, setPage, find, setFind, onWatch }: {
  data: RallyStatus; lastIsToday: boolean; page: number; setPage: (p: number) => void;
  find: string; setFind: (s: string) => void; onWatch: (raceId: string) => void;
}) {
  const { last, next } = data;
  const q = find.trim().toLowerCase();
  const rooms = useMemo(() => {
    const list = [...(last?.rooms ?? [])].sort((a, b) => Number(b.mine) - Number(a.mine) || a.room - b.room);
    if (!q) return list;
    return list.filter(r => (r.players?.map(p => p.name) ?? r.names).some(n => n.toLowerCase().includes(q)));
  }, [last, q]);
  const pages = Math.max(1, Math.ceil(rooms.length / ROOMS_PER_PAGE));
  const at = Math.min(page, pages);
  const shown = rooms.slice((at - 1) * ROOMS_PER_PAGE, at * ROOMS_PER_PAGE);
  const racers = last?.rooms.reduce((n, r) => n + (r.players?.length ?? r.names.length), 0) ?? 0;
  const more = next.registered - next.entrants.length;

  return (
    <div className="cup-card rally-rooms-card">
      <div className="rally-card-head">
        <h3>{last ? `${lastIsToday ? "Today's" : "Yesterday's"} rally` : 'Rooms'} {last && <small>{day(last.startsAt)} · {last.rooms.length} rooms · {racers} racers</small>}</h3>
        {last && last.rooms.length > ROOMS_PER_PAGE / 2 && (
          <input className="rally-find" type="search" placeholder="Find a racer" value={find} onChange={e => { setFind(e.target.value); setPage(1); }} aria-label="Find a racer's room" />
        )}
      </div>
      {!last ? (
        <p className="rally-empty">The rooms are drawn at the start. Join before {zoned(next.startsAt)} to get a seat.</p>
      ) : rooms.length === 0 ? (
        <p className="rally-empty">No room has a racer called “{find}”.</p>
      ) : (
        <>
          <div className="rally-rooms">
            {shown.map(r => {
              const placed = r.players?.filter(p => p.position !== null).sort((a, b) => a.position! - b.position!) ?? null;
              const podium = placed?.length ? placed.slice(0, 3).map(p => ({ name: p.name, position: p.position! })) : r.podium;
              const me = r.mine ? r.players?.find(p => p.wallet === getSession()?.wallet?.toLowerCase()) : undefined;
              return (
                <div key={r.raceId} className={`rally-room ${r.mine ? 'mine' : ''}`}>
                  <div className="rally-room-head">
                    <b>Room {letter(r.room)}</b>
                    {r.mine && <em className="rally-you">You{me?.position ? ` · ${ordinal(me.position)}` : ''}</em>}
                    <span className={r.over ? 'done' : 'live'}>{r.over ? '' : <><i className="cup-live-dot" />Live</>}</span>
                    <button className="cup-btn ghost sm" onClick={() => onWatch(r.raceId)}>{r.over ? 'Replay' : 'Watch'}</button>
                  </div>
                  {podium ? (
                    <ol className="rally-podium">{podium.map(p => <li key={p.name}><em>{ordinal(p.position)}</em><span>{p.name}</span></li>)}</ol>
                  ) : (
                    <p className="rally-names">{(r.players?.map(p => p.name) ?? r.names).join(' · ')}</p>
                  )}
                </div>
              );
            })}
          </div>
          <Pager page={at} pages={pages} onPage={setPage} label="Rooms" />
        </>
      )}
      {next.registered > 0 && (
        <div className="cup-entrants rally-entrants">
          <h4>In the next rally <small>{next.registered}</small></h4>
          <div>
            {next.entrants.slice(0, 18).map(n => <span key={n}>{n}</span>)}
            {more + Math.max(0, next.entrants.length - 18) > 0 && <span className="rally-more">+{more + Math.max(0, next.entrants.length - 18)} more</span>}
          </div>
        </div>
      )}
    </div>
  );
}

/** Rally points: this week (its top racers keep a Cup seat) or all time, fifteen a page, my row pinned. */
function BoardCard({ data, tab, setTab, page, setPage }: {
  data: RallyStatus; tab: 'week' | 'all'; setTab: (t: 'week' | 'all') => void; page: number; setPage: (p: number) => void;
}) {
  const week = data.week;
  const view = tab === 'week' && week ? week.board : data.board;
  const seats = tab === 'week' ? week?.cupSeats ?? 0 : 0;
  const pages = Math.max(1, Math.ceil(view.length / BOARD_PER_PAGE));
  const at = Math.min(page, pages);
  const rows = view.slice((at - 1) * BOARD_PER_PAGE, at * BOARD_PER_PAGE);
  const mine = view.find(r => r.me);
  const row = (r: RallyBoardEntry, pinned = false) => (
    <div key={`${pinned ? 'pin-' : ''}${r.rank}`} className={`rally-board-row ${r.me ? 'me' : ''} ${r.rank <= 3 ? `top${r.rank}` : ''} ${pinned ? 'pinned' : ''}`}>
      <span>{r.rank}</span>
      <span className="name">{r.name}{seats > 0 && r.rank <= seats && <i className="rally-seat" title="Keeps a seat in Monday's Pangs Cup">Cup seat</i>}</span>
      <span>{r.rallies}</span><span>{r.wins}</span><b>{r.points}</b>
    </div>
  );

  return (
    <div className="cup-card">
      <div className="rally-card-head">
        <h3>Rally leaderboard</h3>
        {week && (
          <div className="rally-tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'week'} className={tab === 'week' ? 'on' : ''} onClick={() => setTab('week')}>This week</button>
            <button role="tab" aria-selected={tab === 'all'} className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>All time</button>
          </div>
        )}
      </div>
      {seats > 0 && <p className="rally-seat-note">The top {seats} this week keep a seat in Monday's <b>Pangs Cup</b>. The rally week runs Tuesday to Monday (UTC), so Monday's rally still counts.</p>}
      {view.length === 0 ? (
        <p className="rally-empty">{tab === 'week' ? 'No rally points this week yet. The next rally fills this table.' : 'No rally points yet. The first rally fills this table.'}</p>
      ) : (
        <div className="rally-board">
          <div className="rally-board-row head"><span>#</span><span>Racer</span><span>Rallies</span><span>Wins</span><span>Pts</span></div>
          {rows.map(r => row(r))}
          {mine && !rows.includes(mine) && row(mine, true)}
        </div>
      )}
      <Pager page={at} pages={pages} onPage={setPage} label="Leaderboard pages" />
    </div>
  );
}
