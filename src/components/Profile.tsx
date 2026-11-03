import { useEffect, useState } from 'react';
import { testSeason, type HistoryRow, type ProfileStatus } from '../testSeason/api';
import { fetchBetaPasses, type BetaPassInfo } from '../testSeason/betaPass';
import { BETA_RACER_ART, POINTS_BY_POSITION, shortWallet } from '../race/testSeason';
import { RaceHistoryList } from './SeasonPages';
import { FlagIcon } from './Icons';
import './profile.css';

interface Props {
  signedIn: boolean;
  signingIn: boolean;
  onSignIn: () => void;
  onReplay: (raceId: string) => void;
  onOpenRoom: (raceId: string) => void;
  onGoRace: () => void;
  onMintBeta: () => void;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const ordinal = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;

/** The player's page: season stats, their Beta pass and every race with its replay. */
export default function Profile({ signedIn, signingIn, onSignIn, onReplay, onOpenRoom, onGoRace, onMintBeta }: Props) {
  const [profile, setProfile] = useState<ProfileStatus | null>(null);
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [beta, setBeta] = useState<BetaPassInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    Promise.all([testSeason.profile(), testSeason.history()])
      .then(([p, h]) => {
        if (!live) return;
        setProfile(p);
        setRows(h.races);
        if (p.beta.contract) fetchBetaPasses(p.beta.contract, p.wallet).then(b => live && setBeta(b)).catch(() => {});
      })
      .catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [signedIn]);

  if (!signedIn) {
    return (
      <section className="pf-page">
        <div className="pf-empty">
          <img src="/beta/beta-pass.webp" alt="" />
          <h2>Your racing profile</h2>
          <p>Connect your wallet to see your season stats, your Beta pass and every race you have run.</p>
          <button className="btn btn-primary" disabled={signingIn} onClick={onSignIn}>{signingIn ? 'Check your wallet…' : 'Connect Wallet'}</button>
        </div>
      </section>
    );
  }
  if (error) return <section className="pf-page"><div className="pf-empty"><p>{error}</p></div></section>;
  if (!profile || !rows) return <section className="pf-page"><div className="pf-empty"><div className="rr-spinner" /></div></section>;

  const st = profile.stats;
  const maxFinish = Math.max(1, ...st.finishes);
  const passId = beta?.minted ?? beta?.owned[0] ?? null;

