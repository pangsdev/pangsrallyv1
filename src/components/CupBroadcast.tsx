import { useEffect, useRef, useState } from 'react';
import RaceRoom from './RaceRoom';
import { testSeason } from '../testSeason/api';
import { speakCall, unlockAnnounce } from '../race/announce';
import { LINES } from '../race/announceClips';
import RicoHost from './RicoHost';
import { clockText, nextUp, useCup, FINAL_SIZE } from './cupShared';
import './cup.css';

/**
 * Broadcast screen for the live stream: /cup/live, made for a 1920×1080 OBS browser source.
 * Between races it shows the standings and the countdown; when a round starts it plays that
 * round's race (the Grand Final, or the room picked with ?room=2) with the English race caller.
 * Nothing to operate during the show: it follows the Cup schedule on its own.
 */
export default function CupBroadcast() {
  const { data, now } = useCup();
  const [scale, setScale] = useState(1);
  const [showing, setShowing] = useState<{ raceId: string; label: string } | null>(null);
  const shown = useRef(new Set<string>());
  const [soundOn, setSoundOn] = useState(false);
  const roomPick = Math.max(1, Number(new URLSearchParams(window.location.search).get('room')) || 1);

  useEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / 1920, window.innerHeight / 1080));
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  // Every room of a round goes on air, one after another (A, B, C, …): the results are fixed when the
  // round starts, so the later rooms replay a few minutes behind. ?room=N shows only that room.
  // Only the latest round that started in the last 14 minutes plays, so a reload never digs up old rounds.
  const roomParam = Number(new URLSearchParams(window.location.search).get('room')) || null;
  const [lastRoom, setLastRoom] = useState(true);
  useEffect(() => {
    if (!data || showing) return;
    const round = [...data.rounds].reverse().find(r => r.state !== 'upcoming');
    if (!round || Date.now() - Date.parse(round.at) > 14 * 60_000) return;
    const rooms = roomParam ? round.rooms.filter(r => r.room === roomPick) : [...round.rooms].sort((a, b) => a.room - b.room);
    const room = rooms.find(r => !shown.current.has(r.raceId));
    if (!room) return;
    shown.current.add(room.raceId);
    setLastRoom(rooms.every(r => shown.current.has(r.raceId)));
    const count = round.rooms.length;
    setShowing({
      raceId: room.raceId,
      label: round.final ? 'Grand Final' : `Round ${round.round} · Room ${String.fromCharCode(64 + room.room)}${count > 1 ? ` of ${count}` : ''}`,
    });
  }, [data, showing, roomPick, roomParam]);

  // A short look at the result between rooms; a longer one after the last room of the round.
  const onFinished = () => setTimeout(() => setShowing(null), lastRoom ? 14_000 : 7_000);

  return (
    <div className="cupbc" onClick={() => { unlockAnnounce(); setSoundOn(true); }}>
      <div className="cupbc-stage" style={{ transform: `scale(${scale})`, left: (window.innerWidth - 1920 * scale) / 2, top: (window.innerHeight - 1080 * scale) / 2 }}>
        {showing ? (
          <div className="cupbc-race">
            <RaceRoom
              key={showing.raceId}
              categoryInfo={{ terrain: data?.cup.terrain ?? 'Forest' }}
              title="Pangs Cup"
              playerWallet={null}
              loadRace={() => testSeason.race(showing.raceId)}
              onBack={() => setShowing(null)}
              onFinished={onFinished}
            />
            <div className="cupbc-bug"><img src="/dark-logo.webp" alt="" /><div><b>Pangs Cup #{data?.cup.id}</b><span>{showing.label}</span></div></div>
          </div>
        ) : (
          <Board now={now} data={data} />
        )}
        {!soundOn && <div className="cupbc-hint">Click once to turn the race caller on (not needed in OBS)</div>}
      </div>
    </div>
  );
}

