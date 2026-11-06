import { useEffect, useState } from 'react';
import { ApiError, testSeason, type MyPick, type PredictionBoard as Board, type PredictionPlayer } from '../testSeason/api';
import { FIELD_SIZE, PREDICTION_PODIUM_POINTS, PREDICTION_WINNER_POINTS } from '../race/testSeason';
import './predictions.css';

export const ordinal = (n: number) => `${n}${['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] ?? 'th'}`;
const hitRate = (p: Pick<PredictionPlayer, 'picks' | 'winners' | 'podiums'>) => (p.picks ? Math.round(((p.winners + p.podiums) / p.picks) * 100) : 0);
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

/** Season / Predictions switch at the top of both boards. */
export function BoardTabs({ active, onChange }: { active: 'season' | 'predictions'; onChange: (tab: 'season' | 'predictions') => void }) {
  return (
    <div className="pd-tabs" role="tablist" aria-label="Leaderboards">
      <button type="button" role="tab" aria-selected={active === 'season'} className={active === 'season' ? 'on' : ''} onClick={() => onChange('season')}>Season</button>
      <button type="button" role="tab" aria-selected={active === 'predictions'} className={active === 'predictions' ? 'on' : ''} onClick={() => onChange('predictions')}>Predictions</button>
    </div>
  );
}

/** Pick the saddle number that wins this room. A pick is final, so it takes two taps: choose, then lock. */
export function PickPanel({ raceId, myPick, crowd, onPicked }: { raceId: string; myPick: number | null; crowd: number[]; onPicked: (pick: number, crowd: number[]) => void }) {
  const [chosen, setChosen] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const total = crowd.reduce((a, b) => a + b, 0);

  const lock = async () => {
    if (!chosen) return;
    setSaving(true);
    setError(null);
    try {
      const res = await testSeason.predict(raceId, chosen);
      onPicked(res.pick ?? chosen, res.crowd);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save your pick. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`pk ${myPick ? 'locked' : ''}`}>
      <div className="pk-head">
        <strong>{myPick ? `Your pick: Number ${myPick}` : 'Who wins this race?'}</strong>
        <span>Winner +{PREDICTION_WINNER_POINTS} · 2nd or 3rd +{PREDICTION_PODIUM_POINTS}</span>
      </div>
      <div className="pk-grid">
        {Array.from({ length: FIELD_SIZE }, (_, i) => {
          const n = i + 1;
          const share = total ? Math.round((crowd[i] / total) * 100) : 0;
          return (
            <button
              key={n}
              type="button"
              className={`pk-num ${(myPick ?? chosen) === n ? 'on' : ''}`}
              disabled={!!myPick || saving}
              aria-pressed={(myPick ?? chosen) === n}
              aria-label={`Number ${n}`}
              onClick={() => setChosen(n)}
            >
              <b>{n}</b>
              {myPick ? <small>{share}%</small> : null}
              {myPick ? <i style={{ height: `${share}%` }} aria-hidden="true" /> : null}
            </button>
          );
        })}
      </div>
      {error && <div className="pk-error" role="alert">{error}</div>}
      {myPick ? (
        <p className="pk-note">Locked in. The bars show what {total === 1 ? 'you picked' : `all ${total} callers picked`}. Your result lands in the Prediction League after the race.</p>
      ) : (
        <div className="pk-foot">
          <p className="pk-note">Free, and uses none of your races. You cannot change a pick once it is locked.</p>
          <button type="button" className="pk-lock" disabled={!chosen || saving} onClick={lock}>
            {saving ? 'Locking…' : chosen ? `Lock Number ${chosen}` : 'Choose a number'}
          </button>
        </div>
      )}
    </div>
  );
}

function PickRow({ row, onWatch }: { row: MyPick; onWatch: (raceId: string) => void }) {
  const outcome = row.status === 'open' ? { text: 'Waiting', tone: '' }
    : row.status === 'live' ? { text: 'Racing now', tone: 'live' }
    : row.position === 1 ? { text: `Winner +${row.points}`, tone: 'win' }
    : row.points > 0 ? { text: `${ordinal(row.position ?? 0)} +${row.points}`, tone: 'near' }
    : { text: row.position ? `${ordinal(row.position)}` : 'No result', tone: 'miss' };
  return (
    <li className="pd-pick">
      <span className={`pd-ball ${outcome.tone}`}>{row.pick}</span>
      <div className="pd-pick-text">
        <strong className={outcome.tone}>{outcome.text}</strong>
        <span>{row.terrain} · {when(row.startsAt)}</span>
      </div>
      {row.status !== 'open' && <button type="button" onClick={() => onWatch(row.raceId)}>{row.status === 'live' ? 'Watch' : 'Replay'}</button>}
    </li>
  );
}

const PLACES = [2, 1, 3];

