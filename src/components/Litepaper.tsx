import React from 'react';

const Litepaper: React.FC = () => {
  return (
    <div className="litepaper-container">
      <div className="litepaper-header">
        <h1>Pangs Rally: The Vision</h1>
        <p className="litepaper-subtitle">A sustainable Web3 ecosystem powered by competitive racing, breeding, and strategic tokenomics.</p>
      </div>

      <div className="litepaper-content glass-panel">
        
        <div style={{ width: '100%', marginBottom: '40px', overflow: 'hidden', borderRadius: '16px', border: '2px solid rgba(255,126,39,0.3)', boxShadow: '0 0 25px rgba(255,126,39,0.15)' }}>
          <img src="/racersphoto.png" alt="Pangs Rally Racers" style={{ width: '100%', height: 'auto', display: 'block', objectFit: 'cover' }} />
        </div>

        <section className="lp-section">
          <h2>1. Introduction</h2>
          <p>
            Pangs Rally is an immersive racing ecosystem built on the Robinhood chain. 
            The foundation of our economy began with the successful launch of the <strong>$PANGS token</strong> on the Trenchor platform 
            (Contract: <code>0x3390d9C9ac5e05D1a6eeAa954808d2784302137c</code>). 
            Following this milestone, our exclusive <strong>Genesis Collection</strong>—2,222 unique Racing Pangolins—will be 
            available to mint directly on our website. These Genesis NFTs are your ultimate ticket to the Pangs Rally universe, 
            granting you access to races, rewards, and future breeding events.
          </p>
        </section>

        <div className="divider"></div>

        <section className="lp-section">
          <h2>2. Racing & Rooms</h2>
          
          <div className="lp-card">
            <h3>Daily Free Races</h3>
            <p>
              Every Genesis Pangolin is entitled to <strong>5 Free Races per day</strong>. During this phase, you can enter 
              the "Free Room" and compete to earn <strong>$PANGS</strong> tokens based on your finishing position. 
              This ensures every holder has a daily opportunity to build their wealth within the ecosystem.
            </p>
          </div>

          <div className="lp-card">
            <h3>Premium Racing (Locked)</h3>
            <p>
              As the ecosystem matures, higher-stakes racing rooms will unlock. These rooms will require a <strong>$PANGS entry fee</strong>. 
              The competitive edge: <strong>90% of the total collected entry fees</strong> are distributed amongst the winners. 
              The remaining 10% is routed to the ecosystem treasury to sustain long-term rewards, operations, and development.
            </p>
          </div>
        </section>

        <div className="divider"></div>

        <section className="lp-section">
          <h2>3. The $PANGS Tokenomics</h2>
          <p>
            The <strong>$PANGS</strong> token is the absolute core of our economy. 
            Since the successful Trenchor launch, any future ecosystem actions and minting will be conducted strictly using $PANGS tokens.
          </p>
          <ul className="lp-list">
            <li><strong>Burn Mechanism:</strong> 50% of the $PANGS revenue generated from NFT minting will be permanently burned, continually reducing the circulating supply.</li>
            <li><strong>Prize Pools:</strong> The remaining 50% of minting revenue is directly injected into the Racing Reward Pool to fuel daily free races and seasonal tournaments.</li>
          </ul>
        </section>

        <div className="divider"></div>

        <section className="lp-section">
          <h2>4. Breeding & Genetics (Coming Soon)</h2>
          <div style={{ display: 'flex', gap: '20px', marginBottom: '20px', alignItems: 'center' }}>
            <div style={{ width: '45%' }}>
              <img src="/nft-images/4.webp" alt="Pangolin Father" style={{width: '100%', borderRadius: '12px', background: 'var(--bg-dark)', border: '1px solid rgba(255,255,255,0.1)'}} />
            </div>
            <div style={{ fontSize: '2rem', color: 'var(--pangs-orange)', fontWeight: 'bold' }}>+</div>
            <div style={{ width: '45%' }}>
              <img src="/nft-images/5.webp" alt="Pangolin Mother" style={{width: '100%', borderRadius: '12px', background: 'var(--bg-dark)', border: '1px solid rgba(255,255,255,0.1)'}} />
            </div>
          </div>
          <p>
            The Laboratory will soon open its doors. Owners holding both Male and Female Pangolins will be able 
            to breed them to create an entirely new generation of <strong>Newborn Pangolins</strong>!
          </p>
          <ul className="lp-list">
            <li>Breeding will cost a designated amount of $PANGS.</li>
            <li>Each Genesis Pangolin has a strict maximum limit of <strong>7 breeding cycles</strong> to prevent overpopulation.</li>
            <li>Newborns will feature unique genetics, traits, and stats inherited from their parents, offering entirely new racing strategies.</li>
          </ul>
        </section>

        <div className="divider"></div>

        <section className="lp-section">
          <h2>5. Progression & Seasons</h2>
          
          <div className="lp-card">
            <h3>Leveling System</h3>
            <p>
              Your Pangolins aren't static. By participating in races and achieving podium finishes, your NFT will 
              gain experience. You can then pay a $PANGS fee to <strong>Level Up</strong> your Pangolin, permanently 
              enhancing its racing capabilities and unlocking higher-tier tracks.
            </p>
          </div>

          <div className="lp-card">
            <h3>Seasonal Tournaments & Leaderboards</h3>
            <p>
              Pangs Rally is highly competitive. Soon, the Global Leaderboard will go live. 
              Top racers dominating the tracks will receive massive airdrops of $PANGS and other exclusive rewards 
              at the end of each Racing Season.
            </p>
          </div>
        </section>

        <div className="divider"></div>

        <section className="lp-section">
          <h2>6. Multi-Tier Referral System</h2>
          <p>
            Growth is rewarded in the Pangs Rally ecosystem. Our on-chain multi-tier referral system allows players to 
            earn passive income by expanding the racing community.
          </p>
          <ul className="lp-list">
            <li><strong>Direct Referrals (Tier 1):</strong> Create a custom referral code. When a new player uses your code to breed or spend $PANGS in the ecosystem, you receive a direct percentage cut of their fees instantly.</li>
            <li><strong>Secondary Referrals (Tier 2):</strong> If the players you invited go on to invite others, you also earn a secondary commission from this extended network's activity, creating a sustainable loop of passive yield.</li>
          </ul>
        </section>

        <div className="litepaper-footer">
          <p>Welcome to the ultimate Web3 racing ecosystem.</p>
        </div>

      </div>
    </div>
  );
};

export default Litepaper;
