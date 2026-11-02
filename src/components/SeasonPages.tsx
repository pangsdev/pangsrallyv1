import { useEffect, useState } from 'react';
import { metamaskDeepLink, testSeason, type HistoryRow, type LeaderboardPlayer } from '../testSeason/api';
import { DAILY_RACE_LIMIT, POINTS_BY_POSITION } from '../race/testSeason';

/** Shown instead of a race page until the player has signed in with their wallet. */
export function SignInGate({ signingIn, onSignIn }: { signingIn: boolean; onSignIn: () => void }) {
  return (
    <section className="inventory-page animated-enter season-page">
      <div className="season-empty big">
        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🏁</div>
        <h3>Join the Test Season</h3>
        <p style={{ maxWidth: 440, margin: '0.75rem auto 0', lineHeight: 1.6 }}>
          Connect MetaMask and sign a free message (no gas, no transaction). You get {DAILY_RACE_LIMIT} races a day and season points for every finish.
        </p>
        <button className="btn btn-primary" style={{ marginTop: '1.5rem' }} disabled={signingIn} onClick={onSignIn}>
          {signingIn ? 'Check your wallet…' : 'Connect Wallet'}
        </button>
      </div>
    </section>
  );
}

/** No injected wallet: point desktop users to MetaMask and phone users into the MetaMask app browser. */
export function NoWalletModal({ onClose }: { onClose: () => void }) {
  const mobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  return (
    <div className="season-modal-backdrop" onClick={onClose}>
      <div className="season-modal glass-panel" onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: '2.5rem' }}>🦊</div>
        <h3>MetaMask needed</h3>
        <p>
          {mobile
            ? 'On a phone, open this site inside the MetaMask app to connect your wallet.'
            : 'Install the MetaMask browser extension, then reload this page and connect.'}
        </p>
        <div className="season-modal-actions">
          {mobile ? (
            <a className="btn btn-primary" href={metamaskDeepLink()}>Open in MetaMask</a>
          ) : (
            <a className="btn btn-primary" href="https://metamask.io/download/" target="_blank" rel="noopener noreferrer">Get MetaMask</a>
          )}
          <button className="btn btn-outline" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

/** Asked once, for a wallet that has not joined the test season yet. */
export function InviteCodeModal({ error, onSubmit, onCancel }: { error: string; onSubmit: (code: string) => void; onCancel: () => void }) {
  const [code, setCode] = useState('');
  return (
    <div className="season-modal-backdrop" onClick={onCancel}>
      <form className="season-modal glass-panel" onClick={e => e.stopPropagation()} onSubmit={e => { e.preventDefault(); if (code.trim()) onSubmit(code.trim()); }}>
        <div style={{ fontSize: '2.5rem' }}>🎟️</div>
        <h3>Enter your invite code</h3>
        <p>The test season is invite-only for now. Type the code you were given to claim your place. You only need it once.</p>
        <input
          className="season-invite-input"
          value={code}
          onChange={e => setCode(e.target.value.toUpperCase())}
          placeholder="RALLY-XXXX"
          autoFocus
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          maxLength={32}
          aria-label="Invite code"
        />
        {error && <div className="season-invite-error">{error}</div>}
        <div className="season-modal-actions">
          <button type="submit" className="btn btn-primary" disabled={!code.trim()}>Join the Test Season</button>
          <button type="button" className="btn btn-outline" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </div>
  );
}

const medal = (pos: number | null) => pos === 1 ? '🥇' : pos === 2 ? '🥈' : pos === 3 ? '🥉' : pos ? `#${pos}` : '⏳';

