import { useEffect, useState } from 'react';
import { metamaskDeepLink, PREDICTIONS_ON, testSeason, type HistoryRow, type LeaderboardPlayer } from '../testSeason/api';
import { DAILY_RACE_LIMIT, POINTS_BY_POSITION } from '../race/testSeason';
import { LeaderboardBadges } from './Badges';
import { BoardTabs } from './Predictions';
import type { WalletOption } from '../testSeason/wallets';
import { pollWhileVisible } from '../testSeason/poll';
import { LeaderBoard, PODIUM, boardPages, pageRanks, type BoardRow } from './LeaderBoard';

/** Shown instead of a race page until the player has signed in with their wallet. */
export function SignInGate({ signingIn, onSignIn }: { signingIn: boolean; onSignIn: () => void }) {
  return (
    <section className="inventory-page animated-enter season-page">
      <div className="season-empty big">
        <img src="/beta/beta-pass.webp" alt="" style={{ width: 96, height: 96, borderRadius: 18, marginBottom: '1rem' }} />
        <h3>Join the Beta Season</h3>
        <p style={{ maxWidth: 460, margin: '0.75rem auto 0', lineHeight: 1.6 }}>
          Connect your wallet (MetaMask, Rabby, OKX, …) and sign a free message. New players enter an invite code once, then claim the free Beta pass
          (gas only). You get {DAILY_RACE_LIMIT} races a day and season points for every finish.
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

/** Several wallet extensions are installed: the player picks the one to race with. */
export function WalletPickerModal({ wallets, onPick, onCancel }: { wallets: WalletOption[]; onPick: (w: WalletOption) => void; onCancel: () => void }) {
  return (
    <div className="season-modal-backdrop" onClick={onCancel}>
      <div className="season-modal glass-panel wallet-picker" onClick={e => e.stopPropagation()} role="dialog" aria-label="Choose a wallet">
        <h3>Connect a wallet</h3>
        <p>Pick the wallet you want to race with.</p>
        <ul className="wallet-picker-list">
          {wallets.map(w => (
            <li key={w.rdns}>
              <button className="wallet-picker-item" onClick={() => onPick(w)}>
                {w.icon ? <img src={w.icon} alt="" /> : <span className="wallet-picker-blank" aria-hidden="true" />}
                <span>{w.name}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="season-modal-actions">
          <button className="btn btn-outline" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

/** Asked once, for a wallet that has not joined the Beta season yet. */
export function InviteCodeModal({ error, onSubmit, onCancel }: { error: string; onSubmit: (code: string) => void; onCancel: () => void }) {
  const [code, setCode] = useState('');
  return (
    <div className="season-modal-backdrop" onClick={onCancel}>
      <form className="season-modal glass-panel" onClick={e => e.stopPropagation()} onSubmit={e => { e.preventDefault(); if (code.trim()) onSubmit(code.trim()); }}>
        <div style={{ fontSize: '2.5rem' }}>🎟️</div>
        <h3>Enter your invite code</h3>
        <p>The Beta season is invite-only for now. Type the code you were given to claim your place. You only need it once.</p>
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
          <button type="submit" className="btn btn-primary" disabled={!code.trim()}>Join the Beta Season</button>
          <button type="button" className="btn btn-outline" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </div>
  );
}

/** Mint step after the invite: the free Beta pass (gas only) unlocks racing. */
export function BetaMintModal({ onMint, onClose }: { onMint: (onStep: (s: 'voucher' | 'chain' | 'confirm' | 'pending') => void) => Promise<boolean>; onClose: () => void }) {
  const [step, setStep] = useState<'idle' | 'voucher' | 'chain' | 'confirm' | 'pending' | 'done'>('idle');
  const busy = step !== 'idle' && step !== 'done';
  const label = { idle: 'Mint my Beta pass', voucher: 'Preparing…', chain: 'Switch to Robinhood Chain…', confirm: 'Confirm in your wallet…', pending: 'Minting…', done: 'Minted!' }[step];
  return (
    <div className="season-modal-backdrop" onClick={busy ? undefined : onClose}>
      <div className="season-modal glass-panel beta-modal" onClick={e => e.stopPropagation()}>
        <img className="beta-modal-art" src="/beta/beta-pass.webp" alt="Pangs Rally Beta pass" />
        <h3>Claim your Beta pass</h3>
        <p>Every Beta season racer holds the <strong>Pangs Rally Beta</strong> NFT. It is free: you only pay the network gas on Robinhood Chain. One per wallet.</p>
        <p className="beta-modal-hint">Make sure your wallet has a little ETH on Robinhood Chain for gas. MetaMask will offer to add the network.</p>
        <div className="season-modal-actions">
          <button className="btn btn-primary" disabled={busy || step === 'done'} onClick={async () => {
            const okMint = await onMint(s => setStep(s));
            setStep(okMint ? 'done' : 'idle');
          }}>{label}</button>
          {!busy && <button className="btn btn-outline" onClick={onClose}>Later</button>}
        </div>
      </div>
    </div>
  );
}

const medal = (pos: number | null) => pos === 1 ? '🥇' : pos === 2 ? '🥈' : pos === 3 ? '🥉' : pos ? `#${pos}` : '⏳';
const raceNote = (r: HistoryRow) => r.status === 'finished' ? `+${r.points} pts` : r.status === 'live' ? 'Racing now' : 'Waiting';

/** Season leaderboard (points from every finish): podium, ten a page, my place pinned. */
export function SeasonLeaderboard({ me, onTab }: {
  /** the signed-in racer's own line (from `me`), pinned under the table */
  me: { wallet: string; name: string; rank: number | null; points: number; races: number; wins: number } | null;
  onTab: (tab: 'season' | 'predictions') => void;
}) {
  // The server sends 25 racers a page (cached for everyone); the table shows 10, so it keeps the pages it has.
  const [pagesSeen, setPagesSeen] = useState<Record<number, LeaderboardPlayer[]>>({});
  const [total, setTotal] = useState<number | null>(null);
  const [serverSize, setServerSize] = useState(25);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const [from, to] = pageRanks(page);
  const need = [...new Set([1, Math.ceil(from / serverSize), Math.ceil(Math.min(to, total ?? to) / serverSize)])].filter(p => p >= 1);
  const needKey = need.join(',');

  useEffect(() => {
    let live = true;
    const load = () => Promise.all(needKey.split(',').map(Number).map(p => testSeason.leaderboard(p).then(r => [p, r.data] as const)))
      .then(got => {
        if (!live) return;
        setPagesSeen(c => {
          const next = { ...c };
          for (const [p, d] of got) next[p] = d.players;
          return next;
        });
        const d = got[0][1];
        setTotal(d.total ?? d.players.length);
        setServerSize(d.pageSize ?? 25);
        setError(null);
      })
      .catch(e => { if (live) setError(e instanceof Error ? e.message : 'Could not load the leaderboard.'); });
    load();
    const stop = pollWhileVisible(load, 60_000);
    return () => { live = false; stop(); };
  }, [needKey]);

  const all = Object.values(pagesSeen).flat();
  const toRow = (p: LeaderboardPlayer): BoardRow => ({
    rank: p.rank, key: p.wallet, name: p.name, points: p.points, stats: [p.races, p.wins], me: p.wallet === me?.wallet,
    extra: <LeaderboardBadges racerNumber={p.racerNumber} streakDays={p.badge} />,
  });
  const go = (p: number) => { setPage(p); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const mineRow: BoardRow | null = me?.rank ? { rank: me.rank, key: me.wallet, name: me.name, points: me.points, stats: [me.races, me.wins], me: true } : null;

  return (
    <section className="inventory-page animated-enter season-page">
      {PREDICTIONS_ON && <BoardTabs active="season" onChange={onTab} />}
      <div className="inventory-header-bar">
        <h2>Beta Season Leaderboard</h2>
        <div className="inventory-stats">
          <span>Racers: <strong style={{ color: 'var(--primary)' }}>{total?.toLocaleString('en-US') ?? '…'}</strong></span>
        </div>
      </div>

      <p className="season-rules">
        Points for every finish: {POINTS_BY_POSITION.map((p, i) => `${i + 1}${['st', 'nd', 'rd'][i] ?? 'th'} ${p}`).join(' · ')}.
        Ties go to more wins, then to whoever got there first.
      </p>

      <div className="glass-panel season-board">
        {error && total === null ? (
          <div className="season-empty">{error}</div>
        ) : (
          <LeaderBoard
            columns={['Races', 'Wins']}
            podium={all.filter(p => p.rank <= PODIUM).sort((x, y) => x.rank - y.rank).map(toRow)}
            rows={all.filter(p => p.rank >= from && p.rank <= to).sort((x, y) => x.rank - y.rank).map(toRow)}
            total={total ?? 0}
            loading={total === null}
            page={Math.min(page, boardPages(total ?? 0))}
            onPage={go}
            mine={mineRow}
            empty="No races yet. Be the first on the board!"
          />
        )}
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
        <RaceHistoryList rows={rows} onReplay={onReplay} onOpenRoom={onOpenRoom} />
      )}
    </section>
  );
}

/** Race rows with Replay / Open Room buttons (My Races and the Profile page). */
export function RaceHistoryList({ rows, onReplay, onOpenRoom }: { rows: HistoryRow[]; onReplay: (raceId: string) => void; onOpenRoom: (raceId: string) => void }) {
  return (
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
        <div className="season-race-pts">{raceNote(r)}</div>
        {r.status !== 'open' ? (
          <button className="btn btn-outline season-race-btn" onClick={() => onReplay(r.raceId)}>{r.status === 'live' ? '▶ Watch' : '▶ Replay'}</button>
        ) : (
          <button className="btn btn-primary season-race-btn" onClick={() => onOpenRoom(r.raceId)}>Open Room</button>
        )}
      </div>
    ))}
    </div>
  );
}
