import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import PixiRaceTrack from '../race/PixiRaceTrack';
import { RaceSimulation, generateBots, DEFAULT_RACE_DISTANCE, type RacerInput, type RacerSim } from '../race/simulation';
import {
  getBodyColor, bodyColorFromSheetPath, resolveImageUrl, getTraitNumber, getTraitString,
  fetchBodyColorForToken, getTokenTraits, BALL_SPRITES, type BodyColor,
} from '../race/sprites';
import { getTheme } from '../race/themes';
import { considerCall, createCommentaryState, type CommentaryCall } from '../race/commentary';
import { isAnnouncerMuted, setAnnouncerMuted, speakCall, stopAnnounce, warmCall } from '../race/announce';
import { resolveCallName } from '../race/callNames';
import { LINES, PLAYER_NUMBER } from '../race/announceClips';
import '../race/race.css';

interface Props {
  categoryInfo: any;
  selectedNft: any;
  walletAddress: string;
  onBack: () => void;
  onFinished?: (position: number, prize: number) => void;
  /** when false the "Race Again" button is disabled (e.g. daily limit reached) */
  canRaceAgain?: boolean;
}

type Phase = 'loading' | 'countdown' | 'running' | 'finished';

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

const PRIZE_POOL = 10; // $PANG
const BOT_COUNT = 9;

function buildPlayerRacer(selectedNft: any, used: Set<string>): RacerInput {
  const attributes = Array.isArray(selectedNft?.attributes) ? selectedNft.attributes : undefined;
  // Genesis tokens without inline attributes (e.g. loaded from chain only) resolve via the bundled index.
  const indexed = !attributes && !selectedNft?.isBeta && /^\d+$/.test(String(selectedNft?.tokenId ?? ''))
    ? getTokenTraits(selectedNft.tokenId)
    : null;
  let body: BodyColor = attributes ? getBodyColor(attributes) : (indexed?.body ?? bodyColorFromSheetPath(selectedNft?.sprite));
  if (selectedNft?.isBeta) body = 'Gold';
  const avatarUrl = resolveImageUrl(selectedNft?.image || selectedNft?.avatar) ?? null;
  return {
    id: 'player',
    name: resolveCallName({
      tokenId: selectedNft?.tokenId,
      displayName: selectedNft?.name,
      isPlayer: true,
      isGuest: !!selectedNft?.isGuest,
      used,
    }),
    body,
    avatarUrl: selectedNft?.isBeta ? '/beta-pass-nft.png' : avatarUrl,
    isPlayer: true,
    stats: {
      speed: getTraitNumber(attributes, 'Speed', Number(selectedNft?.speed) || indexed?.stats.speed || 50),
      burst: getTraitNumber(attributes, 'Burst Power', Number(selectedNft?.acceleration) || indexed?.stats.burst || 50),
      endurance: getTraitNumber(attributes, 'Endurance', Number(selectedNft?.endurance) || indexed?.stats.endurance || 50),
    },
    terrainAffinity: getTraitString(attributes, 'Weather Adaptation') ?? selectedNft?.trait ?? indexed?.weather ?? null,
  };
}