/** Test-season leaderboard (points from every finish). */
export function SeasonLeaderboard({ playerWallet }: { playerWallet: string | null }) {
  const [players, setPlayers] = useState<LeaderboardPlayer[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const load = () => testSeason.leaderboard()
      .then(r => { if (live) { setPlayers(r.players); setError(null); } })
      .catch(e => { if (live) setError(e.message); });
    load();
    const id = setInterval(load, 30_000);
    return () => { live = false; clearInterval(id); };
  }, []);

  return (
    <section className="inventory-page animated-enter season-page">
      <div className="inventory-header-bar">
        <h2>Test Season Leaderboard</h2>
        <div className="inventory-stats">
          <span>Racers: <strong style={{ color: 'var(--primary)' }}>{players?.length ?? '…'}</strong></span>
        </div>
      </div>

      <p className="season-rules">
        Points for every finish: {POINTS_BY_POSITION.map((p, i) => `${i + 1}${['st', 'nd', 'rd'][i] ?? 'th'} ${p}`).join(' · ')}.
        Ties go to more wins, then to whoever got there first. Season rewards may follow once the test ends.
      </p>

      <div className="leaderboard-list glass-panel season-board">
        <div className="lb-list-header season-grid">
          <div>Rank</div>
          <div>Racer</div>
          <div>Points</div>
          <div>Races</div>
          <div>Wins</div>
        </div>
        {error ? (
          <div className="season-empty">{error}</div>
        ) : !players ? (
          <div className="season-empty">Loading…</div>
        ) : players.length === 0 ? (
          <div className="season-empty">No races yet. Be the first on the board!</div>
        ) : players.map(p => {
          const me = p.wallet === playerWallet;
          const podium = p.rank <= 3 ? ['#ffd700', '#c0c0c0', '#cd7f32'][p.rank - 1] : null;
          return (
            <div key={p.wallet} className={`lb-list-row season-grid ${me ? 'season-me' : ''}`} style={{ borderLeft: `4px solid ${podium ?? 'transparent'}` }}>
              <div style={{ fontWeight: 'bold', color: podium ?? 'var(--text-muted)' }}>#{p.rank}</div>
              <div className="season-name">{p.name}{me ? ' (You)' : ''}</div>
              <div style={{ color: 'var(--pangs-orange)', fontWeight: 'bold' }}>{p.points}</div>
              <div>{p.races}</div>
              <div style={{ color: 'var(--color-success)' }}>{p.wins}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** The player's test-season races, with replays. */
export function MyRaces({ signedIn, onSignIn, onReplay, onOpenRoom, onGoRace }: {
  signedIn: boolean;
  onSignIn: () => void;
  onReplay: (raceId: string) => void;
  onOpenRoom: (raceId: string) => void;
  onGoRace: () => void;
}) {
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    testSeason.history()
      .then(r => { if (live) setRows(r.races); })
      .catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [signedIn]);

  const total = rows?.reduce((n, r) => n + r.points, 0) ?? 0;

  return (
    <section className="inventory-page animated-enter season-page">
      <div className="inventory-header-bar">
        <h2>My Races</h2>
        {rows && (
          <div className="inventory-stats">
            <span>Races: <strong style={{ color: 'var(--primary)' }}>{rows.length}</strong></span>
            <span style={{ marginLeft: '1.25rem' }}>Points: <strong style={{ color: '#ffd700' }}>{total}</strong></span>
          </div>
        )}
      </div>

      {!signedIn ? (
        <div className="season-empty big">
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🔒</div>
          <h3>Connect your wallet to see your races</h3>
          <button className="btn btn-primary" style={{ marginTop: '1.25rem' }} onClick={onSignIn}>Connect Wallet</button>
        </div>
      ) : error ? (
        <div className="season-empty big">{error}</div>
      ) : !rows ? (
        <div className="season-empty big">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="season-empty big">
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🏁</div>
          <h3>No races yet</h3>
          <button className="btn btn-primary" style={{ marginTop: '1.25rem' }} onClick={onGoRace}>Go to The Rally</button>
        </div>
      ) : (
        <div className="season-history">
          {rows.map(r => (
            <div key={r.raceId} className="glass-panel season-race">
              <div className="season-race-pos">{medal(r.position)}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 'bold', color: 'var(--text-main)' }}>{r.terrain} Track</div>
                <div className="season-race-meta">
                  <span className={`season-kind ${r.kind}`}>{r.kind === 'online' ? 'Online' : 'Bot Race'}</span>
                  <span>{new Date(r.joinedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              </div>
              <div className="season-race-pts">{r.status === 'finished' ? `+${r.points} pts` : 'Waiting'}</div>
              {r.status === 'finished' ? (
                <button className="btn btn-outline season-race-btn" onClick={() => onReplay(r.raceId)}>▶ Replay</button>
              ) : (
                <button className="btn btn-primary season-race-btn" onClick={() => onOpenRoom(r.raceId)}>Open Room</button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
