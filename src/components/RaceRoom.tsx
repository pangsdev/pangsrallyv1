import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import PixiRaceTrack from '../race/PixiRaceTrack';
import { RaceSimulation, DEFAULT_RACE_DISTANCE, type RacerSim } from '../race/simulation';
import { BALL_SPRITES, type BodyColor } from '../race/sprites';
import { getTheme } from '../race/themes';
import { considerCall, createCommentaryState, lineUpLine, type CommentaryCall } from '../race/commentary';
import { isAnnouncerMuted, playStartBeep, setAnnouncerMuted, speakCall, stopAnnounce, warmCall } from '../race/announce';
import { LINES } from '../race/announceClips';
import RicoHost from './RicoHost';
import { PREDICTIONS_ON, testSeason, type PublicRace } from '../testSeason/api';
import { predictionPointsFor } from '../race/testSeason';
import { ordinal } from './Predictions';
import '../race/race.css';
import { TrackBadge } from './Icons';
import { canvasToBlob, drawShareCard, ordinalOf } from './shareCard';

/** A race whose result the server has already fixed; the room only replays it. */
export interface LoadedRace {
  race: PublicRace;
  /** the viewer's result when they raced in it */
  you?: { position: number; points: number } | null;
}

interface Props {
  categoryInfo: any;
  /** e.g. "Bot Race", "Online Race", "Replay" */
  title: string;
  /** lower-case wallet of the viewer; their racer is highlighted */
  playerWallet: string | null;
  loadRace: () => Promise<LoadedRace>;
  onBack: () => void;
  backLabel?: string;
  /** "Race again" button in the results; omit for replays */
  raceAgain?: { label: string; enabled: boolean; hint?: string; onClick: () => void } | null;
  /** called once when the result is on screen */
  onFinished?: () => void;
}

type Phase = 'loading' | 'countdown' | 'running' | 'finished' | 'error';

interface StandingRow {
  id: string;
  number: number;
  name: string;
  position: number;
  progress: number;
  isPlayer: boolean;
  body: BodyColor;
  avatarUrl: string | null;
  finished: boolean;
  finishTime: number | null;
}

function formatTime(t: number | null): string {
  if (t === null) return '—';
  return `${t.toFixed(2)}s`;
}

