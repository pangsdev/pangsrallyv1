import { useState } from 'react';
import type { PlayerStatus } from '../testSeason/api';
import './lobby.css';
import { POINTS_BY_POSITION, shortWallet, testTokenFor } from '../race/testSeason';

interface Props {
  categoryInfo: any;
  player: PlayerStatus;
  onSelectMode: (mode: 'bot' | 'online') => void;
  onBack: () => void;
}

export default function RaceLobby({ categoryInfo, player, onSelectMode, onBack }: Props) {
  const [hovered, setHovered] = useState<'bot' | 'online' | null>(null);
  const canRace = player.unlimited || player.racesLeft > 0;
  const tokenId = testTokenFor(player.wallet);
  const resets = new Date(player.resetsAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  const card = (mode: 'bot' | 'online', accent: string) => ({
    background: hovered === mode ? `${accent}14` : 'rgba(255,255,255,0.04)',
    border: `2px solid ${hovered === mode && canRace ? `${accent}99` : 'rgba(255,255,255,0.1)'}`,
    borderRadius: '20px',
    padding: '2rem 1.5rem',
    cursor: canRace ? 'pointer' : 'not-allowed',
    transition: 'all 0.3s',
    textAlign: 'center' as const,
    opacity: canRace ? 1 : 0.4,
    transform: hovered === mode && canRace ? 'translateY(-4px)' : 'none',
  });
  const chip = (color: string) => ({ background: `${color}1a`, color, padding: '4px 12px', borderRadius: '20px', fontSize: '0.8rem' });

  return (
    <div className="lobby-root">
      <div style={{ padding: '0 1.25rem 1rem' }}>
        <button onClick={onBack} className="lobby-back">Back to Tracks</button>
      </div>

      <div className="lobby-inner">
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{ fontSize: '2.2rem', marginBottom: '0.5rem' }}>{categoryInfo?.icon} {categoryInfo?.terrain} Track</div>
          <h2 style={{ margin: 0, color: 'white', fontSize: '1.8rem' }}>{categoryInfo?.name} · Test Season</h2>
          <div className={`lobby-pill ${canRace ? 'ok' : 'out'}`}>
            {player.unlimited
              ? '🏁 Unlimited races (tester)'
              : canRace
                ? `🏁 ${player.racesLeft} of ${player.dailyLimit} races left today`
                : `🚫 Daily limit reached · new races at ${resets}`}
          </div>
        </div>

        <div className="lobby-me">
          <img src={`/nft-images/${tokenId}.webp`} alt="" onError={(e) => { (e.target as HTMLImageElement).src = '/unrevealed-pangolin.png'; }} />
          <div style={{ minWidth: 0 }}>
            <div className="lobby-me-title">Your test pangolin</div>
            <div className="lobby-me-wallet">{shortWallet(player.wallet)}</div>
            <div className="lobby-me-stats">
              <span><strong>{player.points}</strong> pts</span>
              <span><strong>{player.wins}</strong> wins</span>
              <span>Rank <strong>{player.rank ?? '—'}</strong></span>
            </div>
          </div>
        </div>

        <p className="lobby-rules">
          During the test season every pangolin races on <strong>equal stats</strong>, so luck decides: each racer has a 1-in-10 shot.
          Every finish scores season points: <strong>{POINTS_BY_POSITION.slice(0, 3).join(' / ')}</strong> for the podium, down to {POINTS_BY_POSITION[POINTS_BY_POSITION.length - 1]} for 10th.
        </p>

        <div className="lobby-modes">
          <div
            onClick={() => canRace && onSelectMode('bot')}
            onMouseEnter={() => setHovered('bot')}
            onMouseLeave={() => setHovered(null)}
            style={card('bot', '#ffd700')}
          >
            <div style={{ fontSize: '3rem', marginBottom: '0.75rem' }}>🤖</div>
            <h3 style={{ color: '#ffd700', margin: '0 0 0.6rem', fontSize: '1.35rem' }}>Bot Race</h3>
            <p style={{ color: 'rgba(255,255,255,0.6)', margin: '0 0 1.25rem', fontSize: '0.9rem', lineHeight: 1.6 }}>
              Race 9 bots right now.<br />No waiting.
            </p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
              <span style={chip('#ffd700')}>Instant</span>
              <span style={chip('#00ff64')}>9 Bots</span>
              <span style={chip('#ffd700')}>Up to {POINTS_BY_POSITION[0]} pts</span>
            </div>
            <div className="lobby-cta" style={{ background: 'linear-gradient(135deg, #ffd700, #ff8c00)', color: '#000' }}>
              {canRace ? 'Race Now' : 'Limit Reached'}
            </div>
          </div>

          <div
            onClick={() => canRace && onSelectMode('online')}
            onMouseEnter={() => setHovered('online')}
            onMouseLeave={() => setHovered(null)}
            style={card('online', '#00c8ff')}
          >
            <div style={{ fontSize: '3rem', marginBottom: '0.75rem' }}>🌐</div>
            <h3 style={{ color: '#00c8ff', margin: '0 0 0.6rem', fontSize: '1.35rem' }}>Online Race</h3>
            <p style={{ color: 'rgba(255,255,255,0.6)', margin: '0 0 1.25rem', fontSize: '0.9rem', lineHeight: 1.6 }}>
              Race other players. The room starts within a minute;<br />empty lanes get bots.
            </p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
              <span style={chip('#00c8ff')}>Real Players</span>
              <span style={chip('#00c8ff')}>Up to 10</span>
              <span style={chip('#ffd700')}>Up to {POINTS_BY_POSITION[0]} pts</span>
            </div>
            <div className="lobby-cta" style={{ background: 'linear-gradient(135deg, #00c8ff, #0080ff)', color: '#fff' }}>
              {canRace ? 'Find Match' : 'Limit Reached'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
