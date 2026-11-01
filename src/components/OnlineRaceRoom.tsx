import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../supabaseClient';

const TOTAL_DISTANCE = 800;
const MAX_PLAYERS = 10;

interface RacerState {
  id: string;
  name: string;
  distance: number;
  speed: number;
  targetSpeed: number;
  position: number;
  sprite: string;
  avatar: string;
  isPlayer?: boolean;
  finishTime?: number;
  walletAddress?: string;
}

interface Props {
  categoryInfo: any;
  selectedNft: any;
  walletAddress: string;
  onBack: () => void;
  onFinished?: (position: number, prize: number) => void;
}

const BODY_SPRITES: Record<string, string> = {
  "Red": "/pangolin_sprite_red.png",
  "Rainbow": "/pangolin_sprite_rainbow.png",
  "Brown": "/pangolin_sprite.png",
  "Blue": "/pangolin_sprite_blue.png",
  "Black": "/pangolin_sprite_black.png",
  "Silver": "/pangolin_sprite_silver.png",
  "Albino": "/pangolin_sprite_albino.png",
  "Gold": "/pangolin_sprite_gold.png",
};

function getSprite(attributes: any[]): string {
  if (!attributes) return "/pangolin_sprite.png";
  const bodyAttr = attributes?.find((a: any) => a.trait_type === 'Body');
  return bodyAttr && BODY_SPRITES[bodyAttr.value] ? BODY_SPRITES[bodyAttr.value] : "/pangolin_sprite.png";
}

// Simple seeded PRNG
function seededRand(seed: number, index: number): number {
  const x = Math.sin(seed + index) * 10000;
  return x - Math.floor(x);
}