/** The Prediction League: rules, the caller's own card, top three, the table and the latest results. */
export function PredictionBoard({ playerWallet, onTab, onMakePick, onSignIn, onWatch }: {
  playerWallet: string | null;
  onTab: (tab: 'season' | 'predictions') => void;
  onMakePick: () => void;
  onSignIn: () => void;
  onWatch: (raceId: string) => void;
}) {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const load = () => testSeason.predictionBoard()
      .then(b => { if (live) { setBoard(b); setError(null); } })
      .catch(e => { if (live) setError(e.message); });
    load();
    const id = setInterval(load, 30_000);
    return () => { live = false; clearInterval(id); };
  }, [playerWallet]);

  const players = board?.players ?? [];
  const podium = players.length >= 3 ? PLACES.map(rank => players[rank - 1]) : [];
  const rest = podium.length ? players.slice(3) : players;
  const me = board?.mine?.summary ?? null;
  const topWins = Math.max(1, ...(board?.numberWins ?? [1]));

  return (
    <section className="pd animated-enter">
      <BoardTabs active="predictions" onChange={onTab} />

      <header className="pd-hero">
        <div>
          <p className="pd-eyebrow">Free to play</p>
          <h2>Prediction League</h2>
          <p className="pd-lead">Call the winner of any online room before it starts. It costs nothing and uses none of your daily races.</p>
          <button type="button" className="pd-cta" onClick={onMakePick}>Make a pick</button>
        </div>
        <ul className="pd-score" aria-label="Scoring">
          <li className="gold"><b>+{PREDICTION_WINNER_POINTS}</b><span>Your number wins</span></li>
          <li><b>+{PREDICTION_PODIUM_POINTS}</b><span>It finishes 2nd or 3rd</span></li>
          <li className="dim"><b>0</b><span>Anywhere else</span></li>
        </ul>
      </header>

      {playerWallet ? (
        <dl className="pd-me">
          <div><dt>Your rank</dt><dd>{me ? `#${me.rank}` : '–'}</dd></div>
          <div><dt>Points</dt><dd className="gold">{me?.points ?? 0}</dd></div>
          <div><dt>Winners called</dt><dd>{me?.winners ?? 0}</dd></div>
          <div><dt>Hit rate</dt><dd>{me ? `${hitRate(me)}%` : '–'}</dd></div>
          <div><dt>Picks scored</dt><dd>{me?.picks ?? 0}</dd></div>
        </dl>
      ) : (
        <div className="pd-join"><span>Connect your wallet to make picks and join the table.</span><button type="button" onClick={onSignIn}>Connect Wallet</button></div>
      )}

      <div className="pd-grid">
        <div className="pd-main">
          {podium.length > 0 && (
            <ol className="pd-podium">
              {podium.map(p => (
                <li key={p.wallet} className={`p${p.rank} ${p.wallet === playerWallet ? 'me' : ''}`}>
                  <span className="pd-medal">{p.rank}</span>
                  <strong title={p.name}>{p.name}</strong>
                  <em>{p.points} pts</em>
                  <small>{p.winners} {p.winners === 1 ? 'winner' : 'winners'} · {hitRate(p)}% hit rate</small>
                </li>
              ))}
            </ol>
          )}

          <div className="pd-table">
            <div className="pd-row head"><span>Rank</span><span>Caller</span><span>Points</span><span>Winners</span><span className="wide">Hit rate</span><span className="wide">Picks</span></div>
            {error ? <div className="pd-empty">{error}</div>
              : !board ? <div className="pd-empty">Loading…</div>
              : players.length === 0 ? <div className="pd-empty"><strong>No picks scored yet</strong>The first winner called takes the top spot.</div>
              : rest.length === 0 ? <div className="pd-empty">The whole table is on the podium so far.</div>
              : rest.map(p => (
                <div key={p.wallet} className={`pd-row ${p.wallet === playerWallet ? 'me' : ''}`}>
                  <span className="pd-rank">#{p.rank}</span>
                  <span className="pd-name">{p.name}{p.wallet === playerWallet ? ' (You)' : ''}</span>
                  <span className="pd-pts">{p.points}</span>
                  <span>{p.winners}</span>
                  <span className="wide">{hitRate(p)}%</span>
                  <span className="wide">{p.picks}</span>
                </div>
              ))}
          </div>
          <p className="pd-fine">Prediction points are for fun. They are separate from season points and have no value.</p>
        </div>

        <aside className="pd-side">
          {board?.mine && (
            <div className="pd-card">
              <h3>Your picks</h3>
              {board.mine.picks.length === 0
                ? <p className="pd-muted">No picks yet. Rooms start every 30 minutes.</p>
                : <ul className="pd-picks">{board.mine.picks.slice(0, 6).map(r => <PickRow key={r.raceId} row={r} onWatch={onWatch} />)}</ul>}
            </div>
          )}

          <div className="pd-card">
            <h3>Latest winners</h3>
            {!board?.recent.length ? <p className="pd-muted">Winners appear here after the next room.</p> : (
              <ul className="pd-recent">
                {board.recent.map(r => (
                  <li key={r.raceId}>
                    <button type="button" onClick={() => onWatch(r.raceId)} title={`Replay: ${r.name}, ${when(r.finishedAt)}`}>
                      <span className="pd-ball win">{r.number}</span>
                      <span className="pd-recent-name">{r.name}</span>
                      <span className="pd-recent-time">{when(r.finishedAt)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="pd-card">
            <h3>Number form <small>last {board?.roomsCounted ?? 0} rooms</small></h3>
            <div className="pd-form" role="img" aria-label="Wins by saddle number in recent rooms">
              {(board?.numberWins ?? Array(FIELD_SIZE).fill(0)).map((w, i) => (
                <div key={i}>
                  <span className="pd-form-count">{w}</span>
                  <div className="pd-form-track"><i style={{ height: `${(w / topWins) * 100}%` }} /></div>
                  <span className="pd-form-n">{i + 1}</span>
                </div>
              ))}
            </div>
            <p className="pd-muted">Every number has the same chance in every race.</p>
          </div>
        </aside>
      </div>
    </section>
  );
}