export default function RaceRoom({ categoryInfo, title, playerWallet, loadRace, onBack, backLabel = '← Back to Lobby', raceAgain, onFinished }: Props) {
  const [loaded, setLoaded] = useState<LoadedRace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const terrain: string = loaded?.race.terrain || categoryInfo?.terrain || 'Forest';
  const theme = getTheme(terrain);

  const [phase, setPhase] = useState<Phase>('loading');
  const [countdown, setCountdown] = useState<number>(3);
  const [sim, setSim] = useState<RaceSimulation | null>(null);
  const [standings, setStandings] = useState<StandingRow[]>([]);
  const [clock, setClock] = useState(0);
  const [showResults, setShowResults] = useState(false);
  /** the Pixi scenery is drawn (racers may still be lining up) */
  const [sceneReady, setSceneReady] = useState(false);
  const finishedRef = useRef(false);
  /** the simulation currently on screen; ticks from any other instance are ignored */
  const simRef = useRef<RaceSimulation | null>(null);
  const commentaryRef = useRef(createCommentaryState());
  const phaseRef = useRef<Phase>('loading');
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;
  const [call, setCall] = useState<CommentaryCall | null>(null);
  const [callLog, setCallLog] = useState<CommentaryCall[]>([]);
  const [announcerMuted, setMutedUi] = useState(() => isAnnouncerMuted());
  phaseRef.current = phase;
  /** copies the track as drawn right now; the finish frame goes on the share card */
  const snapshotRef = useRef<(() => HTMLCanvasElement | null) | null>(null);
  const finishShot = useRef<HTMLCanvasElement | null>(null);
  const [card, setCard] = useState<{ blob: Blob; url: string } | null>(null);
  const [shareNote, setShareNote] = useState<string | null>(null);

  /* ---------- fetch the race once, then build the simulation that replays it ---------- */
  // One request per mounted room: StrictMode re-runs effects, and a second call would start (and spend) a second race.
  const loadOnce = useRef<Promise<LoadedRace> | null>(null);
  const loadRef = useRef(loadRace);
  useEffect(() => {
    let cancelled = false;
    loadOnce.current ??= loadRef.current();
    (async () => {
      try {
        const next = await loadOnce.current!;
        if (cancelled) return;
        const { race } = next;
        if (race.status !== 'finished' || !race.seed || !race.field) throw new Error('This race has not started yet.');
        const inputs = race.field.map(r => ({ ...r, isPlayer: !!playerWallet && r.wallet === playerWallet }));
        const s = new RaceSimulation(race.seed, inputs, { distance: DEFAULT_RACE_DISTANCE, terrain: race.terrain });
        simRef.current = s;
        setLoaded(next);
        setSim(s);
        setStandings(toRows(s));
        // phase switches to 'countdown' once the track has loaded its textures (handleTrackReady)
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not load the race.');
        setPhase('error');
      }
    })();
    return () => { cancelled = true; stopAnnounce(); };
  }, [playerWallet]);

  const pushCall = useCallback((next: CommentaryCall) => {
    setCall(next);
    setCallLog(prev => [next, ...prev].slice(0, 6));
    speakCall(next.text, next.priority, next.fallback);
  }, []);

  const tryCall = useCallback((s: RaceSimulation, uiPhase: Phase, count: number) => {
    if (uiPhase === 'error') return;
    const next = considerCall(commentaryRef.current, {
      sim: s,
      uiPhase,
      countdown: count,
      seed: loaded?.race.seed ?? '',
      terrain,
      cup: loaded?.race.cup ?? null,
    });
    if (next) pushCall(next);
  }, [pushCall, loaded, terrain]);

  /* ---------- countdown ---------- */
  useEffect(() => {
    if (phase !== 'countdown' || !sim) return;
    setCountdown(3);
    warmCall(lineUpLine(terrain, loaded?.race.cup));
    warmCall(LINES.off());
    tryCall(sim, 'countdown', 3);
    playStartBeep('tick');
    let c = 3;
    const id = setInterval(() => {
      c -= 1;
      setCountdown(c);
      if (c > 0) tryCall(sim, 'countdown', c);
      playStartBeep(c > 0 ? 'tick' : 'go');   // start lights: dit (3), dit (2), dit (1), diiit (GO)
      if (c <= 0) {
        clearInterval(id);
        sim.start();
        setPhase('running');
      }
    }, 1000);
    return () => clearInterval(id);
  }, [phase, sim, tryCall, terrain, loaded]);

  useEffect(() => {
    if (phase === 'loading' && sim && sceneReady) tryCall(sim, 'loading', 3);
  }, [phase, sim, sceneReady, tryCall]);

  useEffect(() => {
    try { window.speechSynthesis?.cancel(); } catch { /* leftover browser TTS from earlier builds */ }
  }, []);

  /* ---------- track readiness ---------- */
  const handleSceneReady = useCallback(() => setSceneReady(true), []);
  const handleTrackReady = useCallback(() => {
    setSceneReady(true);
    // give the racers a moment to jog onto the start line before counting down
    setTimeout(() => setPhase(p => (p === 'loading' ? 'countdown' : p)), 900);
  }, []);

  /* ---------- HUD updates from the render loop ---------- */
  const handleTick = useCallback((s: RaceSimulation) => {
    if (s !== simRef.current) return;
    setStandings(toRows(s));
    setClock(s.time);
    tryCall(s, phaseRef.current, 0);
    if (s.finished && !finishedRef.current) {
      finishedRef.current = true;
      setPhase('finished');
      onFinishedRef.current?.();
      // let the finish-line celebration play before covering the track
      setTimeout(() => { finishShot.current = snapshotRef.current?.() ?? null; }, 2000);
      setTimeout(() => setShowResults(true), 2200);
    }
  }, [tryCall]);

  /** The viewer's prediction for this room: the number only, so nothing is given away before the finish. */
  const [pick, setPick] = useState<number | null>(null);
  const pickRace = PREDICTIONS_ON && loaded?.race.kind === 'online' && playerWallet ? loaded.race.id : null;
  useEffect(() => {
    if (pickRace) testSeason.prediction(pickRace).then(r => setPick(r.pick)).catch(() => {});
  }, [pickRace]);

  const sortedRows = useMemo(() => [...standings].sort((a, b) => a.position - b.position), [standings]);
  const leader = sortedRows[0];
  const leaderMeters = leader ? Math.round(leader.progress * DEFAULT_RACE_DISTANCE) : 0;

  /** The server's result is the one that counts; the replay should always agree with it. */
  const myResult = useMemo(() => {
    if (!loaded || !playerWallet) return null;
    if (loaded.you) return loaded.you;
    const p = loaded.race.players.find(x => x.wallet === playerWallet);
    return p && p.position ? { position: p.position, points: p.points } : null;
  }, [loaded, playerWallet]);

  useEffect(() => {
    if (phase !== 'finished' || !sim || !myResult) return;
    const local = sim.racers.find(r => r.isPlayer)?.position;
    if (local !== myResult.position) console.warn(`Replay finished ${local}, server says ${myResult.position}`);
  }, [phase, sim, myResult]);

  const pickedRacer = pick ? sim?.racers.find(r => r.number === pick) ?? null : null;
  const winner = sim?.standings()[0];

  /* ---------- share card ---------- */
  const raceKind = loaded?.race.kind;
  const isCup = raceKind === 'cup';
  // what the share card, the tweet and the result say this race was for
  const event = isCup ? { name: 'Pangs Cup', pts: 'Cup', where: 'the Pangs Cup' }
    : raceKind === 'rally' ? { name: 'Daily Rally', pts: 'Rally', where: 'the @PangsRally Daily Rally' }
    : { name: 'Beta Season', pts: 'Season', where: '@PangsRally' };
  useEffect(() => {
    if (!showResults || !sim || !myResult) return;
    let cancelled = false;
    let url: string | null = null;
    const order = sim.standings();
    const me = order.find(r => r.isPlayer);
    const rows = order.filter(r => r.position <= 3 || r.isPlayer);
    drawShareCard({
      track: finishShot.current,
      terrain,
      event: event.name,
      playerName: me?.name ?? 'I',
      position: myResult.position,
      fieldSize: sim.racers.length,
      points: myResult.points,
      pointsLabel: `${event.pts} pts`,
      top: rows.map(r => ({ position: r.position, number: r.number, name: r.name, body: r.body, time: r.finishTime, isPlayer: r.isPlayer })),
    })
      .then(canvasToBlob)
      .then(blob => {
        if (cancelled || !blob) return;
        url = URL.createObjectURL(blob);
        setCard({ blob, url });
      })
      .catch(() => {});
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [showResults, sim, myResult, terrain, event.name, event.pts]);

  const shareText = myResult
    ? `${myResult.position === 1 ? `🏆 I won on the ${terrain} Track` : `🏁 I finished ${ordinalOf(myResult.position)} of ${sim?.racers.length ?? 10} on the ${terrain} Track`} in ${event.where}!\n+${myResult.points} ${event.pts === 'Season' ? 'Beta Season' : event.pts} points\n\nRace your Pangolin 👇\nhttps://pangsrally.com`
    : '';

  const saveCard = () => {
    if (!card) return;
    const a = document.createElement('a');
    a.href = card.url;
    a.download = 'pangs-rally-result.png';
    a.click();
  };

  const shareOnX = () => {
    if (!card) return;
    const file = new File([card.blob], 'pangs-rally-result.png', { type: 'image/png' });
    // phones: the share sheet hands the image straight to the X app
    if (window.matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
      navigator.share({ files: [file], text: shareText }).catch(() => {});
      return;
    }
    // desktop: X's post window cannot take an image from a link, so copy it for a paste
    let copying: Promise<void>;
    try {
      copying = navigator.clipboard.write([new ClipboardItem({ 'image/png': card.blob })]);
    } catch (err) {
      copying = Promise.reject(err);
    }
    window.open(`https://x.com/intent/post?text=${encodeURIComponent(shareText)}`, '_blank', 'noopener,noreferrer');
    copying.then(
      () => setShareNote('Image copied. Paste it into your post with ⌘V / Ctrl+V.'),
      () => { saveCard(); setShareNote('Image saved. Attach it to your post.'); },
    );
  };

  return (
    <div className="rr-root">
      <div className="rr-header">
        <button className="rr-btn" onClick={onBack}>{backLabel}</button>
        <div style={{ textAlign: 'center' }}>
          <h2 className="rr-title" style={{ color: theme.hudAccent }}><TrackBadge terrain={terrain} size={26} style={{ marginRight: 8, verticalAlign: '-5px' }} />{terrain} Track · {title}</h2>
          <p className="rr-sub">{isCup ? 'Pangs Cup · Equal stats for everyone · luck decides' : raceKind === 'rally' ? 'Daily Rally · Rally points for every finish' : 'Beta Season · Season points for every finish'} · {DEFAULT_RACE_DISTANCE}m</p>
        </div>
        <div className="rr-header-spacer" />
      </div>

      {phase === 'error' ? (
        <div className="rr-error">
          <div style={{ fontSize: '2.5rem' }}>🏁</div>
          <p>{error}</p>
          <button className="rr-btn primary" onClick={onBack}>{backLabel}</button>
        </div>
      ) : (
      <div className="rr-body">
        <div className="rr-track-wrap">
          {sim && (
            <PixiRaceTrack
              className="rr-pixi-host"
              sim={sim}
              running={phase === 'running' || phase === 'finished'}
              terrain={terrain}
              onTick={handleTick}
              onSceneReady={handleSceneReady}
              onReady={handleTrackReady}
              snapshotRef={snapshotRef}
            />
          )}

          {/* progress strip */}
          {sim && (
            <div className="rr-progress">
              <div className="rr-progress-bar"><span className="rr-progress-flag">🏁</span></div>
              {standings.map(r => (
                <span
                  key={r.id}
                  className={`rr-progress-dot ${r.isPlayer ? 'me' : ''}`}
                  style={{ left: `${Math.min(100, r.progress * 100)}%`, background: `url(${BALL_SPRITES[r.body]}) center/cover` }}
                  title={r.name}
                />
              ))}
            </div>
          )}

          <div className="rr-chip tl">⏱ <strong>{clock.toFixed(1)}s</strong></div>
          <div className="rr-chip tr">Leader <strong>{leaderMeters}m</strong> / {DEFAULT_RACE_DISTANCE}m</div>

          {phase === 'loading' && !sceneReady && (
            <div className="rr-loading">
              <div className="rr-spinner" />
              <div>Preparing the track…</div>
            </div>
          )}
          {phase === 'loading' && sceneReady && (
            <div className="rr-loading-pill">
              <div className="rr-spinner small" />
              <span>Racers are lining up…</span>
            </div>
          )}

          {phase === 'countdown' && countdown > 0 && (
            <div className="rr-overlay">
              <div key={countdown} className="rr-count">{countdown}</div>
              <div className="rr-count-sub">On your marks</div>
            </div>
          )}
          {phase === 'running' && clock < 1.0 && (
            <div className="rr-overlay">
              <div className="rr-count go">GO!</div>
            </div>
          )}

          {(phase !== 'loading' || sceneReady) && (
            <div className={`rr-booth ${call ? 'live' : ''}`} aria-live="polite">
              <div className="rr-booth-face">
                <img src="/cup/rico-face.webp" alt="" />
                <span className="rr-booth-pulse" />
              </div>
              <div className="rr-booth-copy">
                <div className="rr-booth-meta">
                  <strong>Rico Scales</strong>
                  <span>Pangs Radio · LIVE</span>
                </div>
                <p key={call?.id ?? 'idle'}>{call?.text ?? '—'}</p>
              </div>
              <button
                className="rr-booth-mute"
                onClick={() => {
                  const next = !announcerMuted;
                  setAnnouncerMuted(next);
                  setMutedUi(next);
                }}
                title={announcerMuted ? 'Unmute caller' : 'Mute caller'}
                aria-label={announcerMuted ? 'Unmute caller' : 'Mute caller'}
              >
                {announcerMuted ? '🔇' : '🔊'}
              </button>
            </div>
          )}
        </div>

        {/* standings */}
        <aside className="rr-side">
          <div className="rr-panel">
            <h3><span>🏁 Live Standings</span><span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.45)', fontWeight: 500 }}>{standings.filter(r => r.finished).length}/{standings.length} finished</span></h3>
            <div className="rr-standings">
              {sortedRows.map(r => (
                <div key={r.id} className={`rr-row ${r.isPlayer ? 'me' : ''} ${r.number === pick ? 'pick' : ''} ${r.position <= 3 ? `top${r.position}` : ''} ${r.finished ? 'finished' : ''}`}>
                  <span className="rr-pos">{r.position}</span>
                  <span className="rr-num" title={`Racer number ${r.number}`}>{r.number}</span>
                  <img className="rr-avatar" src={r.avatarUrl ?? BALL_SPRITES[r.body]} alt="" onError={(e) => { (e.currentTarget as HTMLImageElement).src = BALL_SPRITES[r.body]; }} />
                  <span className="rr-name">{r.isPlayer ? `${r.name} (You)` : r.name}</span>
                  <span className="rr-meter"><div style={{ width: `${r.progress * 100}%`, background: r.isPlayer ? '#ffd700' : theme.hudAccent }} /></span>
                  <span className="rr-pct">{r.finished ? formatTime(r.finishTime) : `${Math.floor(r.progress * 100)}%`}</span>
                </div>
              ))}
            </div>
          </div>
          <RicoHost className="rr-rico" log={callLog.map(c => c.text)} />
        </aside>
      </div>
      )}

      {/* results */}
      {phase === 'finished' && showResults && sim && (
        <div className="rr-results-backdrop">
          <div className={`rr-results ${myResult ? '' : 'solo'}`}>
            <div className="rr-res-main">
              {myResult ? (
                <div className="rr-res-head">
                  <div className={`rr-res-badge p${Math.min(myResult.position, 4)}`}>
                    <strong>{myResult.position}</strong>
                    <span>of {sim.racers.length}</span>
                  </div>
                  <div className="rr-res-title">
                    <h2>{myResult.position === 1 ? 'Champion!' : myResult.position <= 3 ? 'Podium finish!' : 'Race complete'}</h2>
                    <p>You finished {ordinalOf(myResult.position)} on the {terrain} Track</p>
                    <span className="rr-res-pts">+{myResult.points} {event.pts.toLowerCase()} pts</span>
                  </div>
                </div>
              ) : (
                <div className="rr-res-head">
                  <div className="rr-res-badge p1"><strong>{winner?.number ?? '—'}</strong><span>winner</span></div>
                  <div className="rr-res-title">
                    <h2>Race result</h2>
                    <p>{winner ? <>Number {winner.number} <b>{winner.name}</b> wins on the {terrain} Track</> : null}</p>
                  </div>
                </div>
              )}

              {pickedRacer && (
                <p className={`rr-pickline ${predictionPointsFor(pickedRacer.position) > 0 ? 'hit' : ''}`}>
                  Your pick, <strong>Number {pickedRacer.number}</strong>, finished {ordinal(pickedRacer.position)} · +{predictionPointsFor(pickedRacer.position)} prediction pts
                </p>
              )}

              {myResult && (
                <div className="rr-share">
                  <button className="rr-share-card" disabled={!card} onClick={saveCard} title="Save image">
                    {card ? <img src={card.url} alt="Your race result card" /> : <span className="rr-share-wait" />}
                  </button>
                  <div className="rr-share-actions">
                    <button className="rr-btn rr-share-x" disabled={!card} onClick={shareOnX}>
                      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                      Share on X
                    </button>
                    <button className="rr-btn" disabled={!card} onClick={saveCard}>Save image</button>
                  </div>
                  {shareNote && <p className="rr-share-note">{shareNote}</p>}
                </div>
              )}
            </div>

            <div className="rr-res-side">
              <h3>Finish order</h3>
              <div className="rr-final">
                {sim.standings().map((r: RacerSim) => (
                  <div key={r.id} className={`rr-row ${r.isPlayer ? 'me' : ''} ${r.number === pick ? 'pick' : ''} ${r.position <= 3 ? `top${r.position}` : ''}`}>
                    <span className="rr-pos">{r.position}</span>
                    <span className="rr-num">{r.number}</span>
                    <img className="rr-avatar" src={r.avatarUrl ?? BALL_SPRITES[r.body]} alt="" onError={(e) => { (e.currentTarget as HTMLImageElement).src = BALL_SPRITES[r.body]; }} />
                    <span className="rr-name">{r.isPlayer ? `${r.name} (You)` : r.name}</span>
                    <span className="rr-time">{formatTime(r.finishTime)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rr-res-foot">
              {raceAgain?.hint && !raceAgain.enabled && <p className="rr-res-hint">{raceAgain.hint}</p>}
              <div className="rr-res-btns">
                <button className="rr-btn" onClick={onBack}>{backLabel.replace(/^←\s*/, '')}</button>
                {raceAgain && (
                  <button className="rr-btn primary" disabled={!raceAgain.enabled} onClick={raceAgain.onClick}>{raceAgain.label}</button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function toRows(s: RaceSimulation): StandingRow[] {
  return s.racers.map(r => ({
    id: r.id,
    number: r.number,
    name: r.name,
    position: r.position,
    progress: Math.min(1, r.distance / s.totalDistance),
    isPlayer: r.isPlayer,
    body: r.body,
    avatarUrl: r.avatarUrl,
    finished: r.phase === 'finished',
    finishTime: r.finishTime,
  }));
}