export default function OnlineRaceRoom({ categoryInfo, selectedNft, walletAddress, onBack, onFinished }: Props) {
  const [phase, setPhase] = useState<'waiting' | 'countdown' | 'running' | 'finished'>('waiting');
  const [roomId, setRoomId] = useState<string | null>(null);
  const [roomCode, setRoomCode] = useState<string>('');
  const [players, setPlayers] = useState<any[]>([]);
  const [racers, setRacers] = useState<RacerState[]>([]);
  const [countdown, setCountdown] = useState(3);
  const [_positions, setPositions] = useState<RacerState[]>([]);
  const [playerResult, setPlayerResult] = useState<{ position: number; prize: number } | null>(null);
  const [statusMsg, setStatusMsg] = useState('Looking for a room...');
  const animFrameRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(performance.now());
  const seedRef = useRef<number>(0);
  const prizePool = categoryInfo?.prizePool || 10;

  const getPositionLabel = (pos: number) => pos === 1 ? '🥇' : pos === 2 ? '🥈' : pos === 3 ? '🥉' : `#${pos}`;

  // --- ROOM JOIN LOGIC ---
  const joinOrCreateRoom = useCallback(async () => {
    setStatusMsg('Finding an available room...');

    // Find a waiting room that isn't full
    const { data: openRooms } = await supabase
      .from('race_rooms')
      .select('*')
      .eq('status', 'waiting')
      .eq('map', categoryInfo?.terrain || 'Forest')
      .order('created_at', { ascending: true })
      .limit(5);

    // Pick the first room that still has space (check player count via players already fetched)
    let targetRoom = openRooms?.[0] || null;
    
    // If we got rooms, verify each one isn't full already
    if (openRooms && openRooms.length > 0) {
      for (const room of openRooms) {
        const { count } = await supabase
          .from('race_room_players')
          .select('*', { count: 'exact', head: true })
          .eq('room_id', room.id);
        if ((count || 0) < MAX_PLAYERS) {
          targetRoom = room;
          break;
        }
      }
      if (!targetRoom) targetRoom = null; // all full
    }

    if (!targetRoom) {
      // Create a new room
      setStatusMsg('Creating a new room...');
      const code = `R-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
      const { data: newRoom } = await supabase
        .from('race_rooms')
        .insert({
          room_code: code,
          map: categoryInfo?.terrain || 'Forest',
          class: categoryInfo?.name || 'Class 5',
          max_players: MAX_PLAYERS,
          prize_pool: prizePool,
          status: 'waiting',
        })
        .select()
        .single();
      targetRoom = newRoom;
    }

    if (!targetRoom) {
      setStatusMsg('Failed to find/create room. Please try again.');
      return;
    }

    setRoomId(targetRoom.id);
    setRoomCode(targetRoom.room_code);

    // Join the room
    const sprite = selectedNft?.attributes ? getSprite(selectedNft.attributes) : '/pangolin_sprite_gold.png';
    await supabase.from('race_room_players').upsert({
      room_id: targetRoom.id,
      wallet_address: walletAddress.toLowerCase(),
      nft_token_id: selectedNft?.id || selectedNft?.tokenId || '0',
      nft_name: selectedNft?.name || 'Pangolin',
      nft_sprite: sprite,
    });

    setStatusMsg(`Room ${targetRoom.room_code} — Waiting for players...`);
  }, [categoryInfo, walletAddress, selectedNft, prizePool]);

  useEffect(() => {
    joinOrCreateRoom();
  }, [joinOrCreateRoom]);

  // --- REALTIME SUBSCRIPTION ---
  useEffect(() => {
    if (!roomId) return;

    const playersChannel = supabase
      .channel(`room-players-${roomId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'race_room_players',
        filter: `room_id=eq.${roomId}`
      }, () => {
        // Refresh player list
        supabase.from('race_room_players').select('*').eq('room_id', roomId)
          .then(({ data }) => {
            if (data) setPlayers(data);
          });
      })
      .subscribe();

    const roomChannel = supabase
      .channel(`room-status-${roomId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'race_rooms',
        filter: `id=eq.${roomId}`
      }, (payload) => {
        const room = payload.new as any;
        if (room.status === 'starting' && room.seed) {
          seedRef.current = parseInt(room.seed, 16) || Date.now();
          setPhase('countdown');
          let c = 3;
          setCountdown(c);
          const interval = setInterval(() => {
            c--;
            setCountdown(c);
            if (c === 0) {
              clearInterval(interval);
              setPhase('running');
            }
          }, 1000);
        }
      })
      .subscribe();

    // Initial fetch
    supabase.from('race_room_players').select('*').eq('room_id', roomId)
      .then(({ data }) => { if (data) setPlayers(data); });

    return () => {
      supabase.removeChannel(playersChannel);
      supabase.removeChannel(roomChannel);
    };
  }, [roomId]);

  // --- AUTO-START when room is full ---
  useEffect(() => {
    if (!roomId || players.length < MAX_PLAYERS) return;
    setStatusMsg('Room full! Starting race...');

    // First player to detect full room triggers the start
    const seed = Date.now().toString(16);
    supabase.from('race_rooms').update({ status: 'starting', seed, started_at: new Date().toISOString() }).eq('id', roomId).eq('status', 'waiting')
      .then(({ error }) => {
        if (!error) {
          seedRef.current = parseInt(seed, 16);
          setPhase('countdown');
          let c = 3;
          setCountdown(c);
          const interval = setInterval(() => {
            c--;
            setCountdown(c);
            if (c === 0) { clearInterval(interval); setPhase('running'); }
          }, 1000);
        }
      });
  }, [players.length, roomId]);

  // --- BUILD RACERS when running starts ---
  useEffect(() => {
    if (phase !== 'running' || players.length === 0) return;

    const mySprite = selectedNft?.attributes ? getSprite(selectedNft.attributes) : '/pangolin_sprite_gold.png';
    const built: RacerState[] = players.map((p, i) => {
      const isMe = p.wallet_address === walletAddress.toLowerCase();
      const r = seededRand(seedRef.current, i);
      return {
        id: p.id,
        name: isMe ? (selectedNft?.name || 'You') : `Player ${i + 1}`,
        distance: 0,
        speed: 0,
        targetSpeed: 60 + r * 35,
        position: i + 1,
        sprite: isMe ? mySprite : (p.nft_sprite || '/pangolin_sprite.png'),
        avatar: isMe ? (selectedNft?.avatar || mySprite) : (p.nft_sprite || '/pangolin_sprite.png'),
        isPlayer: isMe,
        walletAddress: p.wallet_address,
      };
    });
    setRacers(built);
  }, [phase, players, walletAddress, selectedNft]);

  // --- SIMULATION ---
  useEffect(() => {
    if (phase !== 'running') return;
    let finished = false;

    const simulate = (time: number) => {
      if (finished) return;
      const delta = (time - lastTimeRef.current) / 1000;
      lastTimeRef.current = time;

      setRacers(prev => {
        let allDone = true;
        const updated = prev.map(r => {
          if (r.distance >= TOTAL_DISTANCE) return r;
          allDone = false;
          const newSpeed = r.speed + (r.targetSpeed - r.speed) * 0.04;
          const newDist = Math.min(TOTAL_DISTANCE, r.distance + newSpeed * delta);
          const ft = newDist >= TOTAL_DISTANCE && !r.finishTime ? time : r.finishTime;
          return { ...r, speed: newSpeed, distance: newDist, finishTime: ft };
        });

        const sorted = [...updated].sort((a, b) =>
          b.distance - a.distance || (a.finishTime || Infinity) - (b.finishTime || Infinity)
        );
        sorted.forEach((r, i) => { r.position = i + 1; });

        if (allDone && !finished) {
          finished = true;
          setPhase('finished');
          setPositions(sorted);
          const player = sorted.find(r => r.isPlayer);
          if (player) {
            const pos = player.position;
            const prize = pos === 1 ? prizePool * 0.5 : pos === 2 ? prizePool * 0.3 : pos === 3 ? prizePool * 0.2 : 0;
            setPlayerResult({ position: pos, prize });
            onFinished?.(pos, prize);
            // Record to DB
            supabase.from('race_room_players')
              .update({ position: pos, prize_earned: prize })
              .eq('room_id', roomId)
              .eq('wallet_address', walletAddress.toLowerCase());
            supabase.from('race_rooms').update({ status: 'finished', finished_at: new Date().toISOString() }).eq('id', roomId);
          }
        }
        return updated;
      });

      if (!finished) animFrameRef.current = requestAnimationFrame(simulate);
    };

    lastTimeRef.current = performance.now();
    animFrameRef.current = requestAnimationFrame(simulate);
    return () => { if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current); };
  }, [phase, prizePool, roomId, walletAddress]);

  // --- RENDER ---
  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0a0a1a 0%, #1a0a2e 100%)', paddingTop: '80px', fontFamily: 'Inter, sans-serif' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1.5rem 2rem', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
        <button onClick={onBack} style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: 'white', padding: '8px 18px', borderRadius: '8px', cursor: 'pointer' }}>
          ← Back
        </button>
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ margin: 0, color: '#00c8ff', fontSize: '1.4rem' }}>🌐 Online Race — {categoryInfo?.terrain} Track</h2>
          <p style={{ margin: 0, color: 'rgba(255,255,255,0.5)', fontSize: '0.85rem' }}>Room: {roomCode} | Prize Pool: {prizePool} $PANG</p>
        </div>
        <div style={{ width: '100px' }} />
      </div>

      {/* Waiting Phase */}
      {phase === 'waiting' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '3rem 2rem', gap: '2rem' }}>
          <div style={{ background: 'rgba(0,200,255,0.08)', border: '1px solid rgba(0,200,255,0.2)', borderRadius: '20px', padding: '2rem 3rem', maxWidth: '600px', width: '100%', textAlign: 'center' }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem', animation: 'pulse 1.5s infinite' }}>⏳</div>
            <h3 style={{ color: '#00c8ff', margin: '0 0 0.5rem' }}>{statusMsg}</h3>
            <p style={{ color: 'rgba(255,255,255,0.5)', margin: '0 0 2rem', fontSize: '0.9rem' }}>
              Race starts automatically when {MAX_PLAYERS} players are in the room.
            </p>

            {/* Players Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.75rem' }}>
              {Array.from({ length: MAX_PLAYERS }, (_, i) => {
                const p = players[i];
                const isMe = p?.wallet_address === walletAddress.toLowerCase();
                return (
                  <div key={i} style={{ aspectRatio: '1', background: p ? (isMe ? 'rgba(255,215,0,0.15)' : 'rgba(0,200,255,0.1)') : 'rgba(255,255,255,0.04)', border: `1px solid ${p ? (isMe ? 'rgba(255,215,0,0.5)' : 'rgba(0,200,255,0.3)') : 'rgba(255,255,255,0.1)'}`, borderRadius: '12px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0.5rem', minHeight: '80px' }}>
                    {p ? (
                      <>
                        <img src={p.nft_sprite || '/pangolin_sprite.png'} style={{ width: '36px', height: '36px', objectFit: 'contain' }} />
                        <div style={{ fontSize: '10px', color: isMe ? '#ffd700' : 'rgba(255,255,255,0.6)', marginTop: '4px', fontWeight: isMe ? 'bold' : 'normal' }}>
                          {isMe ? 'YOU' : `Player ${i + 1}`}
                        </div>
                      </>
                    ) : (
                      <div style={{ color: 'rgba(255,255,255,0.2)', fontSize: '1.5rem' }}>+</div>
                    )}
                  </div>
                );
              })}
            </div>
            <p style={{ color: 'rgba(255,255,255,0.4)', marginTop: '1.5rem', fontSize: '0.85rem' }}>
              {players.length}/{MAX_PLAYERS} players joined
            </p>
            <div style={{ width: '100%', height: '6px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', overflow: 'hidden', marginTop: '0.5rem' }}>
              <div style={{ height: '100%', width: `${(players.length / MAX_PLAYERS) * 100}%`, background: 'linear-gradient(90deg, #00c8ff, #0080ff)', transition: 'width 0.5s ease', borderRadius: '3px' }} />
            </div>
          </div>
        </div>
      )}

      {/* Countdown Phase */}
      {phase === 'countdown' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '70vh', gap: '2rem' }}>
          <div style={{ fontSize: '8rem', fontWeight: '900', color: '#00c8ff', animation: 'pulse 0.8s infinite' }}>{countdown || 'GO!'}</div>
          <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '1.2rem' }}>All players ready! Race starting in {countdown}...</p>
        </div>
      )}

      {/* Race & Finished Phase */}
      {(phase === 'running' || phase === 'finished') && (
        <div style={{ display: 'flex', gap: '1.5rem', padding: '1.5rem 2rem', height: 'calc(100vh - 150px)' }}>
          {/* Track */}
          <div style={{ flex: 1, position: 'relative', background: 'rgba(255,255,255,0.03)', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.1)', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', inset: '10px' }}>
              {/* Finish line */}
              <div style={{ position: 'absolute', top: '60px', left: 0, right: 0, height: '3px', background: 'repeating-linear-gradient(90deg, white 0 20px, black 20px 40px)', zIndex: 5 }}>
                <span style={{ position: 'absolute', right: '10px', top: '-22px', color: 'white', fontSize: '12px', fontWeight: 'bold' }}>🏁 FINISH</span>
              </div>
              {racers.map((racer, idx) => {
                const trackHeight = 700;
                const bottomOffset = 60 + (racer.distance / TOTAL_DISTANCE) * (trackHeight - 100);
                const leftPct = 5 + idx * (90 / Math.max(racers.length, 1));
                return (
                  <div key={racer.id} style={{ position: 'absolute', left: `${leftPct}%`, bottom: `${bottomOffset}px`, transition: 'bottom 0.05s linear', zIndex: racer.isPlayer ? 10 : 5 }}>
                    {racer.isPlayer && (
                      <div style={{ position: 'absolute', top: '-32px', left: '50%', transform: 'translateX(-50%)', background: 'rgba(255,215,0,0.9)', color: '#000', padding: '3px 8px', borderRadius: '10px', fontWeight: 'bold', fontSize: '12px', whiteSpace: 'nowrap', boxShadow: '0 0 12px rgba(255,215,0,0.8)' }}>
                        ▼ YOU
                      </div>
                    )}
                    <img src={racer.sprite} alt={racer.name} style={{ width: '52px', height: '52px', objectFit: 'contain', filter: racer.isPlayer ? 'drop-shadow(0 0 8px gold)' : undefined }} />
                    <div style={{ textAlign: 'center', color: racer.isPlayer ? '#ffd700' : 'rgba(255,255,255,0.5)', fontSize: '10px', marginTop: '2px', fontWeight: racer.isPlayer ? 'bold' : 'normal' }}>
                      {getPositionLabel(racer.position)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Standings */}
          <div style={{ width: '280px' }}>
            <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.1)', padding: '1.5rem' }}>
              <h3 style={{ margin: '0 0 1rem', color: '#00c8ff' }}>🌐 Live Standings</h3>
              {[...racers].sort((a, b) => a.position - b.position).map(r => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.07)', color: r.isPlayer ? '#ffd700' : 'white' }}>
                  <span style={{ width: '28px', fontWeight: 'bold' }}>{getPositionLabel(r.position)}</span>
                  <img src={r.sprite} style={{ width: '28px', height: '28px', objectFit: 'contain' }} />
                  <span style={{ flex: 1, fontSize: '0.85rem', fontWeight: r.isPlayer ? 'bold' : 'normal' }}>{r.name}</span>
                  <span style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.4)' }}>{Math.floor(r.distance / TOTAL_DISTANCE * 100)}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Finished Overlay */}
      {phase === 'finished' && playerResult && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: 'linear-gradient(135deg, #1a1a2e, #16213e)', border: '2px solid rgba(0,200,255,0.5)', borderRadius: '24px', padding: '3rem', textAlign: 'center', maxWidth: '450px', boxShadow: '0 0 60px rgba(0,200,255,0.2)' }}>
            <div style={{ fontSize: '5rem', marginBottom: '1rem' }}>
              {playerResult.position === 1 ? '🥇' : playerResult.position === 2 ? '🥈' : playerResult.position === 3 ? '🥉' : '🏁'}
            </div>
            <h2 style={{ color: '#00c8ff', fontSize: '2rem', margin: '0 0 0.5rem' }}>
              {playerResult.position === 1 ? 'CHAMPION!' : playerResult.position <= 3 ? 'PODIUM FINISH!' : 'Race Complete!'}
            </h2>
            <p style={{ color: 'rgba(255,255,255,0.7)', marginBottom: '1.5rem' }}>
              You finished <strong style={{ color: 'white' }}>#{playerResult.position}</strong> vs {racers.length} real players!
            </p>
            {playerResult.prize > 0 && (
              <div style={{ background: 'rgba(255,215,0,0.1)', border: '1px solid rgba(255,215,0,0.3)', borderRadius: '12px', padding: '1rem', marginBottom: '1.5rem' }}>
                <div style={{ color: '#ffd700', fontSize: '1.5rem', fontWeight: 'bold' }}>+{playerResult.prize} $PANG</div>
                <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.85rem', marginTop: '4px' }}>Prize earned!</div>
              </div>
            )}
            <div style={{ display: 'flex', gap: '1rem' }}>
              <button onClick={onBack} style={{ flex: 1, background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: 'white', padding: '12px', borderRadius: '10px', cursor: 'pointer' }}>
                Back to Lobby
              </button>
              <button onClick={() => window.location.reload()} style={{ flex: 1, background: 'linear-gradient(135deg, #00c8ff, #0080ff)', border: 'none', color: '#fff', padding: '12px', borderRadius: '10px', cursor: 'pointer', fontWeight: 'bold' }}>
                Play Again!
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