  return (
    <section className="pf-page">
      <header className="pf-hero">
        <img className="pf-avatar" src={BETA_RACER_ART} alt="" />
        <div className="pf-id">
          <span className="pf-eyebrow">Beta season racer</span>
          <h2>{shortWallet(profile.wallet)}</h2>
          <div className="pf-badges">
            <span className="pf-badge gold">Rank {profile.rank ?? '—'}</span>
            <span className="pf-badge">{profile.points} pts</span>
            {st.firstRace && <span className="pf-badge muted">Racing since {new Date(st.firstRace).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}
          </div>
        </div>
        <button className="btn btn-primary pf-race" onClick={onGoRace}>Race <FlagIcon size={16} /></button>
      </header>

      <div className="pf-tiles">
        <div><strong>{st.races}</strong><span>races</span></div>
        <div><strong>{profile.wins}</strong><span>wins</span></div>
        <div><strong>{st.races ? pct(st.winRate) : '—'}</strong><span>win rate</span></div>
        <div><strong>{profile.podiums}</strong><span>podiums</span></div>
        <div><strong>{st.avgPosition ? st.avgPosition.toFixed(1) : '—'}</strong><span>avg finish</span></div>
        <div><strong>{st.best ? ordinal(st.best) : '—'}</strong><span>best finish</span></div>
      </div>

      <div className="pf-grid">
        <article className="pf-card">
          <h3>Finishes</h3>
          <p className="pf-sub">How often you crossed the line in each place.</p>
          <ol className="pf-bars">
            {st.finishes.map((n, i) => (
              <li key={i} className={i < 3 ? 'top' : ''} title={`${n} × ${ordinal(i + 1)} (${POINTS_BY_POSITION[i]} pts each)`}>
                <span className="pf-bar"><span style={{ height: `${(n / maxFinish) * 100}%` }} /></span>
                <em>{n}</em>
                <small>{i + 1}</small>
              </li>
            ))}
          </ol>
        </article>

        <article className="pf-card">
          <h3>By mode</h3>
          <p className="pf-sub">Points from bot races and online rooms.</p>
          {(['bot', 'online'] as const).map(k => (
            <div key={k} className={`pf-mode ${k}`}>
              <span>{k === 'bot' ? 'Bot races' : 'Online rooms'}</span>
              <strong>{st[k].points} pts</strong>
              <small>{st[k].races} races · {st[k].wins} wins</small>
            </div>
          ))}
          <div className="pf-today">{profile.unlimited ? 'Unlimited races (tester)' : `${profile.racesLeft} of ${profile.dailyLimit} races left today`}</div>
        </article>

        <article className="pf-card pf-pass">
          <h3>Beta pass</h3>
          <img src="/beta/beta-pass.webp" alt="Pangs Rally Beta pass" />
          {passId !== null ? (
            <>
              <strong>Pangs Rally Beta #{passId}</strong>
              <small>{beta?.minted !== null ? 'Minted by this wallet' : 'Held by this wallet'} · Robinhood Chain</small>
            </>
          ) : profile.beta.minted ? (
            <small>Your pass is on its way… refresh in a moment.</small>
          ) : profile.beta.required ? (
            <>
              <small>Not minted yet. It is free; you only pay gas.</small>
              <button className="btn btn-primary" onClick={onMintBeta}>Claim my Beta pass</button>
            </>
          ) : !profile.beta.contract ? <small>The Beta pass is not needed right now.</small> : <small>Reading Robinhood Chain…</small>}
        </article>
      </div>

      <h3 className="pf-section">Race history</h3>
      {rows.length === 0 ? (
        <div className="pf-empty small"><p>No races yet. Your first one is a click away.</p><button className="btn btn-primary" onClick={onGoRace}>Go to The Rally</button></div>
      ) : (
        <RaceHistoryList rows={rows} onReplay={onReplay} onOpenRoom={onOpenRoom} />
      )}
    </section>
  );
}

/** Inventory section: the Beta passes this wallet holds, read from Robinhood Chain. */
export function BetaInventory({ wallet, contract, onMintBeta }: { wallet: string; contract: string | null; onMintBeta: () => void }) {
  const [info, setInfo] = useState<BetaPassInfo | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!contract) return;
    let live = true;
    fetchBetaPasses(contract, wallet).then(i => live && setInfo(i)).catch(() => live && setFailed(true));
    return () => { live = false; };
  }, [wallet, contract]);
  if (!contract) return null;

  return (
    <div className="pf-inv">
      <div className="pf-inv-head">
        <h3>Beta pass</h3>
        <span>{info ? `${info.owned.length} held` : failed ? 'Could not reach Robinhood Chain' : 'Reading Robinhood Chain…'}</span>
      </div>
      <div className="pf-inv-row">
        {info?.owned.map(id => (
          <article key={id} className="pf-inv-card">
            <img src="/beta/beta-pass.webp" alt={`Pangs Rally Beta #${id}`} />
            <div>
              <strong>Pangs Rally Beta #{id}</strong>
              <small>{info.minted === id ? 'Minted by this wallet' : 'Received'}</small>
              <dl>
                <div><dt>Edition</dt><dd>Beta</dd></div>
                <div><dt>Season</dt><dd>Beta Season 2026</dd></div>
                <div><dt>Body</dt><dd>Beta</dd></div>
                <div><dt>Chain</dt><dd>Robinhood</dd></div>
              </dl>
            </div>
          </article>
        ))}
        {info && info.owned.length === 0 && (
          <article className="pf-inv-card empty">
            <img src="/beta/beta-pass.webp" alt="" />
            <div>
              <strong>No Beta pass yet</strong>
              <small>It is free to mint; you only pay gas. One per wallet.</small>
              {info.minted === null && <button className="btn btn-primary" onClick={onMintBeta}>Claim my Beta pass</button>}
            </div>
          </article>
        )}
      </div>
    </div>
  );
}