function makeSeed(terrain: string): string {
  return `bot-${terrain}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatTime(t: number | null): string {
  if (t === null) return '—';
  return `${t.toFixed(2)}s`;
}

export default function BotRaceRoom({ categoryInfo, selectedNft, walletAddress: _walletAddress, onBack, onFinished, canRaceAgain = true }: Props) {
  const terrain: string = categoryInfo?.terrain || 'Forest';
  const theme = getTheme(terrain);

  const [seed, setSeed] = useState(() => makeSeed(terrain));
  const [phase, setPhase] = useState<Phase>('loading');
  const [countdown, setCountdown] = useState<number>(3);
  const [sim, setSim] = useState<RaceSimulation | null>(null);
  const [standings, setStandings] = useState<StandingRow[]>([]);
  const [clock, setClock] = useState(0);
  const [playerResult, setPlayerResult] = useState<{ position: number; prize: number } | null>(null);
  const [showResults, setShowResults] = useState(false);
  /** the Pixi scenery is drawn (racers may still be lining up) */
  const [sceneReady, setSceneReady] = useState(false);
  const finishedRef = useRef(false);
  /** the simulation currently on screen; ticks from any other instance are ignored */
  const simRef = useRef<RaceSimulation | null>(null);
  const commentaryRef = useRef(createCommentaryState());
  const phaseRef = useRef<Phase>('loading');
  const [call, setCall] = useState<CommentaryCall | null>(null);
  const [callLog, setCallLog] = useState<CommentaryCall[]>([]);
  const [announcerMuted, setMutedUi] = useState(() => isAnnouncerMuted());
  phaseRef.current = phase;

  /* ---------- build racers + simulation for this race ---------- */
  useEffect(() => {
    let cancelled = false;
    finishedRef.current = false;
    simRef.current = null;
    commentaryRef.current = createCommentaryState();
    setCall(null);
    setCallLog([]);
    stopAnnounce();
    setSim(null);               // unmount the previous track immediately
    setSceneReady(false);
    setPhase('loading');
    setPlayerResult(null);
    setShowResults(false);
    setStandings([]);
    setClock(0);
    setCountdown(3);

    (async () => {
      const usedNames = new Set<string>();
      const player = buildPlayerRacer(selectedNft, usedNames);
      const bots = generateBots(seed, BOT_COUNT, new Set([String(selectedNft?.tokenId ?? '')]));
      const botInputs: RacerInput[] = await Promise.all(bots.map(async (b, i) => {
        // Bots are real collection tokens: use their actual traits from the bundled index,
        // falling back to the public metadata (and finally to generated stats).
        const traits = getTokenTraits(b.tokenId);
        const meta = traits ? null : await fetchBodyColorForToken(b.tokenId);
        return {
          id: `bot-${i}`,
          name: resolveCallName({ tokenId: b.tokenId, displayName: `Pangs Rally #${b.tokenId}`, used: usedNames }),
          body: traits?.body ?? meta?.body ?? 'Brown',
          avatarUrl: `/nft-images/${b.tokenId}.webp`,
          isPlayer: false,
          stats: traits?.stats
            ?? (meta ? {
              speed: getTraitNumber(meta.attributes, 'Speed', b.stats.speed),
              burst: getTraitNumber(meta.attributes, 'Burst Power', b.stats.burst),
              endurance: getTraitNumber(meta.attributes, 'Endurance', b.stats.endurance),
            } : b.stats),
          terrainAffinity: traits?.weather ?? (meta ? getTraitString(meta.attributes, 'Weather Adaptation') : null),
        };
      }));
      if (cancelled) return;

      // Player lane: the middle of the pack feels best on screen (PLAYER_NUMBER is also what the baked caller lines assume)
      const inputs = [...botInputs];
      inputs.splice(PLAYER_NUMBER - 1, 0, player);

      const s = new RaceSimulation(seed, inputs, { distance: DEFAULT_RACE_DISTANCE, terrain });
      simRef.current = s;
      setSim(s);
      setStandings(toRows(s));
      // phase switches to 'countdown' once the track has loaded its textures (handleTrackReady)
    })();

    return () => { cancelled = true; stopAnnounce(); };
  }, [seed, selectedNft, terrain]);

  const pushCall = useCallback((next: CommentaryCall) => {
    setCall(next);
    setCallLog(prev => [next, ...prev].slice(0, 6));
    speakCall(next.text, next.priority);
  }, []);

  const tryCall = useCallback((s: RaceSimulation, uiPhase: Phase, count: number) => {
    const next = considerCall(commentaryRef.current, {
      sim: s,
      uiPhase,
      countdown: count,
      seed,
      terrain,
    });
    if (next) pushCall(next);
  }, [pushCall, seed, terrain]);

  /* ---------- countdown ---------- */
  useEffect(() => {
    if (phase !== 'countdown' || !sim) return;
    setCountdown(3);
    warmCall(LINES.lineUp(terrain));
    warmCall(LINES.off());
    tryCall(sim, 'countdown', 3);
    let c = 3;
    const id = setInterval(() => {
      c -= 1;
      setCountdown(c);
      if (c > 0) tryCall(sim, 'countdown', c);
      if (c <= 0) {
        clearInterval(id);
        sim.start();
        setPhase('running');
      }
    }, 1000);
    return () => clearInterval(id);
  }, [phase, sim, tryCall]);

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
      const me = s.racers.find(r => r.isPlayer);
      const pos = me?.position ?? s.racers.length;
      const prize = pos === 1 ? PRIZE_POOL * 0.5 : pos === 2 ? PRIZE_POOL * 0.3 : pos === 3 ? PRIZE_POOL * 0.2 : 0;
      setPlayerResult({ position: pos, prize });
      setPhase('finished');
      onFinished?.(pos, prize);
      // let the finish-line celebration play before covering the track
      setTimeout(() => setShowResults(true), 2200);
    }
  }, [onFinished, tryCall]);

  const sortedRows = useMemo(() => [...standings].sort((a, b) => a.position - b.position), [standings]);
  const leader = sortedRows[0];
  const leaderMeters = leader ? Math.round(leader.progress * DEFAULT_RACE_DISTANCE) : 0;

  const medal = (pos: number) => pos === 1 ? '🥇' : pos === 2 ? '🥈' : pos === 3 ? '🥉' : '🏁';

  return (
    <div className="rr-root">
      <div className="rr-header">
        <button className="rr-btn" onClick={onBack}>← Back to Lobby</button>
        <div style={{ textAlign: 'center' }}>
          <h2 className="rr-title" style={{ color: theme.hudAccent }}>{categoryInfo?.icon} {terrain} Track · Bot Race</h2>
          <p className="rr-sub">{categoryInfo?.name || 'Class 5'} · Prize Pool <strong style={{ color: '#ffd700' }}>{PRIZE_POOL} $PANG</strong> · {DEFAULT_RACE_DISTANCE}m</p>
        </div>
        <div style={{ width: 140 }} />
      </div>

      <div className="rr-body">
        <div className="rr-track-wrap">
          {sim && (
            <PixiRaceTrack
              key={seed}
              className="rr-pixi-host"
              sim={sim}
              running={phase === 'running' || phase === 'finished'}
              terrain={terrain}
              onTick={handleTick}
              onSceneReady={handleSceneReady}
              onReady={handleTrackReady}
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
                <span className="rr-booth-mic" aria-hidden>🎙️</span>
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
                <div key={r.id} className={`rr-row ${r.isPlayer ? 'me' : ''} ${r.position <= 3 ? `top${r.position}` : ''} ${r.finished ? 'finished' : ''}`}>
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
          <div className="rr-panel rr-call-log">
            <h3><span>🎙️ Rally Call</span><span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.45)', fontWeight: 500 }}>Rico Scales</span></h3>
            {callLog.length === 0 ? (
              <p className="rr-call-empty">Calls appear when the lead changes.</p>
            ) : (
              <ul>
                {callLog.map(c => (
                  <li key={c.id}>{c.text}</li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>

      {/* results */}
      {phase === 'finished' && showResults && playerResult && sim && (
        <div className="rr-results-backdrop">
          <div className="rr-results">
            <div className="medal">{medal(playerResult.position)}</div>
            <h2>{playerResult.position === 1 ? 'CHAMPION!' : playerResult.position <= 3 ? 'PODIUM FINISH!' : 'Race Complete'}</h2>
            <p style={{ color: 'rgba(255,255,255,0.7)', margin: 0 }}>
              You finished <strong style={{ color: '#fff' }}>#{playerResult.position}</strong> of {sim.racers.length} on the {terrain} Track
            </p>
            {playerResult.prize > 0 ? (
              <div className="rr-prize">
                <div className="amt">+{playerResult.prize} $PANG</div>
                <div className="note">Prize earned (recorded off-chain)</div>
              </div>
            ) : (
              <div style={{ color: 'rgba(255,255,255,0.45)', margin: '1rem 0' }}>No prize for this position — try again!</div>
            )}

            <div className="rr-final">
              {sim.standings().map((r: RacerSim) => (
                <div key={r.id} className={`rr-row ${r.isPlayer ? 'me' : ''} ${r.position <= 3 ? `top${r.position}` : ''}`}>
                  <span className="rr-pos">{r.position}</span>
                  <span className="rr-num" title={`Racer number ${r.number}`}>{r.number}</span>
                  <img className="rr-avatar" src={r.avatarUrl ?? BALL_SPRITES[r.body]} alt="" onError={(e) => { (e.currentTarget as HTMLImageElement).src = BALL_SPRITES[r.body]; }} />
                  <span className="rr-name">{r.isPlayer ? `${r.name} (You)` : r.name}</span>
                  <span className="rr-time">{formatTime(r.finishTime)}</span>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button className="rr-btn" style={{ flex: 1, padding: '12px' }} onClick={onBack}>Back to Lobby</button>
              <button
                className="rr-btn primary"
                style={{ flex: 1, padding: '12px' }}
                disabled={!canRaceAgain}
                title={canRaceAgain ? undefined : 'Daily race limit reached'}
                onClick={() => setSeed(makeSeed(terrain))}
              >
                {canRaceAgain ? 'Race Again!' : 'Daily limit reached'}
              </button>
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