function Board({ data, now }: { data: ReturnType<typeof useCup>['data']; now: number }) {
  if (!data) return <div className="cupbc-board" />;
  const { cup } = data;
  const next = nextUp(data, now);
  const qualifyingDone = data.rounds.filter(r => !r.final).every(r => r.state === 'done');
  const prizes = (
    <p>
      {cup.prizes.filter(p => p.tier < 4).map(p => <span key={p.tier}>{p.tier === 1 ? 'Winner' : p.tier === 2 ? '2nd' : '3rd'}: <em>{p.label}</em><br /></span>)}
    </p>
  );

  const doneRounds = data.rounds.filter(r => !r.final && r.state === 'done').length;
  // Every board line is a baked clip (announceClips.ts), so Rico says it out loud too.
  const ricoLine = cup.state === 'postponed' ? LINES.cupPostponed()
    : cup.state === 'finished' ? LINES.cupOver()
    : qualifyingDone ? LINES.cupFinalTen()
    : cup.state === 'live' && doneRounds > 0 ? LINES.cupAfterRound()
    : LINES.cupWelcome();
  let eyebrow = `Pangs Cup #${cup.id}`;
  let title = <>Starting <em>soon</em></>;
  let rows: { n: string; v: string; out?: boolean }[] = [];
  if (cup.state === 'postponed') {
    title = <>Postponed: <em>new date soon</em></>;
    rows = data.entrants.slice(-FINAL_SIZE).reverse().map(n => ({ n, v: 'Keeps a seat' }));
  } else if (cup.state === 'finished' && data.result) {
    title = <><em>{data.result[0].name}</em> takes the Cup</>;
    rows = data.result.map(r => ({ n: r.name, v: r.tier < 4 ? ['', 'Champion', '2nd', '3rd'][r.tier] : 'Finalist' }));
  } else if (qualifyingDone) {
    title = <>The Grand Final <em>ten</em></>;
    rows = data.standings.slice(0, FINAL_SIZE).map(s => ({ n: s.name, v: `${s.total} pts` }));
  } else if (cup.state === 'live') {
    eyebrow = `Pangs Cup #${cup.id} · Qualifying`;
    title = <>The race for the <em>top ten</em></>;
    rows = data.standings.slice(0, FINAL_SIZE).map(s => ({ n: s.name, v: `${s.total} pts` }));
  } else {
    eyebrow = `Pangs Cup #${cup.id} · ${cup.registered} racers in`;
    rows = data.entrants.slice(-FINAL_SIZE).reverse().map(n => ({ n, v: 'Ready' }));
  }
  const ranked = cup.state === 'live' || cup.state === 'finished';

  return (
    <div className="cupbc-board">
      <div className="cupbc-top"><img src="/dark-logo.webp" alt="" /><span className="cupbc-onair"><i />LIVE</span></div>
      <div className="cupbc-title"><span>{eyebrow}</span><h1>{title}</h1></div>
      <div className="cupbc-grid">
        <div className="cupbc-list">
          {rows.map((r, i) => <div key={r.n + i}><b>{ranked ? i + 1 : '•'}</b><strong>{r.n}</strong><span>{r.v}</span></div>)}
        </div>
        <div className="cupbc-right">
          <BoardHost line={ricoLine} />
          <div className="cupbc-cd">
            {next ? <><span>{next.label}</span><b>{clockText(next.at - now)}</b></>
              : cup.state === 'postponed' ? <><span>{cup.registered} of {cup.minRacers} racers needed</span><b style={{ fontSize: 96 }}>Soon</b></>
              : <><span>Thanks for watching</span><b style={{ fontSize: 96 }}>GG</b></>}
            {prizes}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Rico on the board: says each new line once (a line repeats only after the board has shown another). */
function BoardHost({ line }: { line: string }) {
  const said = useRef<string | null>(null);
  useEffect(() => {
    if (said.current === line) return;
    said.current = line;
    // A short pause, so a line never runs straight on from the race caller's last call.
    const t = setTimeout(() => speakCall(line, 5), 1500);
    return () => clearTimeout(t);
  }, [line]);
  return <RicoHost line={line} />;
}
