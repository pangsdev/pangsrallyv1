import { useEffect, useState } from 'react';
import {
  claimCupParticipant, claimCupPrize, readCupAward, readCupParticipant, testSeason,
  type CupStatus, type CupStanding, type OnChainAward, type PlayerStatus,
} from '../testSeason/api';
import { FINAL_SIZE, TIER_LABEL, clockText, day, nextUp, ordinal, time, useCup, zoned } from './cupShared';
import './cup.css';

interface Props {
  player: PlayerStatus | null;
  onSignIn: () => void;
  /** open a Cup race on the track */
  onWatch: (raceId: string) => void;
}

export default function CupPage({ player, onSignIn, onWatch }: Props) {
  const { data, setData, error, now } = useCup();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  if (error === 'no_cup') {
    return (
      <section className="cup-root"><div className="cup-inner">
        <div className="cup-empty"><img src="/cup/badge-1.webp" alt="" /><h2>No Pangs Cup right now</h2><p>The next Cup is announced on our socials. Keep racing: the Beta Season leaderboard is live.</p></div>
      </div></section>
    );
  }
  if (!data) {
    return <section className="cup-root"><div className="cup-inner"><div className="cup-loading">{error ?? <span className="rr-spinner" />}</div></div></section>;
  }

  const { cup, me } = data;
  const signedIn = !!player;
  const regClosed = now >= Date.parse(cup.registerClosesAt);
  const next = nextUp(data, now);

  const act = async (fn: () => Promise<CupStatus>) => {
    setBusy(true);
    setNote(null);
    try { setData(await fn()); } catch (e) { setNote(e instanceof Error ? e.message : 'Something went wrong.'); } finally { setBusy(false); }
  };

  const cta = (() => {
    if (cup.state !== 'upcoming') return null;
    if (!signedIn) return <button className="cup-btn" onClick={onSignIn}>Connect wallet to enter</button>;
    if (me?.registered) {
      return (
        <>
          <span className="cup-in">✓ You're in</span>
          {!regClosed && <button className="cup-btn ghost" disabled={busy} onClick={() => act(() => testSeason.cupLeave(cup.id))}>Give back my seat</button>}
        </>
      );
    }
    if (me?.canRegister) return <button className="cup-btn" disabled={busy} onClick={() => act(() => testSeason.cupRegister(cup.id))}>{busy ? 'Taking your seat…' : 'Claim my seat'}</button>;
    return <button className="cup-btn" disabled>{me?.problem ?? 'Registration closed'}</button>;
  })();

  return (
    <section className="cup-root">
      <div className="cup-inner">
        {cup.state === 'finished' && data.result ? (
          <Podium data={data} onWatch={onWatch} player={player} />
        ) : (
          <div className="cup-hero">
            <div>
              <span className="cup-eyebrow">{cup.state === 'live' ? <><i className="cup-live-dot" />Live now</> : cup.state === 'postponed' ? 'Postponed · new date soon' : 'Beta Season special · Free entry'}</span>
              <h1>Pangs <em>Cup</em> #{cup.id}</h1>
              <p className="cup-sub">Up to {cup.seats} racers. {cup.qualifyingRounds} qualifying rounds. The top ten meet in one Grand Final, live.</p>
              <div className="cup-when">
                <div><b>{day(cup.startsAt)}</b><span>Date</span></div>
                <div><b>{zoned(cup.startsAt)}</b><span>First round</span></div>
                <div className="cup-seats"><b>{cup.registered} of {cup.seats}</b><span>Seats taken{cup.registered < cup.minRacers && cup.state !== 'finished' ? ` · ${cup.minRacers} needed to race` : ''}</span><div className="cup-bar"><i style={{ width: `${Math.min(100, (cup.registered / cup.seats) * 100)}%` }} /></div></div>
              </div>
              <div className="cup-ctas">
                {cta}
                {cup.state === 'upcoming' && <small>{regClosed ? 'Registration has closed.' : `Needs a Beta pass. No payment, ever. Registration closes at ${time(cup.registerClosesAt)}.`}</small>}
                {next && <div className="cup-clock"><span>{next.label}</span><b>{clockText(next.at - now)}</b></div>}
              </div>
              {cup.state === 'postponed' && (
                <p className="cup-note">Fewer than {cup.minRacers} racers registered in time, so this Cup did not start. Everyone registered keeps their seat; the new date will be announced here and on X.</p>
              )}
              {note && <p className="cup-note">{note}</p>}
            </div>
            <Prizes data={data} />
          </div>
        )}

        <div className="cup-path">
          {data.rounds.map(r => (
            <div key={r.round} className={`cup-step ${r.final ? 'fin' : ''} ${r.state}`}>
              <b>{r.final ? 'Grand Final' : `Round ${r.round}`}</b>
              <span>{r.state === 'live' ? 'Racing now' : r.state === 'done' ? 'Done' : `${time(r.at)}${r.final ? ` · top ${FINAL_SIZE} · points reset` : ''}`}</span>
            </div>
          ))}
        </div>

        {cup.state === 'upcoming' || cup.state === 'postponed' ? (
          <>
            <div className="cup-tri">
              <div className="cup-card"><h3>1. Claim your seat</h3><p>Free for Beta pass holders. Register once, and you are in every qualifying round. It uses none of your daily races, and everyone who races gets a Participant badge.</p></div>
              <div className="cup-card"><h3>2. Race {cup.qualifyingRounds} rounds</h3><p>Every round shuffles you into a new room of 10. Race points go on a live Cup table. If you close the page, your race still runs.</p></div>
              <div className="cup-card"><h3>3. Make the Grand Final</h3><p>The top 10 go through and everyone restarts on zero. One race decides the Cup: the final result sets the prizes.</p></div>
            </div>
            {data.entrants.length > 0 && (
              <div className="cup-card cup-entrants"><h3>Who's in <small>{data.entrants.length}</small></h3><div>{data.entrants.map(n => <span key={n}>{n}</span>)}</div></div>
            )}
          </>
        ) : (
          <Standings data={data} player={player} onWatch={onWatch} />
        )}

        <Rules data={data} />
      </div>
    </section>
  );
}

