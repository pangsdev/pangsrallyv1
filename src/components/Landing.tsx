import { useEffect, useState } from 'react';
import { POINTS_BY_POSITION, DAILY_RACE_LIMIT, FIELD_SIZE } from '../race/testSeason';
import HeroRunner from './HeroRunner';
import './landing.css';
import { FlagIcon } from './Icons';

interface Props {
  signedIn: boolean;
  signingIn: boolean;
  onJoin: () => void;
  onRally: () => void;
  onVision: () => void;
  onLeaderboard: () => void;
}

// Only the ten public teasers ship before the mint.
const TEASERS = Array.from({ length: 10 }, (_, i) => i + 1);
const ordinal = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;

const STEPS = [
  { n: '01', title: 'Line up', text: `${FIELD_SIZE} pangolins take their lanes. Real players first, bots fill every empty spot, so a race never waits for long.` },
  { n: '02', title: 'Curl and roll', text: 'They sprint off the line, curl into armoured balls and roll for the finish. In the test season every racer runs on equal stats.' },
  { n: '03', title: 'Score points', text: `Every finish scores season points, ${POINTS_BY_POSITION[0]} for a win down to ${POINTS_BY_POSITION[POINTS_BY_POSITION.length - 1]} for ${ordinal(FIELD_SIZE)}. Climb the leaderboard one race at a time.` },
];

const BETA_STEPS = [
  { n: '1', title: 'Get an invite code', text: 'The Beta season is invite-only while we test. The team and community share codes on X.' },
  { n: '2', title: 'Connect MetaMask', text: 'Sign a free message to prove the wallet is yours. No gas, and no funds move.' },
  { n: '3', title: 'Claim your Beta pass', text: 'Mint the free Beta NFT on Robinhood Chain. You pay only the network gas. One per wallet.' },
  { n: '4', title: 'Race', text: `Run up to ${DAILY_RACE_LIMIT} races a day against bots or other players and climb the leaderboard.` },
];

const FAQ = [
  { q: 'Is the Beta pass really free?', a: 'Yes. There is no mint price. The only cost is the small network fee (gas) that every transaction on Robinhood Chain needs, paid in ETH.' },
  { q: 'Why do I need ETH on Robinhood Chain?', a: 'Minting is a blockchain transaction, and gas is paid in ETH on that chain. Keep a small amount in your wallet before you mint. MetaMask will offer to add the network for you.' },
  { q: 'What does the Beta pass do?', a: 'It unlocks racing in the test season, and your racer wears it on the track. It is a test pass: we make no promises about future rewards or value.' },
  { q: 'Can I sell or transfer it?', a: 'It is a normal NFT, so you can. The game checks that your own wallet minted a pass, so buying one does not let someone else in, and invited players still mint their own.' },
  { q: 'Is there a $PANG token?', a: 'Not yet. $PANG launches only after the NFT mints. Until we announce it on our official channels, anything presented as $PANG is not ours.' },
  { q: 'Where do I find an invite code?', a: 'Follow Pangs Rally on X. We share codes there as places open up. Each code has a limited number of places.' },
];

const TRACKS = [
  { name: 'Forest', img: '/forest_track.webp', live: true, text: 'Soft grass and a fast, straight run.' },
  { name: 'Desert', img: '/desert_track.webp', live: false, text: 'Heat haze and shifting sand.' },
  { name: 'Volcanic', img: '/volcanic_track.webp', live: false, text: 'Ash, embers and hard black rock.' },
  { name: 'Midnight', img: '/midnight_track.webp', live: false, text: 'Racing by moonlight on frozen ground.' },
];

const ROADMAP = [
  { tag: 'Now', title: 'Test Season', text: 'Invite-only races with a free Beta pass, season points and a public leaderboard.' },
  { tag: 'Next', title: 'Genesis Mint', text: '2,222 Racing Pangolins, each with its own body, weather and racing stats.' },
  { tag: 'After the mint', title: '$PANG', text: 'The game token launches only after the NFT mints. There is no token today.' },
  { tag: 'Later', title: 'The Laboratory', text: 'Breeding opens, and a new generation of pangolins joins the track.' },
];

