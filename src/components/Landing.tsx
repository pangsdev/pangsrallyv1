import { useEffect, useState } from 'react';
import { POINTS_BY_POSITION, DAILY_RACE_LIMIT, FIELD_SIZE } from '../race/testSeason';
import './landing.css';

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

const TRACKS = [
  { name: 'Forest', icon: '🌲', img: '/forest_track.webp', live: true, text: 'Soft grass and a fast, straight run.' },
  { name: 'Desert', icon: '🏜️', img: '/desert_track.webp', live: false, text: 'Heat haze and shifting sand.' },
  { name: 'Volcanic', icon: '🌋', img: '/volcanic_track.webp', live: false, text: 'Ash, embers and hard black rock.' },
  { name: 'Midnight', icon: '🌙', img: '/midnight_track.webp', live: false, text: 'Racing by moonlight on frozen ground.' },
];

const ROADMAP = [
  { tag: 'Now', title: 'Test Season', text: 'Free races with MetaMask, season points and a public leaderboard.' },
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
    ? <button className="btn btn-primary ld-cta" onClick={onRally}>Go to the Rally 🏁</button>
    : <button className="btn btn-primary ld-cta" onClick={onJoin} disabled={signingIn}>{signingIn ? 'Check your wallet…' : 'Join the Test Season 🏁'}</button>;

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
              The test season is open to everyone: connect MetaMask, race for free and earn your place on the leaderboard before the Genesis mint.
            </p>
            <div className="ld-actions">
              {primary}
              <button className="btn btn-outline ld-cta" onClick={onVision}>Read the Vision</button>
            </div>
            <dl className="ld-stats">
              <div><dt>{FIELD_SIZE}</dt><dd>racers per race</dd></div>
              <div><dt>{DAILY_RACE_LIMIT}</dt><dd>free races a day</dd></div>
              <div><dt>0</dt><dd>gas to play</dd></div>
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
            {/* A racer jogs in on its feet, curls up and rolls off: the race in four seconds. */}
            <div className="ld-lane">
              <div className="ld-mover">
                <img className="ld-runner" src="/landing/runner.webp" alt="" />
                <img className="ld-ball" src="/sprites/ball_aurora.png" alt="" />
              </div>
            </div>
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
                  <h3>{t.icon} {t.name}</h3>
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
          <p>Connect MetaMask, sign a free message, and run your first race in under a minute.</p>
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