function Prizes({ data }: { data: CupStatus }) {
  return (
    <aside className="cup-prizes">
      <h3>Prizes</h3>
      {data.cup.prizes.map(p => (
        <div key={p.tier} className="cup-prize">
          <img src={`/cup/badge-${p.tier}.webp`} alt="" />
          <div><strong className={p.tier === 1 ? 'gold' : ''}>{p.label}</strong><span>{p.tier === 4 ? 'Every other finalist' : TIER_LABEL[p.tier]}</span></div>
        </div>
      ))}
      <div className="cup-prize">
        <img src="/cup/badge-5.webp" alt="" />
        <div><strong>Participant badge</strong><span>Everyone who races</span></div>
      </div>
      <p>Badges are soulbound NFTs on Robinhood Chain, claimed from your own wallet after the Cup.</p>
    </aside>
  );
}

function Standings({ data, player, onWatch }: { data: CupStatus; player: PlayerStatus | null; onWatch: (id: string) => void }) {
  const { cup } = data;
  const wallet = player?.wallet;
  const mineIndex = data.standings.findIndex(s => s.wallet === wallet);
  const mine: CupStanding | undefined = data.standings[mineIndex];
  const cutPoints = data.standings[FINAL_SIZE - 1]?.total ?? 0;
  const qualifyingDone = data.rounds.filter(r => !r.final).every(r => r.state === 'done');
  const started = data.rounds.filter(r => r.state !== 'upcoming');
  // Every round that has started stays watchable: tabs pick the round, the latest one by default.
  const [picked, setPicked] = useState<number | null>(null);
  const current = started.find(r => r.round === picked) ?? started[started.length - 1];
  const showCut = data.standings.length > FINAL_SIZE;

  return (
    <div className="cup-grid">
      <div className="cup-table">
        <div className="cup-row head" style={{ gridTemplateColumns: `44px minmax(0,1fr) repeat(${cup.qualifyingRounds}, 46px) 66px` }}>
          <span>#</span><span>Racer</span>
          {Array.from({ length: cup.qualifyingRounds }, (_, i) => <span key={i} className="c">R{i + 1}</span>)}
          <span className="r">Points</span>
        </div>
        {data.standings.map((s, i) => (
          <div key={s.wallet}>
            <div className={`cup-row ${s.wallet === wallet ? 'me' : ''}`} style={{ gridTemplateColumns: `44px minmax(0,1fr) repeat(${cup.qualifyingRounds}, 46px) 66px` }}>
              <span className={`cup-rank ${i < FINAL_SIZE ? 'q' : ''}`}>{s.rank}</span>
              <span className="cup-name">{s.name}{s.wallet === wallet && <i>You</i>}</span>
              {s.rounds.map((p, r) => <span key={r} className={`c ${p === 25 ? 'w' : ''}`}>{p ?? '–'}</span>)}
              <span className="cup-pts">{s.total}</span>
            </div>
            {showCut && i === FINAL_SIZE - 1 && <div className="cup-cut">{qualifyingDone ? 'Grand Final line' : 'Grand Final cut'}</div>}
          </div>
        ))}
      </div>

      <aside className="cup-side">
        {mine && (
          <div className="cup-card">
            <h3>Your Cup</h3>
            <div className="cup-mine">
              <div><b>{ordinal(mine.rank)}</b>Place</div>
              <div><b className="gold">{mine.total}</b>Points</div>
              {!qualifyingDone && <div><b>{mineIndex < FINAL_SIZE ? '✓' : Math.max(0, cutPoints - mine.total + 1)}</b>{mineIndex < FINAL_SIZE ? 'In the top 10' : 'Points to the cut'}</div>}
            </div>
            {data.me?.inFinal && <div className="cup-need">You race in the Grand Final.</div>}
            {qualifyingDone && !data.me?.inFinal && mineIndex >= FINAL_SIZE && <div className="cup-need dim">{cup.state === 'finished' ? 'Thanks for racing in the Cup.' : 'Thanks for racing. Watch the Grand Final live.'}</div>}
          </div>
        )}
        {current && (
          <div className="cup-card">
            <h3>{current.final ? 'Grand Final' : `Round ${current.round} rooms`}</h3>
            {started.length > 1 && (
              <div className="cup-roundtabs" role="tablist" aria-label="Pick a round">
                {started.map(r => (
                  <button key={r.round} role="tab" aria-selected={r === current} className={r === current ? 'on' : ''} onClick={() => setPicked(r.round)}>
                    {r.final ? 'Final' : `R${r.round}`}
                  </button>
                ))}
              </div>
            )}
            {current.rooms.map(room => (
              <div key={room.raceId} className="cup-room">
                <div><strong>{current.final ? 'Final room' : `Room ${String.fromCharCode(64 + room.room)}`}{room.mine && <span className="cup-tag">You</span>}</strong><span>{room.names.length} racers · {time(current.at)}</span></div>
                <button className={`cup-btn sm ${room.mine ? '' : 'ghost'}`} onClick={() => onWatch(room.raceId)}>{current.state === 'live' ? 'Watch' : 'Replay'}</button>
              </div>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}

function Podium({ data, onWatch, player }: { data: CupStatus; onWatch: (id: string) => void; player: PlayerStatus | null }) {
  const result = data.result!;
  const [first, second, third] = result;
  const rest = result.slice(3);
  const finalRace = data.rounds.find(r => r.final)?.rooms[0]?.raceId;
  return (
    <>
      <div className="cup-champ">
        <span className="cup-eyebrow">Pangs Cup #{data.cup.id} · Grand Final result</span>
        <h2>{first?.name} takes the Cup</h2>
        <p>{data.cup.registered} racers, {data.cup.qualifyingRounds} qualifying rounds, one final.</p>
        <div className="cup-pod">
          {[second, first, third].map((p, i) => p && (
            <div key={p.wallet} className={`cup-col c${p.place}`}>
              <img src={`/cup/badge-${p.tier}.webp`} alt="" />
              <strong>{p.name}</strong>
              <span>{p.prize}</span>
              <div className="cup-block">{p.place}</div>
              {i === 1 && null}
            </div>
          ))}
        </div>
      </div>
      <div className="cup-finrow">
        <div className="cup-card cup-seven">
          {rest.map(p => <div key={p.wallet}><b>{p.place}</b><span>{p.name}</span><em>Finalist badge</em></div>)}
          {finalRace && <button className="cup-btn ghost sm" onClick={() => onWatch(finalRace)}>Watch the Grand Final</button>}
        </div>
        <ClaimCard data={data} player={player} />
      </div>
    </>
  );
}

function ClaimCard({ data, player }: { data: CupStatus; player: PlayerStatus | null }) {
  const award = data.me?.award ?? null;
  const raced = !!data.me?.raced && !!data.participants && !!player;
  if (!award && !raced) return <Proof data={data} />;
  return (
    <div className="cup-claims">
      {award && <PrizeClaim data={data} player={player} award={award} />}
      {raced && <ParticipantClaim data={data} player={player!} />}
    </div>
  );
}

const stepText = (s: 'chain' | 'confirm' | 'pending') => s === 'chain' ? 'Switching to Robinhood Chain…' : s === 'confirm' ? 'Confirm in your wallet…' : 'Claiming…';

function PrizeClaim({ data, player, award }: { data: CupStatus; player: PlayerStatus | null; award: NonNullable<NonNullable<CupStatus['me']>['award']> }) {
  const contract = data.cup.claimContract;
  const [chain, setChain] = useState<OnChainAward | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!contract || !player) return;
    readCupAward(contract, data.cup.id, player.wallet).then(setChain).catch(() => setChain(null));
  }, [contract, player, data.cup.id]);

  const claim = async () => {
    if (!contract || !player) return;
    setError(null);
    try {
      await claimCupPrize(contract, data.cup.id, s => setStep(stepText(s)));
      setChain(await readCupAward(contract, data.cup.id, player.wallet));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The claim did not go through.');
    } finally {
      setStep(null);
    }
  };

  const usdg = chain?.usdg ?? data.cup.prizes.find(p => p.tier === award.tier)?.usdg ?? 0;
  return (
    <div className="cup-card cup-claim">
      <img src={`/cup/badge-${award.tier}.webp`} alt="" />
      <div>
        <h3>{TIER_LABEL[award.tier]}: {award.prize}</h3>
        {!contract || !chain?.published ? (
          <p>Your prize goes on chain within a day of the final. Come back here to claim it from this wallet.</p>
        ) : chain.claimed ? (
          <p className="ok">Claimed. Your badge is in your wallet{usdg > 0 ? ' and your USDG is paid' : ''}.</p>
        ) : (
          <>
            <p>Claim your soulbound badge{usdg > 0 ? ` and ${usdg} USDG` : ''}. You pay only gas, on Robinhood Chain.</p>
            <button className="cup-btn" disabled={!!step} onClick={claim}>{step ?? `Claim badge${usdg > 0 ? ` + ${usdg} USDG` : ''}`}</button>
            {chain.deadline && <small>USDG can be claimed until {new Date(chain.deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}. The badge never expires.</small>}
          </>
        )}
        {error && <p className="err">{error}</p>}
      </div>
    </div>
  );
}

/** Everyone who raced: a free soulbound Participant badge (gas only), proven with the racers' Merkle tree. */
function ParticipantClaim({ data, player }: { data: CupStatus; player: PlayerStatus }) {
  const contract = data.cup.claimContract;
  const [chain, setChain] = useState<{ published: boolean; claimed: boolean } | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!contract) return;
    readCupParticipant(contract, data.cup.id, player.wallet).then(setChain).catch(() => setChain(null));
  }, [contract, player.wallet, data.cup.id]);

  const claim = async () => {
    if (!contract || !data.participants) return;
    setError(null);
    try {
      await claimCupParticipant(contract, data.cup.id, data.participants, player.wallet, s => setStep(stepText(s)));
      setChain(await readCupParticipant(contract, data.cup.id, player.wallet));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The claim did not go through.');
    } finally {
      setStep(null);
    }
  };

  return (
    <div className="cup-card cup-claim participant">
      <img src="/cup/badge-5.webp" alt="" />
      <div>
        <h3>You raced in Pangs Cup #{data.cup.id}</h3>
        {!contract || !chain?.published ? (
          <p>Every racer gets a soulbound Participant badge. It goes on chain within a day of the final; claim it here from this wallet.</p>
        ) : chain.claimed ? (
          <p className="ok">Claimed. Your Participant badge is in your wallet.</p>
        ) : (
          <>
            <p>Claim your soulbound Participant badge. It is free: you pay only gas, on Robinhood Chain.</p>
            <button className="cup-btn" disabled={!!step} onClick={claim}>{step ?? 'Claim Participant badge'}</button>
            <small>A keepsake with no cash value. It never expires.</small>
          </>
        )}
        {error && <p className="err">{error}</p>}
      </div>
    </div>
  );
}

function Proof({ data }: { data: CupStatus }) {
  const { seedCommit, seedSecret } = data.cup;
  return (
    <div className="cup-card cup-proof">
      <h3>Check the result</h3>
      <p>{seedSecret
        ? 'The secret below was locked in before Round 1: its SHA-256 is the fingerprint we posted. Every room seed is "cup-" + sha256(secret:round:room).'
        : 'Every race comes from a secret locked in before Round 1. This is its SHA-256 fingerprint; the secret is published after the Grand Final so anyone can check every race.'}</p>
      <code title="Fingerprint (SHA-256)">{seedCommit}</code>
      {seedSecret && <code title="Secret">{seedSecret}</code>}
    </div>
  );
}

function Rules({ data }: { data: CupStatus }) {
  return (
    <p className="cup-fine">
      Every racer has equal stats, so luck decides each race. Cup races use no daily races and give no season points. Ties for the final: most wins, then most second places, then a seeded draw.
      Team wallets cannot enter. Prizes have no link to $PANG. {data.cup.state !== 'finished' && <>Fingerprint: <code>{data.cup.seedCommit.slice(0, 16)}…</code></>}
    </p>
  );
}