export default function Landing({ signedIn, signingIn, onJoin, onRally, onVision, onLeaderboard }: Props) {
  const [hero, setHero] = useState(1);
  useEffect(() => {
    const id = setInterval(() => setHero(h => (h % TEASERS.length) + 1), 1800);
    return () => clearInterval(id);
  }, []);
  const side = (offset: number) => ((hero - 1 + offset + TEASERS.length) % TEASERS.length) + 1;

  const primary = signedIn
    ? <button className="btn btn-primary ld-cta" onClick={onRally}>Go to the Rally <FlagIcon size={17} /></button>
    : <button className="btn btn-primary ld-cta" onClick={onJoin} disabled={signingIn}>{signingIn ? 'Check your wallet…' : <>Join the Beta Season <FlagIcon size={17} /></>}</button>;

  return (
    <div className="landing">
      {/* ---------- Hero ---------- */}
      <section className="ld-hero">
        <div className="ld-hero-glow" aria-hidden="true" />
        <div className="ld-wrap ld-hero-grid">
          <div className="ld-hero-copy">
            <span className="ld-badge"><span className="ld-dot" /> Test Season is live</span>
            <h1 className="ld-title">
              Curl up. Roll fast.<br />
              <span className="text-gradient">Win the Rally.</span>
            </h1>
            <p className="ld-lead">
              Pangs Rally is a racing game for Pangolin NFTs. Ten racers sprint, curl into armoured balls and roll for the line.
              The Beta season is invite-only for now: connect MetaMask, claim your free Beta pass and earn your place on the leaderboard before the Genesis mint.
            </p>
            <div className="ld-actions">
              {primary}
              <button className="btn btn-outline ld-cta" onClick={onVision}>Read the Vision</button>
            </div>
            <dl className="ld-stats">
              <div><dt>{FIELD_SIZE}</dt><dd>racers per race</dd></div>
              <div><dt>{DAILY_RACE_LIMIT}</dt><dd>free races a day</dd></div>
              <div><dt>Free</dt><dd>Beta pass, gas only</dd></div>
              <div><dt>400 m</dt><dd>of pure sprint</dd></div>
            </dl>
          </div>

          <div className="ld-hero-art" aria-hidden="true">
            <div className="ld-card ld-card-left"><img src={`/nft-images/${side(-1)}.webp`} alt="" /></div>
            <div className="ld-card ld-card-right"><img src={`/nft-images/${side(1)}.webp`} alt="" /></div>
            <div className="ld-card ld-card-main">
              {/* All ten stay mounted so the swap is a cross-fade, never an empty frame. */}
              {TEASERS.map(id => <img key={id} src={`/nft-images/${id}.webp`} alt="" className={id === hero ? 'on' : ''} />)}
            </div>
            {/* A racer gallops in on its feet, curls up and rolls off: the race in a few seconds. */}
            <div className="ld-lane"><HeroRunner /></div>
          </div>
        </div>
      </section>

      {/* ---------- How it works ---------- */}
      <section className="ld-section">
        <div className="ld-wrap">
          <div className="ld-head">
            <span className="ld-eyebrow">How a race works</span>
            <h2>One short sprint, then a winner.</h2>
            <p>No setup, no fees, no waiting around. Pick a mode, watch your pangolin run, and see where it lands.</p>
          </div>
          <div className="ld-steps">
            {STEPS.map(s => (
              <article key={s.n} className="ld-step">
                <span className="ld-step-n">{s.n}</span>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Points banner ---------- */}
      <section className="ld-banner">
        <img className="ld-banner-img" src="/racersphoto.webp" alt="Pangolins lined up on a desert track" loading="lazy" />
        <div className="ld-banner-shade" />
        <div className="ld-wrap ld-banner-body">
          <span className="ld-eyebrow">Season points</span>
          <h2>Every finish counts.</h2>
          <p>Win or come tenth, you score. Points add up across the whole test season.</p>
          <ol className="ld-points">
            {POINTS_BY_POSITION.map((p, i) => (
              <li key={i} className={i < 3 ? 'top' : ''}><span>{ordinal(i + 1)}</span><strong>{p}</strong></li>
            ))}
          </ol>
          <button className="btn btn-primary ld-cta" onClick={onLeaderboard}>See the leaderboard</button>
        </div>
      </section>

      {/* ---------- Beta season ---------- */}
      <section className="ld-section ld-alt" id="beta">
        <div className="ld-wrap">
          <div className="ld-head">
            <span className="ld-eyebrow">Beta season</span>
            <h2>How to join the Beta.</h2>
            <p>Four short steps from invite code to the starting line.</p>
          </div>
          <ol className="ld-beta-steps">
            {BETA_STEPS.map(b => (
              <li key={b.n}>
                <span className="ld-beta-n">{b.n}</span>
                <h3>{b.title}</h3>
                <p>{b.text}</p>
              </li>
            ))}
          </ol>
          <div className="ld-beta-note">
            <img src="/beta/beta-pass.webp" alt="The Pangs Rally Beta pass" loading="lazy" />
            <div>
              <h3>Before you mint</h3>
              <p>Have a little ETH on <strong>Robinhood Chain</strong> for gas. The Beta pass itself costs nothing, but every blockchain transaction needs a small network fee.</p>
              <p>It is a test pass for the test season. We make no promises about rewards or value, and only invited wallets can mint.</p>
            </div>
          </div>
          <div className="ld-faq">
            <h3>Questions</h3>
            {FAQ.map(f => (
              <details key={f.q}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Tracks ---------- */}
      <section className="ld-section">
        <div className="ld-wrap">
          <div className="ld-head">
            <span className="ld-eyebrow">Tracks</span>
            <h2>Four worlds to race through.</h2>
            <p>Each track favours a different Weather Adaptation. The Forest is open for the test season; the rest unlock later.</p>
          </div>
          <div className="ld-tracks">
            {TRACKS.map(t => (
              <article key={t.name} className={`ld-track ${t.live ? 'live' : ''}`} style={{ backgroundImage: `url(${t.img})` }}>
                <div className="ld-track-body">
                  <span className={`ld-track-tag ${t.live ? 'live' : ''}`}>{t.live ? '● Live' : 'Coming soon'}</span>
                  <h3>{t.name}</h3>
                  <p>{t.text}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Roadmap ---------- */}
      <section className="ld-section ld-alt">
        <div className="ld-wrap">
          <div className="ld-head">
            <span className="ld-eyebrow">Roadmap</span>
            <h2>Where the Rally goes next.</h2>
          </div>
          <ol className="ld-road">
            {ROADMAP.map((r, i) => (
              <li key={r.title} className={i === 0 ? 'now' : ''}>
                <span className="ld-road-tag">{r.tag}</span>
                <h3>{r.title}</h3>
                <p>{r.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ---------- Final call ---------- */}
      <section className="ld-final">
        <div className="ld-wrap ld-final-body">
          <h2>Your lane is waiting.</h2>
          <p>Get an invite code, claim your free Beta pass, and run your first race in a few minutes.</p>
          {primary}
        </div>
      </section>

      <footer className="ld-footer">
        <div className="ld-wrap ld-footer-row">
          <img src="/favicon-48.png" alt="" width={28} height={28} />
          <span>© {new Date().getFullYear()} Pangs Rally</span>
          <nav>
            <a onClick={onVision}>The Vision</a>
            <a onClick={onLeaderboard}>Leaderboard</a>
            <a href="https://x.com/PangsRally" target="_blank" rel="noopener noreferrer">X / Twitter</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
