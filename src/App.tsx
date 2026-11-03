import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { ethers } from 'ethers';
import PangsRallyContract from './PangsRally.json';
import rarityData from './rarity-data.json';
import seedrandom from 'seedrandom';
import { MARKETPLACE_ADDRESS, MARKETPLACE_ABI, RACING_ADDRESS, RACING_ABI } from './contracts';
import { supabase as _supabase, createRace, joinRaceDB, finishRace, markPrizeClaimed } from './supabaseClient';
import { unlockAnnounce } from './race/announce';
import './App.css'
import RaceLobby from './components/RaceLobby';
import OnlineRooms from './components/OnlineRooms';
import Profile, { BetaInventory } from './components/Profile';
import Landing from './components/Landing';
import { SeasonLeaderboard, SignInGate, NoWalletModal, InviteCodeModal, BetaMintModal } from './components/SeasonPages';
import { clearSession, getSession, hasWallet, mintBetaPass, signInWithWallet, testSeason, type PlayerStatus } from './testSeason/api';
import { shortWallet } from './race/testSeason';

// Heavy, rarely-visited views are split out of the initial bundle (the race rooms pull in PixiJS).
const Litepaper = lazy(() => import('./components/Litepaper'));
const RaceRoom = lazy(() => import('./components/RaceRoom'));
const OnlineRoom = lazy(() => import('./components/OnlineRoom'));

const ViewLoader = () => (
  <div style={{ minHeight: '60vh', display: 'grid', placeItems: 'center', paddingTop: '120px', color: 'var(--text-secondary, #888)' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ width: 22, height: 22, borderRadius: '50%', border: '3px solid rgba(128,128,128,0.25)', borderTopColor: '#ffd700', animation: 'spin 0.9s linear infinite' }} />
      Loading…
    </div>
  </div>
);

import PangsRallyBetaPassContract from './PangsRallyBetaPass.json';
import { LockIcon, TrackBadge } from './components/Icons';

const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS || "0xf5DaFf515ECfc3928b24367b8A70B5505d89296f";
const BETA_PASS_CONTRACT_ADDRESS = import.meta.env.VITE_BETA_PASS_CONTRACT_ADDRESS || "0x55C18bfaC6A791C88800375C61Aa3B67766Ab288";

const TransparentImage = ({ src, alt, className }: { src: string, alt: string, className?: string }) => {
  let finalSrc = src;
  if (src.startsWith('ipfs://')) {
      finalSrc = src.replace('ipfs://', 'https://ipfs.io/ipfs/');
  } else if (!src.startsWith('http') && !src.startsWith('/')) {
      finalSrc = `/${src}`;
  }
  return <img src={finalSrc} alt={alt} className={className} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />;
};

// Custom Toast Component
const Toast = ({ message, type, onClose }: { message: string, type: 'success' | 'error' | 'info', onClose: () => void }) => {
  // App re-renders constantly and passes a fresh onClose each time; keep the latest in a ref so the timer is set once.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const timer = setTimeout(() => onCloseRef.current(), type === 'error' ? 6000 : 3500);
    return () => clearTimeout(timer);
  }, [type]);

  const bgColor = type === 'success' ? 'linear-gradient(135deg, #00ff88, #00cc6a)' : type === 'error' ? 'linear-gradient(135deg, #ff4466, #cc0033)' : 'linear-gradient(135deg, #6c5ce7, #a29bfe)';
  return (
    <div style={{background: bgColor, color: 'white', padding: '0.8rem 1.2rem', borderRadius: '12px', boxShadow: '0 8px 32px rgba(0,0,0,0.3)', maxWidth: 'min(400px, calc(100vw - 40px))', animation: 'slideInRight 0.3s ease', display: 'flex', alignItems: 'center', gap: '12px', backdropFilter: 'blur(10px)', pointerEvents: 'auto'}}>
      <span style={{fontSize: '1.2rem'}}>{type === 'success' ? '✅' : type === 'error' ? '❌' : '🔔'}</span>
      <span style={{flex: 1, fontSize: '0.95rem', fontWeight: 500}}>{message}</span>
      <button onClick={onClose} style={{background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white', width: '24px', height: '24px', borderRadius: '50%', cursor: 'pointer', fontSize: '12px'}}>✕</button>
    </div>
  );
};

// Map body types to their dedicated sprite sheet files
const BODY_SPRITES: { [key: string]: string } = {
  "Red": "/pangolin_sprite_red.png",
  "Rainbow": "/pangolin_sprite_rainbow.png",
  "Brown": "/pangolin_sprite.png",
  "Blue": "/pangolin_sprite_blue.png",
  "Black": "/pangolin_sprite_black.png",
  "Silver": "/pangolin_sprite_silver.png",
  "Albino": "/pangolin_sprite_albino.png",
  "Gold": "/pangolin_sprite_gold.png"
};

const getBodySpriteFromAttributes = (attributes: any[]): string => {
  if (!attributes) return "/pangolin_sprite.png";
  const bodyAttr = attributes.find((a: any) => a.trait_type === 'Body');
  if (bodyAttr && BODY_SPRITES[bodyAttr.value]) {
    return BODY_SPRITES[bodyAttr.value];
  }
  return "/pangolin_sprite.png";
};

const getRarityFromAttributes = (attributes: any[]) => {
  const rarityAttr = attributes.find((a: any) => a.trait_type === 'Rarity');
  return rarityAttr ? rarityAttr.value : 'Common';
};


const fetchBotBodyColor = async (botId: number): Promise<string> => {
  try {
    const res = await fetch(`/metadata/${botId}.json`);
    if (!res.ok) return "/pangolin_sprite.png";
    const text = await res.text();
    if (!text.startsWith('{')) return "/pangolin_sprite.png";
    const json = JSON.parse(text);
    return getBodySpriteFromAttributes(json.attributes);
  } catch (err) {
    // If backend is not running, return a deterministic color based on botId instead of always brown
    const fallbackSprites = [
      "/pangolin_sprite_red.png",
      "/pangolin_sprite_rainbow.png",
      "/pangolin_sprite_blue.png",
      "/pangolin_sprite_black.png",
      "/pangolin_sprite_silver.png",
      "/pangolin_sprite_gold.png",
      "/pangolin_sprite.png"
    ];
    return fallbackSprites[botId % fallbackSprites.length];
  }
};

function App() {
  const [walletConnected, setWalletConnected] = useState(false);
  const [walletAddress, setWalletAddress] = useState('');
  const [_fullWalletAddress, setFullWalletAddress] = useState('');
  const [myNFTs, setMyNFTs] = useState<any[]>([]);
  const [isFetchingNFTs, setIsFetchingNFTs] = useState<boolean>(false);
  const [toasts, setToasts] = useState<{id: number, message: string, type: 'success' | 'error' | 'info'}[]>([]);
  const [renameModal, setRenameModal] = useState<{tokenId: string, currentName: string} | null>(null);
  const [expandedImage, setExpandedImage] = useState<string | null>(null);
  const [selectedNFTDetails, setSelectedNFTDetails] = useState<any | null>(null);
  const [renameInput, setRenameInput] = useState('');
  const [currentView, setCurrentView] = useState<'landing' | 'how-to-play' | 'laboratory' | 'rally' | 'race-lobby' | 'bot-race' | 'online-rooms' | 'online-race' | 'room-browser' | 'race-room' | 'live-race' | 'inventory' | 'marketplace' | 'leaderboard' | 'my-races' | 'referral' | 'replay'>('landing');

  const [parentA, setParentA] = useState<any>(null);
  const [parentB, setParentB] = useState<any>(null);
  const [isIncubating, setIsIncubating] = useState(false);
  
  // Real Breeding State
  const [incubationEndTime, setIncubationEndTime] = useState<number | null>(() => {
    const saved = localStorage.getItem('breedingTimerEnds');
    return saved ? parseInt(saved) : null;
  });
  const [timeRemaining, setTimeRemaining] = useState<string>('');
  const [isHatchReady, setIsHatchReady] = useState(false);
  const [isMintingBaby, setIsMintingBaby] = useState(false);
  
  const [newOffspring, setNewOffspring] = useState<any>(null);
  const [isSelectingParent, setIsSelectingParent] = useState<'A' | 'B' | null>(null);

  // Live Race State
  const [activeCategoryInfo, setActiveCategoryInfo] = useState<any>(null); // Selected from Rally Lobby
  const [isSelectingRaceNft, setIsSelectingRaceNft] = useState<boolean>(false);
  const [selectedRacingNft, setSelectedRacingNft] = useState<any>(null);

  // Supabase state
  const [currentRaceDbId, setCurrentRaceDbId] = useState<string | null>(null);

  /* ---------- Test season: wallet sign-in, daily races, points (server-side) ---------- */
  const [player, setPlayer] = useState<PlayerStatus | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [noWalletHelp, setNoWalletHelp] = useState(false);
  /** bumps to start a fresh bot race ("Race Again") */
  const [raceKey, setRaceKey] = useState(0);
  /** online room to resume from My Races (null → join a new one) */
  const [onlineRaceId, setOnlineRaceId] = useState<string | null>(null);
  const [replayRaceId, setReplayRaceId] = useState<string | null>(null);

  const applyPlayer = (status: PlayerStatus) => {
    const { wallet, username, racesToday, dailyLimit, racesLeft, unlimited, points, races, wins, podiums, rank, resetsAt, beta } = status;
    setPlayer({ wallet, username: username ?? null, racesToday, dailyLimit, racesLeft, unlimited, points, races, wins, podiums, rank, resetsAt, beta });
    setWalletConnected(true);
    setFullWalletAddress(wallet);
    setWalletAddress(shortWallet(wallet));
  };

  const signOut = () => {
    clearSession();
    setPlayer(null);
    setWalletConnected(false);
    setWalletAddress('');
    setFullWalletAddress('');
    setMyNFTs([]);
    setUserReferralCode('');
  };

  const refreshPlayer = () => {
    if (!getSession()) return;
    testSeason.me().then(applyPlayer).catch((e) => { if (e?.status === 401) signOut(); });
  };

  /** Connect + sign the free sign-in message. Resolves to the signed-in player, or null. */
  // Open while the sign-in waits for an invite code; resolve(null) cancels.
  const [inviteAsk, setInviteAsk] = useState<{ error: string; resolve: (code: string | null) => void } | null>(null);
  const askInvite = (error: string) => new Promise<string | null>(resolve => setInviteAsk({ error, resolve }));

  const [betaOpen, setBetaOpen] = useState(false);
  const needsBeta = (p: PlayerStatus | null) => !!p && p.beta?.required && !p.beta.minted;
  const mintBeta = async (onStep: Parameters<typeof mintBetaPass>[0]) => {
    try {
      const status = await mintBetaPass(onStep);
      applyPlayer(status);
      showToast('Beta pass minted. Welcome to the starting line!', 'success');
      setTimeout(() => setBetaOpen(false), 900);
      return true;
    } catch (e: any) {
      showToast(e?.message || 'The mint did not go through. Please try again.', 'error');
      return false;
    }
  };

  const signIn = async (): Promise<PlayerStatus | null> => {
    if (player) return player;
    if (!hasWallet()) {
      setNoWalletHelp(true);
      return null;
    }
    setSigningIn(true);
    try {
      const status = await signInWithWallet(askInvite);
      applyPlayer(status);
      showToast('Wallet connected. Welcome to the Beta season!', 'success');
      if (needsBeta(status)) setBetaOpen(true);
      return status;
    } catch (e: any) {
      showToast(e?.message || 'Wallet connection failed. Please try again.', 'error');
      return null;
    } finally {
      setSigningIn(false);
    }
  };

  const joinTestSeason = async () => {
    if (await signIn()) setCurrentView('rally');
  };
  
  // Inventory & Marketplace State
  const [inventoryFilter, setInventoryFilter] = useState('All');
  const [playerBalance, setPlayerBalance] = useState('0.00');
  const [marketListings, setMarketListings] = useState<any[]>([]);
  const [isProcessingBuy, setIsProcessingBuy] = useState(false);
  const [buySuccess, setBuySuccess] = useState<any>(null);
  const [registrationSuccess, setRegistrationSuccess] = useState<any>(null);

  // Referral State
  const [directRefs, setDirectRefs] = useState('0');
  const [secondaryRefs, setSecondaryRefs] = useState('0');
  const [claimableComms, setClaimableComms] = useState('0.00');
  const [userReferralCode, setUserReferralCode] = useState('');
  const [createCodeInput, setCreateCodeInput] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('ref');
    if (ref) {
      localStorage.setItem('pangsrally_referrer', ref);
    }
  }, []);

  const [isReplayMode, setIsReplayMode] = useState(false);

  const [activeRaceInfo, setActiveRaceInfo] = useState<any>(null); // Specific room joined
  const prngRef = useRef<any>(null);
  const [racers, setRacers] = useState<any[]>([]);
  const [raceStatus, setRaceStatus] = useState<'waiting' | 'running' | 'finished'>('waiting');
  const [hasPlayerJoined, setHasPlayerJoined] = useState(false); // Matchmaking state
  
  // Camera & Track state
  const [cameraProgress, setCameraProgress] = useState(0); 
  const TOTAL_DISTANCE = 3000; // Increased distance for longer spread

  const fetchMarketplaceListings = async () => {
    if (!(window as any).ethereum) return;
    try {
      const provider = new ethers.BrowserProvider((window as any).ethereum);
      const marketContract = new ethers.Contract(MARKETPLACE_ADDRESS, MARKETPLACE_ABI, provider);
      const active = await marketContract.getActiveListings();
      
      const formattedListings = [];
      for (const listing of active) {
        if (!listing.active) continue;
        const tokenId = Number(listing.tokenId);
        const priceEth = ethers.formatEther(listing.price);
        
        let name = `Pangs Rally #${tokenId}`;
        let rarity = 'Common';
        let trait = 'Pangolin';
        let speed = Math.floor(Math.random() * 50) + 50;
        let acceleration = Math.floor(Math.random() * 50) + 50;
        let endurance = Math.floor(Math.random() * 50) + 50;
        
        try {
          const res = await fetch(`/metadata/${tokenId}.json`);
          const json = await res.json();
          name = json.name || name;
          rarity = getRarityFromAttributes(json.attributes);
        } catch(e) {}
        
        formattedListings.push({
          id: `#${tokenId}`,
          tokenId: tokenId,
          name,
          rarity,
          level: 1,
          avatar: `nft-images/${tokenId}.webp`,
          trait,
          speed,
          acceleration,
          endurance,
          price: priceEth,
          seller: listing.seller
        });
      }
      setMarketListings(formattedListings);
    } catch(e) {
      console.error("Error fetching market:", e);
    }
  };

  const fetchPlayerBalance = async () => {
    if (walletAddress && (window as any).ethereum) {
      try {
        const provider = new ethers.BrowserProvider((window as any).ethereum);
        const accounts = await provider.send('eth_accounts', []);
        if (accounts.length > 0) {
          const balanceWei = await provider.getBalance(accounts[0]);
          setPlayerBalance(Number(ethers.formatEther(balanceWei)).toFixed(4));
          
          {
            // Fetch Referral Stats ($PANG has not launched yet, so there is no token balance to read)
            try {
              const pRallyContract = new ethers.Contract(CONTRACT_ADDRESS, PangsRallyContract.abi, provider);
              const dRefs = await pRallyContract.directReferralsCount(accounts[0]);
              const sRefs = await pRallyContract.secondaryReferralsCount(accounts[0]);
              const comms = await pRallyContract.claimableCommissions(accounts[0]);
              const myCode = await pRallyContract.addressToCode(accounts[0]);
              
              setDirectRefs(dRefs.toString());
              setSecondaryRefs(sRefs.toString());
              setClaimableComms(ethers.formatEther(comms));
              setUserReferralCode(myCode || '');
            } catch (err) {
              console.error("Failed to fetch Referral stats (contract might not be updated yet)", err);
            }
            
          }
        }
      } catch(e) { console.error(e); }
    }
  };

  useEffect(() => {
    if (walletAddress) {
      fetchMarketplaceListings();
      fetchPlayerBalance();
    }
  }, [walletAddress]);

  const [isListing, setIsListing] = useState(false);
  const [listPrice, setListPrice] = useState('0.1');

  const handleListNFT = async (tokenId: number, priceStr: string) => {
    if (!(window as any).ethereum) return;
    setIsListing(true);
    try {
      const provider = new ethers.BrowserProvider((window as any).ethereum);
      const signer = await provider.getSigner();
      
      const nftContract = new ethers.Contract(CONTRACT_ADDRESS, [
        "function isApprovedForAll(address owner, address operator) view returns (bool)",
        "function setApprovalForAll(address operator, bool approved)"
      ], signer);
      
      const isApproved = await nftContract.isApprovedForAll(signer.address, MARKETPLACE_ADDRESS);
      if (!isApproved) {
        showToast("Approving Marketplace...", "info");
        const txApprove = await nftContract.setApprovalForAll(MARKETPLACE_ADDRESS, true);
        await txApprove.wait();
      }
      
      showToast("Listing on Marketplace...", "info");
      const marketContract = new ethers.Contract(MARKETPLACE_ADDRESS, MARKETPLACE_ABI, signer);
      const priceWei = ethers.parseEther(priceStr);
      const tx = await marketContract.listPangolin(tokenId, priceWei);
      await tx.wait();
      
      showToast("Successfully listed!", "success");
      fetchMarketplaceListings();
      setSelectedNFTDetails(null);
    } catch(e: any) {
      console.error(e);
      showToast(e.reason || "Listing failed", "error");
    }
    setIsListing(false);
  };

  const handleCancelListing = async (tokenId: number) => {
    if (!(window as any).ethereum) return;
    setIsListing(true);
    try {
      const provider = new ethers.BrowserProvider((window as any).ethereum);
      const signer = await provider.getSigner();
      
      const marketContract = new ethers.Contract(MARKETPLACE_ADDRESS, MARKETPLACE_ABI, signer);
      const tx = await marketContract.cancelListing(tokenId);
      await tx.wait();
      
      showToast("Listing canceled!", "success");
      fetchMarketplaceListings();
      setSelectedNFTDetails(null);
    } catch(e: any) {
      console.error(e);
      showToast(e.reason || "Cancel failed", "error");
    }
    setIsListing(false);
  };

  const handleBuyNFT = async (nft: any) => {
    if (!(window as any).ethereum) return;
    setIsProcessingBuy(true);
    try {
      const provider = new ethers.BrowserProvider((window as any).ethereum);
      const signer = await provider.getSigner();
      const marketContract = new ethers.Contract(MARKETPLACE_ADDRESS, MARKETPLACE_ABI, signer);
      
      const priceWei = ethers.parseEther(nft.price);
      const tx = await marketContract.buyPangolin(nft.tokenId, { value: priceWei });
      await tx.wait();
      
      setBuySuccess(nft);
      setMarketListings(prev => prev.filter(item => item.id !== nft.id));
      fetchPlayerBalance();
      fetchMyNFTs(signer.address); // Refresh inventory
      showToast("NFT purchased successfully!", "success");
    } catch(e: any) {
      console.error(e);
      showToast(e.reason || "Transaction failed", "error");
    }
    setIsProcessingBuy(false);
  };

  // Keep points / races left fresh when moving between the season pages.
  useEffect(() => {
    if (['rally', 'race-lobby', 'leaderboard', 'my-races'].includes(currentView)) refreshPlayer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentView]);

  // Restore the test-season session on page load; drop it if the wallet switches account.
  useEffect(() => {
    refreshPlayer();
    const eth = (window as any).ethereum;
    if (!eth?.on) return;
    const onAccounts = (accounts: string[]) => {
      const session = getSession();
      if (session && accounts[0]?.toLowerCase() !== session.wallet) signOut();
    };
    eth.on('accountsChanged', onAccounts);
    return () => eth.removeListener?.('accountsChanged', onAccounts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showToast = (message: string, type: 'success'|'error'|'info' = 'info') => {
    const id = Date.now() + Math.random();
    // Replace an identical message instead of stacking it, and keep at most 3 on screen.
    setToasts(prev => [...prev.filter(t => t.message !== message), { id, message, type }].slice(-3));
  };

  const removeToast = (id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  const fetchMyNFTs = async (address: string) => {
    setIsFetchingNFTs(true);
    try {
      const provider = new ethers.BrowserProvider((window as any).ethereum);
      
      // Fetch from Beta Pass Contract
      const betaNftContract = new ethers.Contract(BETA_PASS_CONTRACT_ADDRESS, PangsRallyBetaPassContract.abi, provider);
      
      let betaTokenIds: string[] = [];
      try {
        const _betaTokens = await betaNftContract.tokensOfOwner(address); // fixed: use address param not stale state
        betaTokenIds = _betaTokens.map((t: any) => t.toString());
      } catch (e) {
        console.warn("Beta pass fetch failed, might not be deployed yet", e);
      }
      
      const loadedBetaNFTs = await Promise.all(betaTokenIds.map(async (tokenId) => {
        try {
          const uri = await betaNftContract.tokenURI(tokenId);
          let metadata: any = null;

          if (uri.startsWith('data:application/json;base64,')) {
            const jsonString = atob(uri.split(',')[1]);
            metadata = JSON.parse(jsonString);
          } else if (uri.startsWith('http')) {
            const res = await fetch(uri);
            metadata = await res.json();
          }

          if (!metadata) return null;

          // Use the on-chain image URL (Pinata), with local file as fallback
          const imageUrl = metadata.image || '/beta-pass-nft.png';

          return {
            id: `beta-${tokenId}`,
            tokenId: tokenId,
            name: `Pangs Rally Beta Pass #${tokenId}`,
            image: imageUrl,
            avatar: imageUrl,
            sprite: '/pangolin_sprite_gold.png',  // Gold pangolin in races
            attributes: metadata.attributes || [],
            level: 1,
            rarity: 'Beta',
            isBeta: true
          };
        } catch (e) {
          console.warn(`Failed to load beta token ${tokenId}`, e);
          return null;
        }
      }));

      // Fetch from Genesis Contract
      const contract = new ethers.Contract(CONTRACT_ADDRESS, PangsRallyContract.abi, provider);
      
      const tokens = await contract.tokensOfOwner(address);
      const nfts = [];
      
      for(let i=0; i<tokens.length; i++) {
        const tokenId = tokens[i];
        const tokenIdStr = tokenId.toString();
        
        try {
          const uri = await contract.tokenURI(tokenId);
          let metadata: any = { name: `Pangs Rally #${tokenIdStr}`, image: ``, attributes: [] };

          if (uri.startsWith('data:application/json;base64,')) {
            const jsonString = atob(uri.split(',')[1]);
            metadata = JSON.parse(jsonString);
          } else {
            // It's revealed, try to fetch local metadata
            try {
              const res = await fetch(`/metadata/${tokenIdStr}.json`);
              if (res.ok) metadata = await res.json();
            } catch(e) { /* ignore */ }
          }
          
          const getTrait = (name: string) => metadata.attributes?.find((a: any) => a.trait_type === name)?.value || null;
          
          let onChainName = "";
          try {
              onChainName = await contract.pangolinNames(tokenId);
          } catch(e) { console.error("pangolinNames RPC Error:", e); }
          
          let bCount = 0n;
          try {
              bCount = await contract.breedCount(tokenId);
          } catch(e) { console.error("breedCount RPC Error:", e); }
          
          let imageUrl = metadata.image;
          if (imageUrl && imageUrl.startsWith('ipfs://')) {
              imageUrl = imageUrl.replace('ipfs://', 'https://gateway.pinata.cloud/ipfs/');
          } else if (!imageUrl || !imageUrl.startsWith('http')) {
              imageUrl = imageUrl || `nft-images/${tokenIdStr}.png`;
              if (imageUrl.startsWith('/')) {
                 // it's an absolute local path like /unrevealed-pangolin.png, leave it
              }
          }
          
          // Get rarity data
          const rarityInfo = (rarityData.nftRarities as any)[tokenIdStr];
          
          nfts.push({
             id: `#${tokenIdStr}`,
             tokenId: tokenIdStr,
             name: (onChainName && onChainName.trim() !== "") ? onChainName : metadata.name,
             image: imageUrl,
             avatar: imageUrl,
             traits: metadata.attributes || [],
             attributes: metadata.attributes || [],
             trait: getTrait('Weather Adaptation') || 'Normal',
             rarity: rarityInfo ? rarityInfo.tier : 'Common',
             purity: 100,
             speed: getTrait('Speed') || 50,
             acceleration: getTrait('Burst Power') || 50,
             endurance: getTrait('Endurance') || 50,
             level: 1,
             bodyColor: getTrait('Body') || 'Default',
             breedCount: Number(bCount),
             isBeta: false
          });
        } catch (fetchErr) {
          console.error("Critical error building token object for", tokenId, fetchErr);
        }
      }
      setMyNFTs([...loadedBetaNFTs.filter(Boolean), ...nfts]);
    } catch (err: any) {
      console.error(err);
      showToast(err.message || 'Mint failed.', 'error');
    } finally {
      setIsFetchingNFTs(false);
    }
  };

  // Breeding Timer Logic
  useEffect(() => {
    let interval: any;
    if (incubationEndTime) {
      interval = setInterval(() => {
        const now = Date.now();
        const diff = incubationEndTime - now;

        if (diff <= 0) {
          clearInterval(interval);
          setTimeRemaining('00:00');
          setIsHatchReady(true);
          setIsIncubating(false);
        } else {
          const minutes = Math.floor(diff / 60000);
          const seconds = Math.floor((diff % 60000) / 1000);
          setTimeRemaining(`${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`);
          setIsHatchReady(false);
          setIsIncubating(true);
        }
      }, 1000);
    } else {
      setIsIncubating(false);
      setIsHatchReady(false);
    }

    return () => clearInterval(interval);
  }, [incubationEndTime]);

  const handleRename = async (tokenId: string, currentName: string) => {
    setRenameModal({ tokenId, currentName });
    setRenameInput('');
  };

  const submitRename = async () => {
    if (!renameModal) return;
    const newName = renameInput.trim();
    if (!newName) return;
    if (newName.length > 25) {
      showToast('Name is too long! Max 25 characters.', 'error');
      return;
    }
    
    try {
      const provider = new ethers.BrowserProvider((window as any).ethereum);
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(CONTRACT_ADDRESS, PangsRallyContract.abi, signer);
      
      const tx = await contract.setName(renameModal.tokenId, newName);
      showToast('Rename transaction submitted! Waiting for confirmation...', 'info');
      setRenameModal(null);
      await tx.wait();
      
      showToast('Pangolin successfully renamed!', 'success');
      fetchMyNFTs(await signer.getAddress());
    } catch (e) {
      console.error(e);
      showToast('Rename failed. Check console for details.', 'error');
      setRenameModal(null);
    }
  };

  // The fixed header grows on phones (wallet + nav wrap onto extra rows); publish its real
  // height as --header-h so page tops can clear it instead of guessing a padding.
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const publish = () => document.documentElement.style.setProperty('--header-h', `${Math.ceil(el.getBoundingClientRect().height)}px`);
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** Header button: test-season sign-in (MetaMask connect + a free signature). */
  const connectWallet = async () => {
    await signIn();
  };

  const handleCreateReferralCode = async () => {
    if (!createCodeInput) return;
    try {
      const provider = new ethers.BrowserProvider((window as any).ethereum);
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(CONTRACT_ADDRESS, PangsRallyContract.abi, signer);
      showToast('Creating referral code...', 'info');
      const tx = await contract.registerReferralCode(createCodeInput);
      await tx.wait();
      setUserReferralCode(createCodeInput);
      showToast('Referral code created successfully!', 'success');
    } catch (err: any) {
      console.error(err);
      showToast(err.reason || 'Failed to create code. It might be taken.', 'error');
    }
  };

  const handleClaimCommissions = async () => {
    if (!walletConnected) {
      showToast('Please connect your wallet first!', 'error');
      return;
    }
    try {
      const provider = new ethers.BrowserProvider((window as any).ethereum);
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(CONTRACT_ADDRESS, PangsRallyContract.abi, signer);
      const tx = await contract.claimCommissions();
      showToast('Claiming commissions...', 'info');
      await tx.wait();
      showToast('Commissions claimed successfully! 💰', 'success');
      fetchPlayerBalance();
    } catch (err: any) {
      console.error(err);
      showToast('Claim failed: ' + (err.reason || err.message), 'error');
    }
  };

  const activeInventory = walletConnected ? myNFTs : [];

  const filteredInventory = inventoryFilter === 'All' 
    ? activeInventory 
    : activeInventory.filter(nft => nft.rarity === inventoryFilter || nft.trait === inventoryFilter);

  const handleSelectFromInventory = (nft: any) => {
    if (isSelectingParent === 'A') {
      setParentA(nft);
    } else if (isSelectingParent === 'B') {
      setParentB(nft);
    }
    setIsSelectingParent(null);
  };

  const incubateEgg = () => {
    // 1 minute from now for faster testing
    const endTime = Date.now() + 1 * 60 * 1000;
    localStorage.setItem('breedingTimerEnds', endTime.toString());
    setIncubationEndTime(endTime);
  };

  const hatchEgg = async () => {
    if (typeof (window as any).ethereum === 'undefined') {
      showToast('Please install MetaMask to hatch!', 'error');
      return;
    }
    
    setIsMintingBaby(true);
    try {
      const provider = new ethers.BrowserProvider((window as any).ethereum);
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(CONTRACT_ADDRESS, PangsRallyContract.abi, signer);

      const tx = await contract.breed(parentA.tokenId, parentB.tokenId, { value: ethers.parseEther("0.0001") });
      showToast('Hatching transaction sent! Waiting for block...', 'info');
      await tx.wait();
      
      const supply = await contract.totalSupply();
      const newId = supply.toString();
      
      showToast(`Baby Pangolin #${newId} hatched successfully!`, 'success');
      
      // Load new baby data
      const metadataUrl = `${window.location.origin}/api/metadata/${newId}`;
      let metadata = { name: `Pangs Rally #${newId}`, image: `nft-images/${newId}.webp` };
      try {
        const res = await fetch(metadataUrl);
        metadata = await res.json();
      } catch(e) {}
      
      const rarityInfo = (rarityData.nftRarities as any)[newId];
      
      setNewOffspring({ 
        name: metadata.name, 
        rarity: rarityInfo ? rarityInfo.tier : 'Common', 
        trait: 'Newborn',
        avatar: metadata.image 
      });
      
      // Reset breeding state
      localStorage.removeItem('breedingTimerEnds');
      setIncubationEndTime(null);
      setIsHatchReady(false);
      setParentA(null);
      setParentB(null);
      const addr = await signer.getAddress();
      fetchMyNFTs(addr); // refresh inventory
      
    } catch (err: any) {
      console.error(err);
      showToast(err.message || 'Hatching failed.', 'error');
    } finally {
      setIsMintingBaby(false);
    }
  };

  const mockCategories = [
    { id: 'cat1', name: 'Class 5', terrain: 'Forest', icon: '🌲', entry: 'Free', prize: 'Season points', color: '#b8ce55', bgClass: 'bg-forest' },
    { id: 'cat2', name: 'Class 4', terrain: 'Desert', icon: '🏜️', entry: 'Locked', prize: 'Coming soon', color: '#e67e22', bgClass: 'bg-desert' },
    { id: 'cat3', name: 'Class 3', terrain: 'Volcanic', icon: '🌋', entry: 'Locked', prize: 'Coming soon', color: '#e74c3c', bgClass: 'bg-volcanic' },
    { id: 'cat4', name: 'Class 2', terrain: 'Midnight', icon: '🌙', entry: 'Locked', prize: 'Coming soon', color: '#9b59b6', bgClass: 'bg-midnight' },
  ];

  /* ---------------------------------------------------------------- */
  /* Page URLs. The app is one page; the address bar mirrors the view  */
  /* so back/forward, refresh and shared links work.                   */
  /* ---------------------------------------------------------------- */
  const SIMPLE_PATHS: Partial<Record<typeof currentView, string>> = {
    landing: '/', 'how-to-play': '/vision', rally: '/rally', leaderboard: '/leaderboard', 'my-races': '/profile',
    inventory: '/inventory', marketplace: '/marketplace', laboratory: '/lab',
  };
  const pathForView = (): string | null => {
    const track = `/rally/${String(activeCategoryInfo?.terrain ?? 'forest').toLowerCase()}`;
    switch (currentView) {
      case 'race-lobby': return track;
      // A refresh must never start (and spend) a race, so live race views have their own path that loads the lobby.
      case 'bot-race': return `${track}/bot`;
      case 'online-rooms': return `${track}/rooms`;
      case 'online-race': return onlineRaceId ? `/room/${onlineRaceId}` : `${track}/online`;
      case 'replay': return replayRaceId ? `/race/${replayRaceId}` : null;
      default: return SIMPLE_PATHS[currentView] ?? null;
    }
  };
  // Set while a view change comes from the address itself: replace the entry instead of pushing a new one.
  const routeFromAddress = useRef(true);
  const applyPath = (path: string) => {
    routeFromAddress.current = true;
    const parts = path.replace(/\/+$/, '').split('/').filter(Boolean);
    const byPath = Object.entries(SIMPLE_PATHS).find(([, p]) => p === (parts.length ? `/${parts[0]}` : '/'));
    if (parts[0] === 'rally' && parts[1]) {
      const cat = mockCategories.find(c => c.terrain.toLowerCase() === parts[1] && c.entry !== 'Locked');
      if (cat) { setActiveCategoryInfo(cat); setOnlineRaceId(null); setCurrentView(parts[2] === 'rooms' ? 'online-rooms' : 'race-lobby'); return; }
      setCurrentView('rally'); return;
    }
    if (parts[0] === 'races') { setCurrentView('my-races'); return; } // old address of My Races
    if (parts[0] === 'race' && parts[1]) { setReplayRaceId(parts[1]); setCurrentView('replay'); return; }
    if (parts[0] === 'room' && parts[1]) { setActiveCategoryInfo(mockCategories[0]); setOnlineRaceId(parts[1]); setCurrentView('online-race'); return; }
    if (!byPath) window.history.replaceState(null, '', '/' + window.location.search); // unknown address → home
    setCurrentView((byPath?.[0] as typeof currentView) ?? 'landing');
  };
  // Load the view from the address once, then follow back/forward.
  useEffect(() => {
    applyPath(window.location.pathname);
    const onPop = () => applyPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const path = pathForView();
    const fromAddress = routeFromAddress.current;
    // First render still shows the default view while the address is being applied.
    if (fromAddress && currentView === 'landing' && window.location.pathname !== '/') return;
    routeFromAddress.current = false;
    if (path && path !== window.location.pathname) {
      window.history[fromAddress ? 'replaceState' : 'pushState'](null, '', path + window.location.search);
    }
    if (currentView !== 'landing') window.scrollTo(0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentView, activeCategoryInfo, onlineRaceId, replayRaceId]);

  const viewRooms = (category: any) => {
    setActiveCategoryInfo(category);
    setCurrentView('race-lobby'); // Go to new lobby with mode selection
  };

  const joinRaceRoom = async (room: any) => {
    setActiveRaceInfo({ ...activeCategoryInfo, roomId: room.id, participants: room.participants });
    setCurrentView('race-room');
    setRaceStatus('waiting');
    setHasPlayerJoined(false);
    
    // Generate bots for the room to simulate waiting players
    const bots = [];
    const randomFn = prngRef.current || Math.random;
    for (let i = 2; i <= room.participants; i++) {
      const randImg = Math.floor(randomFn() * 10) + 1;
      bots.push({
        id: i,
        name: `Racer #${randImg}`,
        distance: 0,
        speed: 0,
        targetSpeed: Math.floor(randomFn() * 40) + 70,
        position: i,
        image: `nft-images/${randImg}.webp`,
        avatar: `nft-images/${randImg}.webp`,
        sprite: await fetchBotBodyColor(randImg),
        isPlayer: false
      });
    }
    setRacers(bots);
  };

  // Graphical Simulation Engine (Vertical)
  useEffect(() => {
    let animationFrameId: number;
    let lastTime = performance.now();
    
    const simulate = (time: number) => {
      const deltaTime = (time - lastTime) / 1000;
      lastTime = time;

      setRacers(prevRacers => {
        let allFinished = true;
        let maxDistance = 0;
        
        const updated = prevRacers.map(racer => {
          if (racer.distance >= TOTAL_DISTANCE) {
            maxDistance = Math.max(maxDistance, TOTAL_DISTANCE);
            return racer; // already finished
          }
          
          allFinished = false;
          
          const newTarget = racer.targetSpeed || 50;
          const currentSpeed = racer.speed + (newTarget - racer.speed) * 0.03;
          const newDistance = Math.min(TOTAL_DISTANCE, racer.distance + (currentSpeed * deltaTime));
          
          maxDistance = Math.max(maxDistance, newDistance);
          
          let finishTime = racer.finishTime;
          if (newDistance >= TOTAL_DISTANCE) {
            finishTime = time; // Record exact finishing frame time
          }
          
          return {
            ...racer,
            distance: newDistance,
            speed: newDistance >= TOTAL_DISTANCE ? 0 : currentSpeed,
            targetSpeed: newTarget,
            finishTime: finishTime
          };
        });

        // Update Camera to follow the leader
        let newCam = maxDistance - 500; 
        if (newCam < 0) newCam = 0;
        
        setCameraProgress(newCam);

        // Sort to determine positions using finishTime if they reached the end
        const sorted = [...updated].sort((a, b) => {
          if (a.finishTime && b.finishTime) {
            return a.finishTime - b.finishTime; // smaller time = faster
          }
          if (a.finishTime) return -1;
          if (b.finishTime) return 1;
          return b.distance - a.distance;
        });
        
        updated.forEach(r => {
          r.position = sorted.findIndex(s => s.id === r.id) + 1;
        });

        if (allFinished) {
          setRaceStatus('finished');
        }
        
        return updated;
      });

      if (raceStatus === 'running') {
        animationFrameId = requestAnimationFrame(simulate);
      }
    };

    if (currentView === 'live-race' && raceStatus === 'running') {
      animationFrameId = requestAnimationFrame(simulate);
    }

    return () => cancelAnimationFrame(animationFrameId);
  }, [currentView, raceStatus]);

  // Save to Past Races history when finished
  useEffect(() => {
    if (raceStatus === 'finished' && !isReplayMode && racers.length > 0 && activeRaceInfo) {
      const isPlayerRacer = racers.find(r => r.isPlayer);
      if (isPlayerRacer) {
        const prizePool = 10;
        const calculatedPrize = isPlayerRacer.position === 1 ? prizePool * 0.5 : isPlayerRacer.position === 2 ? prizePool * 0.3 : isPlayerRacer.position === 3 ? prizePool * 0.2 : 0;

        // Record results to Supabase
        if (currentRaceDbId && walletAddress) {
          const fullAddr = localStorage.getItem('pangsRallyWallet') || '';
          finishRace(currentRaceDbId, [{
            walletAddress: fullAddr,
            position: isPlayerRacer.position,
            finishTime: isPlayerRacer.finishTime || 0,
            prizeEarned: calculatedPrize
          }]).catch(err => console.warn('Supabase finishRace error:', err));
        }
      }
    }
  }, [raceStatus, isReplayMode, activeRaceInfo]);

  const [isJoiningRace, setIsJoiningRace] = useState(false);
  const [isClaimingPrize, setIsClaimingPrize] = useState(false);

  const handleClaimPrize = async (position: number) => {
    if (position > 3) {
      showToast("You are not in the top 3!", "error");
      return;
    }
    
    // Calculate $PANG prize amount
    let pangsAmount = 0;
    if (position === 1) pangsAmount = 5;      // 50% = 5 $PANG
    else if (position === 2) pangsAmount = 3;  // 30% = 3 $PANG
    else if (position === 3) pangsAmount = 2;  // 20% = 2 $PANG

    setIsClaimingPrize(true);
    
    try {
      // For Beta: Use Supabase Edge Function for claim verification
      // The edge function will sign the message and return signature
      const fullAddr = localStorage.getItem('pangsRallyWallet') || '';
      
      const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
      
      if (SUPABASE_URL) {
        // Production: Call Supabase Edge Function
        const res = await fetch(`${SUPABASE_URL}/functions/v1/claim-verify`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY || ''}`
          },
          body: JSON.stringify({ 
            walletAddress: fullAddr, 
            raceId: currentRaceDbId,
            position: position,
            amount: pangsAmount.toString()
          })
        });
        
        if (!res.ok) throw new Error('Failed to get claim authorization');
        
        const { amountWei, nonce, signature } = await res.json();
        
        if (!(window as any).ethereum) throw new Error('Wallet not connected');
        const provider = new ethers.BrowserProvider((window as any).ethereum);
        const signer = await provider.getSigner();
        const raceContract = new ethers.Contract(RACING_ADDRESS, RACING_ABI, signer);
        
        showToast("Claiming $PANG on blockchain...", "info");
        const tx = await raceContract.claimPrize(amountWei, nonce, signature);
        await tx.wait();
        
        // Mark as claimed in Supabase
        if (currentRaceDbId) {
          markPrizeClaimed(currentRaceDbId, fullAddr, tx.hash);
        }
        
        showToast(`🏆 ${pangsAmount} $PANG claimed successfully!`, "success");
      } else {
        // Fallback: Off-chain Beta mode (no Supabase configured yet)
        showToast(`🏆 Top ${position}! You earned ${pangsAmount} $PANG (Beta - recorded off-chain)`, "success");
        
        // Still record to Supabase if available
        if (currentRaceDbId) {
          const fullAddr2 = localStorage.getItem('pangsRallyWallet') || '';
          markPrizeClaimed(currentRaceDbId, fullAddr2, 'beta-offchain').catch(() => {});
        }
      }
    } catch(e: any) {
      console.error(e);
      showToast(e.reason || e.message || "Failed to claim prize", "error");
    }
    setIsClaimingPrize(false);
  };

  const startRaceSimulation = async (isReplay = false) => {
    if (!activeRaceInfo) return;
    if (!selectedRacingNft && !isReplay) {
      return;
    }
    
    if (!isReplay) {
      const bodyColor = getBodySpriteFromAttributes(selectedRacingNft?.attributes || []);
      
      if (selectedRacingNft?.isGuest) {
        // Guest/Beta mode: No on-chain TX, but record in Supabase
        setIsJoiningRace(true);
        await new Promise(r => setTimeout(r, 1500));
        
        // Create race in Supabase
        const raceRecord = await createRace({
          roomId: activeRaceInfo.id || 'cat1',
          map: activeRaceInfo.terrain || 'Forest',
          raceClass: activeRaceInfo.name || 'Class 5',
          prizePool: 10,
          entryFee: 0,
        }).catch(() => null);
        
        if (raceRecord) {
          setCurrentRaceDbId(raceRecord.id);
          prngRef.current = seedrandom(raceRecord.seed);
          
          // Record participant
          const fullAddr = localStorage.getItem('pangsRallyWallet') || 'guest-' + Date.now();
          await joinRaceDB({
            raceId: raceRecord.id,
            walletAddress: fullAddr,
            nftTokenId: 0,
            nftName: selectedRacingNft.name || 'Rookie Pangolin',
            nftBodyColor: bodyColor,
          }).catch(() => {});
        } else {
          const fallbackSeed = `guest-${Date.now()}-${Math.random()}`;
          prngRef.current = seedrandom(fallbackSeed);
        }
        
        showToast("Joined race (Beta Mode)!", "success");
        setIsJoiningRace(false);
      } else {
        // Real on-chain mode: joinRace TX + Supabase record
        if (!(window as any).ethereum) return;
        setIsJoiningRace(true);
        try {
          const provider = new ethers.BrowserProvider((window as any).ethereum);
          const signer = await provider.getSigner();
          const playerAddress = signer.address;
          
          // Create race in Supabase first to get seed
          const raceRecord = await createRace({
            roomId: activeRaceInfo.id || 'cat1',
            map: activeRaceInfo.terrain || 'Forest',
            raceClass: activeRaceInfo.name || 'Class 5',
            prizePool: 10,
            entryFee: 0,
          }).catch(() => null);
          
          if (raceRecord) {
            setCurrentRaceDbId(raceRecord.id);
            prngRef.current = seedrandom(raceRecord.seed);
            
            await joinRaceDB({
              raceId: raceRecord.id,
              walletAddress: playerAddress,
              nftTokenId: parseInt(selectedRacingNft.tokenId) || 0,
              nftName: selectedRacingNft.name || 'Unknown',
              nftBodyColor: bodyColor,
            }).catch(() => {});
          } else {
            const fallbackSeed = `${playerAddress}-${Date.now()}-${Math.random()}`;
            prngRef.current = seedrandom(fallbackSeed);
          }
          
          showToast("Race joined! Starting...", "success");
        } catch(e: any) {
          console.error(e);
          showToast(e.reason || "Failed to join race", "error");
          setIsJoiningRace(false);
          return;
        }
        setIsJoiningRace(false);
      }
    }
    
    setIsReplayMode(isReplay);
    setHasPlayerJoined(true);
    setCurrentView('live-race');
    setRaceStatus('waiting');
    showToast("Waiting for other players to join...", "info");
    
    // Simulate lobby wait time
    await new Promise(r => setTimeout(r, 2500));
    
    // Generate racers deterministically using the seed (works for both live and replay)
    setCameraProgress(0);
    const randomFn = prngRef.current || Math.random;
    
    const getTeaserSprite = (id: number): string => {
      const map: Record<number, string> = {
        1: "/pangolin_sprite_rainbow.png",
        2: "/pangolin_sprite_gold.png",
        3: "/pangolin_sprite.png",
        4: "/pangolin_sprite_rainbow.png",
        5: "/pangolin_sprite.png",
        6: "/pangolin_sprite.png",
        7: "/pangolin_sprite_blue.png",
        8: "/pangolin_sprite.png",
        9: "/pangolin_sprite_rainbow.png",
        10: "/pangolin_sprite_rainbow.png",
      };
      return map[id] || "/pangolin_sprite.png";
    };

    const fetchBotSpriteForSeed = async (botTokenId: number): Promise<string> => {
        // Use hardcoded mapping for the 1-10 teaser images to ensure visual consistency
        return getTeaserSprite(botTokenId);
    };
    
    // Create player racer object
    const playerRacer = {
      id: 1,
      isPlayer: true,
      isGuest: selectedRacingNft?.isGuest,
      name: selectedRacingNft.name || 'Replay Racer',
      distance: 0,
      speed: 0,
      targetSpeed: (selectedRacingNft.speed || 50) + Math.floor(randomFn() * 20),
      position: 1,
      image: selectedRacingNft.image || `nft-images/${selectedRacingNft.tokenId || 1}.webp`,
      avatar: selectedRacingNft.avatar || `nft-images/${selectedRacingNft.tokenId || 1}.webp`,
      sprite: getBodySpriteFromAttributes(selectedRacingNft.attributes || []),
      finishTime: null
    };
    
    const newBots = [];
    for (let i = 0; i < 9; i++) {
      const randImg = Math.floor(randomFn() * 10) + 1;
      newBots.push({
        id: i + 2,
        name: `Racer #${randImg}`,
        distance: 0,
        speed: 0,
        targetSpeed: Math.floor(randomFn() * 40) + 70,
        position: i + 2,
        image: `nft-images/${randImg}.webp`,
        avatar: `nft-images/${randImg}.webp`,
        sprite: await fetchBotSpriteForSeed(randImg),
        isPlayer: false,
        finishTime: null
      });
    }
    
    setRacers([playerRacer, ...newBots]);

    // Mock countdown
    setTimeout(() => {
      setRaceStatus('running');
    }, 2000);
  };

  const returnToLobby = () => {
    setCurrentView('rally');
    setRaceStatus('waiting');
  };

  return (
    <>
      {/* Toast Notifications */}
      <div style={{position: 'fixed', top: '90px', right: '20px', zIndex: 10000, display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'flex-end', pointerEvents: 'none'}}>
        {toasts.map(toast => (
          <Toast key={toast.id} message={toast.message} type={toast.type} onClose={() => removeToast(toast.id)} />
        ))}
      </div>

      {noWalletHelp && <NoWalletModal onClose={() => setNoWalletHelp(false)} />}
      {betaOpen && <BetaMintModal onMint={mintBeta} onClose={() => setBetaOpen(false)} />}
      {inviteAsk && (
        <InviteCodeModal
          error={inviteAsk.error}
          onSubmit={(code) => { inviteAsk.resolve(code); setInviteAsk(null); }}
          onCancel={() => { inviteAsk.resolve(null); setInviteAsk(null); }}
        />
      )}

      {/* Rename Modal */}
      {renameModal && (
        <div style={{position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.7)', zIndex: 9999, display: 'flex', justifyContent: 'center', alignItems: 'center', backdropFilter: 'blur(5px)'}} onClick={() => setRenameModal(null)}>
          <div className="glass-panel" style={{padding: '2rem', borderRadius: '16px', maxWidth: '420px', width: '90%', background: 'var(--bg-panel)', border: '1px solid var(--primary)', boxShadow: '0 0 40px rgba(108,92,231,0.3)'}} onClick={e => e.stopPropagation()}>
            <h3 style={{marginTop: 0, color: 'var(--primary)'}}>✏️ Rename Pangolin</h3>
            <p style={{opacity: 0.7, fontSize: '0.9rem'}}>Current: <strong>{renameModal.currentName}</strong></p>
            <input
              type="text"
              value={renameInput}
              onChange={e => setRenameInput(e.target.value)}
              placeholder="Enter new name..."
              maxLength={25}
              style={{width: '100%', padding: '0.8rem 1rem', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '1rem', boxSizing: 'border-box', outline: 'none'}}
              autoFocus
            />
            <div style={{display: 'flex', gap: '1rem', marginTop: '1.5rem'}}>
              <button onClick={() => setRenameModal(null)} style={{flex: 1, padding: '0.7rem', borderRadius: '8px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-primary)', cursor: 'pointer'}}>Cancel</button>
              <button onClick={submitRename} className="btn btn-primary" style={{flex: 1, padding: '0.7rem', borderRadius: '8px'}}>Confirm</button>
            </div>
          </div>
        </div>
      )}

      {/* Image Expansion Modal */}
      {expandedImage && (
        <div style={{position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.85)', zIndex: 10000, display: 'flex', justifyContent: 'center', alignItems: 'center', backdropFilter: 'blur(10px)', cursor: 'pointer'}} onClick={() => setExpandedImage(null)}>
          <img src={expandedImage} alt="Expanded NFT" style={{maxWidth: '90%', maxHeight: '90%', objectFit: 'contain', borderRadius: '16px', boxShadow: '0 0 50px rgba(0,0,0,0.5)', animation: 'scaleIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)'}} />
        </div>
      )}

      {/* NFT Details Modal */}
      {selectedNFTDetails && (
        <div style={{position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.85)', zIndex: 10000, display: 'flex', justifyContent: 'center', alignItems: 'center', backdropFilter: 'blur(10px)'}} onClick={() => setSelectedNFTDetails(null)}>
          <div className="glass-panel" style={{display: 'flex', flexWrap: 'wrap', maxWidth: '750px', width: '90%', maxHeight: '90vh', overflowY: 'auto', background: 'var(--bg-panel)', borderRadius: '16px', border: '1px solid var(--primary)', padding: '1.5rem', gap: '1.5rem', cursor: 'default'}} onClick={e => e.stopPropagation()}>
            <div style={{flex: '1 1 200px', display: 'flex', flexDirection: 'column', gap: '0.5rem'}}>
              <div style={{background: 'var(--bg-dark)', borderRadius: '12px', padding: '0.5rem', border: '1px solid var(--border-color)'}}>
                <img src={selectedNFTDetails.avatar.startsWith('http') ? selectedNFTDetails.avatar : `/${selectedNFTDetails.avatar}`} alt={selectedNFTDetails.name} style={{width: '100%', borderRadius: '8px'}} />
              </div>
              <button className="btn btn-outline" style={{width: '100%', padding: '0.6rem'}} onClick={() => setSelectedNFTDetails(null)}>Close</button>
            </div>
            
            <div style={{flex: 2, display: 'flex', flexDirection: 'column', minWidth: '280px'}}>
                <h2 style={{margin: 0, color: 'var(--primary)', fontSize: '1.5rem'}}>{selectedNFTDetails.name}</h2>
                <span className={`badge rarity-${selectedNFTDetails.rarity?.toLowerCase() || 'common'}`} style={{display: 'inline-block', width: 'fit-content', marginTop: '0.5rem'}}>{selectedNFTDetails.rarity || 'Common'}</span>
                
                <div style={{background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '8px', marginTop: '1rem'}}>
                  <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem'}}>
                    <span>Speed</span>
                    <span className="stat-value" style={{color: 'var(--primary)'}}>{selectedNFTDetails.speed || 50}</span>
                  </div>
                  <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem'}}>
                    <span>Acceleration</span>
                    <span className="stat-value" style={{color: 'var(--primary)'}}>{selectedNFTDetails.acceleration || 50}</span>
                  </div>
                  <div style={{display: 'flex', justifyContent: 'space-between'}}>
                    <span>Endurance</span>
                    <span className="stat-value" style={{color: 'var(--primary)'}}>{selectedNFTDetails.endurance || 50}</span>
                  </div>
                </div>

              <h3 style={{fontSize: '1rem', color: 'var(--text-main)', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.4rem', marginBottom: '0.8rem', marginTop: '0.8rem'}}>Properties</h3>
              <div style={{display: 'flex', flexWrap: 'wrap', gap: '0.4rem'}}>
                {selectedNFTDetails.traits && selectedNFTDetails.traits.filter((t: any) => t.display_type !== 'number').map((t: any, idx: number) => {
                  const freq = (rarityData.traitFrequencies as any)[t.trait_type]?.[t.value] || '0';
                  return (
                    <div key={idx} style={{background: 'rgba(84, 50, 211, 0.1)', border: '1px solid var(--primary)', borderRadius: '6px', padding: '0.4rem', textAlign: 'center', flex: '1 1 calc(33% - 0.4rem)', minWidth: '85px'}}>
                      <div style={{color: 'var(--primary)', fontSize: '0.6rem', textTransform: 'uppercase', fontWeight: 'bold'}}>{t.trait_type}</div>
                      <div style={{color: 'var(--text-main)', fontSize: '0.8rem', fontWeight: '600', margin: '2px 0'}}>{t.value}</div>
                      <div style={{color: 'var(--text-muted)', fontSize: '0.65rem'}}>{freq}% have this</div>
                    </div>
                  );
                })}
              </div>

                {/* Marketplace Integration */}
                <div style={{marginTop: 'auto', paddingTop: '1rem'}}>
                  {marketListings.find(m => m.tokenId === selectedNFTDetails.tokenId) ? (
                    <button 
                      className="btn btn-outline" 
                      style={{width: '100%', borderColor: '#e74c3c', color: '#e74c3c', padding: '0.8rem'}}
                      onClick={() => handleCancelListing(selectedNFTDetails.tokenId)}
                      disabled={isListing}
                    >
                      {isListing ? 'Processing...' : 'Cancel Marketplace Listing'}
                    </button>
                  ) : (
                    <div style={{display: 'flex', gap: '0.5rem', alignItems: 'stretch'}}>
                      <div className="input-group" style={{flex: 1, marginBottom: 0}}>
                        <input type="number" step="0.01" value={listPrice} onChange={e => setListPrice(e.target.value)} placeholder="Price in ETH" style={{boxSizing: 'border-box', height: '48px', width: '100%', background: 'var(--bg-dark)', border: '1px solid var(--border-color)', color: 'var(--text-main)', padding: '0 0.8rem', borderRadius: '8px', fontSize: '1rem'}} />
                      </div>
                      <button 
                        className="btn btn-primary" 
                        style={{flex: 1, padding: '0 1rem', height: '48px', whiteSpace: 'nowrap'}}
                        onClick={() => handleListNFT(selectedNFTDetails.tokenId, listPrice)}
                        disabled={isListing || parseFloat(listPrice) <= 0}
                      >
                        {isListing ? 'Processing...' : 'List on Market'}
                      </button>
                    </div>
                  )}
                </div>
            </div>
          </div>
        </div>
      )}

      <header className="app-header" ref={headerRef}>
        <div className="container header-container">
          <div className="logo" onClick={() => setCurrentView('landing')} style={{cursor: 'pointer', display: 'flex', alignItems: 'center'}}>
            <img src="/dark-logo.webp" alt="Pangs Rally Logo" className="logo-img" width={640} height={213} fetchPriority="high" />
          </div>
          <nav className="nav-links">
            <a 
              className={currentView === 'how-to-play' ? 'active' : ''} 
              onClick={() => setCurrentView('how-to-play')}
              style={{cursor: 'pointer'}}
            >
              The Vision
            </a>
            <a 
              className={currentView === 'rally' || currentView === 'live-race' || currentView === 'race-room' ? 'active' : ''} 
              onClick={() => setCurrentView('rally')}
              style={{cursor: 'pointer'}}
            >
              The Rally
            </a>
            <a 
              className={currentView === 'laboratory' ? 'active' : ''} 
              onClick={() => setCurrentView('laboratory')}
              style={{cursor: 'pointer'}}
            >
              Laboratory
            </a>
            <a 
              className={currentView === 'inventory' ? 'active' : ''} 
              onClick={() => setCurrentView('inventory')}
              style={{cursor: 'pointer'}}
            >
              Inventory
            </a>
            <a 
              className={currentView === 'marketplace' ? 'active' : ''} 
              onClick={() => setCurrentView('marketplace')}
              style={{cursor: 'pointer'}}
            >
              Marketplace
            </a>
            <a 
              className={currentView === 'leaderboard' ? 'active' : ''} 
              onClick={() => setCurrentView('leaderboard')}
              style={{cursor: 'pointer'}}
            >
              Leaderboard
            </a>
            <a 
              className={currentView === 'my-races' ? 'active' : ''} 
              onClick={() => setCurrentView('my-races')}
              style={{cursor: 'pointer'}}
            >
              Profile
            </a>
          </nav>
          <div className="header-actions" style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
            {walletConnected ? (
              <div 
                className="wallet-connected-badge glass-panel" 
                onClick={() => {
                  signOut();
                  showToast('Wallet disconnected', 'info');
                }}
                title="Click to disconnect"
                style={{ cursor: 'pointer' }}
              >
                  <span className="wallet-dot"></span>
                  {player?.username ?? walletAddress}
                  {player && <span className="wallet-points">{player.points} pts</span>}
              </div>
            ) : (
              <button className="btn btn-primary" onClick={connectWallet} disabled={signingIn}>{signingIn ? 'Check wallet…' : 'Connect Wallet'}</button>
            )}
            <a href="https://x.com/PangsRally" target="_blank" rel="noopener noreferrer" className="x-social-btn">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 16 16">
                <path d="M12.6.75h2.454l-5.36 6.142L16 15.25h-4.937l-3.867-5.07-4.425 5.07H.316l5.733-6.57L0 .75h5.063l3.495 4.633L12.601.75Zm-.86 13.028h1.36L4.323 2.145H2.865l8.875 11.633Z"/>
              </svg>
            </a>
          </div>
        </div>
      </header>

      <main>
       <Suspense fallback={<ViewLoader />}>
        {currentView === 'landing' && (
          <Landing
            signedIn={!!player}
            signingIn={signingIn}
            onJoin={joinTestSeason}
            onRally={() => setCurrentView('rally')}
            onVision={() => setCurrentView('how-to-play')}
            onLeaderboard={() => setCurrentView('leaderboard')}
          />
        )}

        {currentView === 'rally' && (
          <section className="rally-section">
            <div className="container">
              <div className="lab-header">
                <h1 className="section-title">The Rally Lobby</h1>
                <p className="text-muted">Select a race that matches your Pangolin's secret trail preference to gain a significant speed advantage.</p>
              </div>

              <div className="races-container">
                {mockCategories.map((cat) => (
                  <div key={cat.id} className="race-card glass-panel">
                    <div className="race-info">
                      <div className="race-class">{cat.name}</div>
                      <div className="race-terrain" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '5px' }}>
                        <div>
                          <TrackBadge terrain={cat.terrain} size={30} style={{ marginRight: 10 }} />
                          {cat.terrain} Track
                        </div>
                      </div>
                    </div>
                    <div className="race-economy">
                      <div className="eco-item">
                        <span className="eco-label">Entry Fee</span>
                        <span className="eco-value" style={{color: cat.entry === 'Free' ? '#00c853' : 'inherit'}}>{cat.entry}</span>
                      </div>
                      <div className="eco-item">
                        <span className="eco-label">Prize Pool</span>
                        <span className="eco-value">{cat.prize}</span>
                      </div>
                    </div>
                    {cat.entry === 'Locked' ? (
                      <button className="btn join-btn" disabled style={{ opacity: 0.5, cursor: 'not-allowed', background: '#333' }}>
                        <LockIcon size={15} /> Locked
                      </button>
                    ) : (
                      <button className="btn btn-primary join-btn" onClick={() => viewRooms(cat)}>View Rooms</button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ===== Test season: lobby, bot race, online race, replay ===== */}
        {currentView === 'race-lobby' && activeCategoryInfo && (
          player ? (
            <RaceLobby
              categoryInfo={activeCategoryInfo}
              player={player}
              onSelectMode={(mode) => {
                if (needsBeta(player)) { setBetaOpen(true); return; }
                unlockAnnounce();
                setOnlineRaceId(null);
                setRaceKey(k => k + 1);
                setCurrentView(mode === 'bot' ? 'bot-race' : 'online-rooms');
              }}
              onBack={() => setCurrentView('rally')}
            />
          ) : (
            <SignInGate signingIn={signingIn} onSignIn={signIn} />
          )
        )}

        {currentView === 'bot-race' && activeCategoryInfo && player && (
          <RaceRoom
            key={`bot-${raceKey}`}
            categoryInfo={activeCategoryInfo}
            title="Bot Race"
            playerWallet={player.wallet}
            loadRace={async () => {
              const res = await testSeason.botRace(activeCategoryInfo.terrain);
              applyPlayer(res);
              return { race: res.race, you: res.you };
            }}
            onBack={() => { refreshPlayer(); setCurrentView('race-lobby'); }}
            onFinished={refreshPlayer}
            raceAgain={{
              label: 'Race Again!',
              enabled: player.unlimited || player.racesLeft > 0,
              hint: `Daily limit reached. New races at ${new Date(player.resetsAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}.`,
              onClick: () => { unlockAnnounce(); setRaceKey(k => k + 1); },
            }}
          />
        )}

        {currentView === 'online-rooms' && activeCategoryInfo && (
          player ? (
            <OnlineRooms
              categoryInfo={activeCategoryInfo}
              player={player}
              onOpenRoom={(id) => { unlockAnnounce(); setOnlineRaceId(id); setRaceKey(k => k + 1); setCurrentView('online-race'); }}
              onJoined={refreshPlayer}
              onBack={() => setCurrentView('race-lobby')}
            />
          ) : (
            <SignInGate signingIn={signingIn} onSignIn={signIn} />
          )
        )}

        {currentView === 'online-race' && activeCategoryInfo && player && (
          <OnlineRoom
            key={`online-${raceKey}-${onlineRaceId ?? 'new'}`}
            categoryInfo={activeCategoryInfo}
            playerWallet={player.wallet}
            raceId={onlineRaceId}
            onBack={() => { refreshPlayer(); setOnlineRaceId(null); setCurrentView('online-rooms'); }}
            onFinished={refreshPlayer}
          />
        )}

        {currentView === 'replay' && replayRaceId && (
          <RaceRoom
            key={`replay-${replayRaceId}`}
            categoryInfo={mockCategories[0]}
            title="Replay"
            playerWallet={player?.wallet ?? null}
            loadRace={() => testSeason.race(replayRaceId)}
            onBack={() => setCurrentView('my-races')}
            backLabel="← Back to Profile"
          />
        )}

        {currentView === 'room-browser' && activeCategoryInfo && (
          <section className="room-browser-section" style={{ paddingTop: '140px', minHeight: '100vh' }}>
            <div className="container">
              <div className="browser-header glass-panel" style={{ padding: '2rem', marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h1 className="section-title" style={{ marginBottom: '0.5rem' }}>Open Rooms</h1>
                  <p className="text-muted" style={{ fontSize: '1.2rem' }}>{activeCategoryInfo.icon} {activeCategoryInfo.name} - {activeCategoryInfo.terrain} Track</p>
                </div>
                <button className="btn btn-outline" onClick={() => setCurrentView('rally')}>Back to Categories</button>
              </div>

              <div className="rooms-list" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {[
                  { id: '#4092', players: 9, status: 'Almost Full' },
                  { id: '#4093', players: 5, status: 'Waiting' },
                  { id: '#4094', players: 1, status: 'Empty' },
                  { id: '#4095', players: 0, status: 'Empty' }
                ].map(room => (
                  <div key={room.id} className="room-row glass-panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.5rem 2rem' }}>
                    <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>Room {room.id}</div>
                    
                    <div style={{ display: 'flex', alignItems: 'center', gap: '3rem' }}>
                      <div className="room-info-preview">
                        <h3>{activeCategoryInfo.terrain} Track</h3>
                        <p>Distance: 3000m</p>
                      </div>

                      <div className="room-stats" style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '1.2rem', color: room.players === 9 ? 'var(--color-success)' : 'white' }}>{room.players}/10</div>
                        <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>{room.status}</div>
                      </div>
                      
                      <div className="room-eco" style={{ textAlign: 'right', minWidth: '150px' }}>
                        <div style={{ color: activeCategoryInfo.entry === 'Free' ? '#00c853' : 'white' }}>Fee: {activeCategoryInfo.entry}</div>
                        <div style={{ color: '#ffd700' }}>Prize: {activeCategoryInfo.prize}</div>
                      </div>

                      <button 
                        className="btn btn-primary" 
                        onClick={() => joinRaceRoom({ ...room, map: activeCategoryInfo.terrain, entryFee: activeCategoryInfo.entry, prizePool: activeCategoryInfo.prize })}
                      >
                        Enter Room
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {currentView === 'race-room' && activeRaceInfo && (
          <section className="race-room-section">
            <div className="container">
              <button 
                className="btn btn-outline" 
                style={{marginBottom: '1rem', color: 'var(--text-muted)', borderColor: 'var(--text-muted)'}}
                onClick={() => setCurrentView('room-browser')}
              >
                &larr; Back to Lobby
              </button>
              <div className="room-header-box glass-panel">
                <h1 className="section-title">Room {activeRaceInfo.roomId}</h1>
                <div className="room-meta">
                  <span className="terrain-badge">{activeCategoryInfo?.icon} {activeCategoryInfo?.terrain} Track</span>
                  <span className="class-badge">{activeCategoryInfo?.class}</span>
                  <span className="prize-badge" style={{color: '#ffd700'}}>Prize Pool: {activeCategoryInfo?.prize}</span>
                </div>
              </div>

              <div className="room-content-grid">
                {/* Left: Participants Grid */}
                <div className="room-participants glass-panel">
                  <h2>Participants ({hasPlayerJoined ? activeRaceInfo.participants + 1 : activeRaceInfo.participants}/10)</h2>
                  <div className="participants-grid">
                    {/* Render filled slots */}
                    {racers.map(r => (
                      <div key={r.id} className="participant-card">
                        <div className="lb-avatar-box-v2" style={{ background: activeCategoryInfo?.color || '#f1c40f' }}>
                          <TransparentImage src={r.avatar.startsWith('http') || r.avatar.startsWith('/') ? r.avatar : `/${r.avatar}`} alt="nft avatar" className="nft-avatar-img" />
                        </div>
                        <span className="p-name">{r.name}</span>
                      </div>
                    ))}
                    
                    {/* Empty slots to fill up to 10 */}
                    {Array.from({ length: 10 - racers.length }).map((_, i) => (
                      <div key={`empty-${i}`} className="participant-card slot-player empty">
                        <div className="empty-slot-indicator">Empty Slot</div>
                      </div>
                    ))}

                    {/* The 10th slot: Either Empty or Player */}
                    <div className={`participant-card slot-player ${hasPlayerJoined ? 'filled' : 'empty'}`}>
                      {hasPlayerJoined && selectedRacingNft ? (
                         <>
                           <div className="lb-avatar-box-v2" style={{ background: activeCategoryInfo?.color || '#f1c40f', border: '2px solid var(--color-success)' }}>
                             <TransparentImage src={selectedRacingNft.avatar.startsWith('http') || selectedRacingNft.avatar.startsWith('/') ? selectedRacingNft.avatar : `/${selectedRacingNft.avatar}`} alt="my avatar" className="nft-avatar-img" />
                           </div>
                           <span className="p-name" style={{color: 'var(--color-success)'}}>YOU</span>
                         </>
                      ) : (
                         <div className="empty-slot-indicator">Empty Slot</div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right: Join Action */}
                <div className="room-action-panel glass-panel">
                  <h2 style={{textAlign: 'center', marginBottom: '1.5rem'}}>Select Racer</h2>
                  
                  {selectedRacingNft ? (
                    <div className="my-racer-preview" style={{cursor: 'pointer'}} onClick={() => setIsSelectingRaceNft(true)}>
                      <div className="lb-avatar-box-v2" style={{ width: '100px', height: '100px', margin: '0 auto', background: activeCategoryInfo?.color || '#f1c40f', border: '3px solid var(--primary)' }}>
                        <TransparentImage src={selectedRacingNft.avatar.startsWith('http') || selectedRacingNft.avatar.startsWith('/') ? selectedRacingNft.avatar : `/${selectedRacingNft.avatar}`} alt="my avatar" className="nft-avatar-img" />
                      </div>
                      <h3 style={{textAlign:'center', marginTop:'15px', color: 'var(--text-main)'}}>{selectedRacingNft.name} (Lv. {selectedRacingNft.level || 1})</h3>
                      <p style={{textAlign:'center', color: 'var(--primary)', fontSize: '0.8rem', marginTop: '5px'}}>Click to change</p>
                    </div>
                  ) : (
                    <div className="my-racer-preview" style={{cursor: 'pointer', border: '1px dashed var(--border)', borderRadius: '12px', padding: '2rem', textAlign: 'center'}} onClick={() => setIsSelectingRaceNft(true)}>
                      <div style={{fontSize: '2rem', marginBottom: '1rem', color: 'var(--text-muted)'}}>+</div>
                      <h3 style={{color: 'var(--text-muted)'}}>Choose Pangolin</h3>
                    </div>
                  )}

                  <div className="entry-fee-box" style={{background: 'rgba(0,0,0,0.3)', padding: '15px', borderRadius: '8px', marginTop: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                    <span style={{color: 'var(--text-muted)'}}>Entry Fee</span>
                    <strong style={{color: activeCategoryInfo?.entry === 'Free' ? 'var(--color-success)' : 'white', fontSize: '1.2rem'}}>{activeCategoryInfo?.entry}</strong>
                  </div>

                  <div style={{marginTop: '30px'}}>
                    {!hasPlayerJoined ? (
                      <button 
                        className="btn btn-primary" 
                        style={{width: '100%', fontSize: '1.2rem', padding: '15px', opacity: (!selectedRacingNft || isJoiningRace) ? 0.5 : 1, cursor: (!selectedRacingNft || isJoiningRace) ? 'not-allowed' : 'pointer'}}
                        onClick={() => startRaceSimulation()}
                        disabled={!selectedRacingNft || isJoiningRace}
                      >
                        {!selectedRacingNft ? 'Select Racer First' : isJoiningRace ? 'Processing...' : 'Pay & Join Race (0.0001 ETH)'}
                      </button>
                    ) : (
                      <button 
                        className="btn btn-outline" 
                        style={{width: '100%', fontSize: '1.2rem', padding: '15px', opacity: 0.8, cursor: 'not-allowed', color: 'var(--color-success)', borderColor: 'var(--color-success)'}}
                        disabled
                      >
                        Starting Engine...
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {currentView === 'live-race' && activeRaceInfo && (
          <section className="live-race-section animated-enter">
            {isReplayMode && (
              <div className="replay-badge-overlay">
                <span className="pulsing-dot"></span> REPLAY
              </div>
            )}
            
            <div className="race-layout-container">
              {/* LEFT SIDEBAR: Solid background, Leaderboard */}
              <div className={`race-sidebar-left theme-bg-${activeRaceInfo.terrain.toLowerCase()}`}>
                <div className="vertical-leaderboard-v2">
                  {[...racers].sort((a,b) => a.position - b.position).map(r => {
                    let rankColor = 'white';
                    let rankIcon = '';
                    if (r.position === 1) { rankColor = '#ffd700'; rankIcon = '🥇'; } // Gold
                    else if (r.position === 2) { rankColor = '#c0c0c0'; rankIcon = '🥈'; } // Silver
                    else if (r.position === 3) { rankColor = '#cd7f32'; rankIcon = '🥉'; } // Bronze

                    return (
                      <div key={r.id} className="lb-entry-v2">
                        <div className="lb-rank-num-v2" style={{ color: rankColor }}>
                          {r.position} <span className="medal-icon">{rankIcon}</span>
                        </div>
                        <div className="lb-avatar-box-v2" style={{ background: activeRaceInfo.color || '#f1c40f' }}>
                          <TransparentImage 
                            src={`/${r.avatar}`} 
                            alt="nft avatar" 
                            className="nft-avatar-img" 
                          />
                        </div>
                        <div className="lb-name-v2" style={{ fontWeight: r.position === 1 ? 'bold' : 'normal', color: r.position === 1 ? '#fff' : 'rgba(255,255,255,0.8)' }}>
                          {r.name}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* CENTER TRACK: The running surface with borders */}
              <div className={`race-center-track track-theme-${activeRaceInfo.terrain.toLowerCase()}`}>
                <div className="track-background" style={{ backgroundPositionY: `${cameraProgress}px` }}></div>
                <div className="track-edge-left" style={{ backgroundPositionY: `${cameraProgress * 1.5}px` }}></div>
                <div className="track-edge-right" style={{ backgroundPositionY: `${cameraProgress * 1.5}px` }}></div>
                
                <div className="track-surface-vertical" style={{ transform: `translateY(${cameraProgress}px)` }}>
                  
                  {/* Start Line & Numbers */}
                  <div className="start-line"></div>
                  {racers.map((_racer, index) => {
                    const horizontalPos = 5 + (index * 10);
                    return (
                      <div 
                        key={`start-${index}`} 
                        className="start-number" 
                        style={{ left: `${horizontalPos}%` }}
                      >
                        {index + 1}
                      </div>
                    )
                  })}

                  <div className="finish-line-vertical" style={{ bottom: `${TOTAL_DISTANCE}px` }}></div>

                  {/* The Racers */}
                  {racers.map((racer, index) => {
                    // Spread 10 racers evenly across the center track based on their fixed ID (lane)
                    const horizontalPos = 5 + (index * 10); 
                    
                    return (
                      <div 
                        key={racer.id} 
                        className="vertical-racer" 
                        style={{ 
                          left: `${horizontalPos}%`,
                          bottom: `${racer.distance}px`
                        }}
                      >
                        {racer.isPlayer && (
                          <div style={{
                            position: 'absolute',
                            top: '-35px',
                            left: '50%',
                            transform: 'translateX(-50%)',
                            background: 'rgba(255, 215, 0, 0.9)',
                            color: '#000',
                            padding: '4px 8px',
                            borderRadius: '12px',
                            fontWeight: 'bold',
                            fontSize: '14px',
                            boxShadow: '0 0 15px rgba(255, 215, 0, 1)',
                            whiteSpace: 'nowrap',
                            zIndex: 10,
                            animation: 'pulse 1.5s infinite'
                          }}>
                            ▼ YOU
                          </div>
                        )}
                        <div 
                          className={`racer-trail ${raceStatus === 'running' ? 'dust-active' : ''}`}
                          style={{ height: `${200 + (racer.speed * 0.8)}px` }}
                        ></div>
                        <div className={`racer-emoji ${raceStatus === 'running' ? 'running-anim' : ''}`}>
                          <div style={{ width: '100%', height: '100%', transform: 'scale(1.35)' }}>
                            <img 
                              src={racer.sprite || `/pangolin_sprite.png`} 
                              alt="racer" 
                              className="track-racer-img" 
                            />
                          </div>
                        </div>
                        <div className="racer-name-tag" style={{ display: 'none' }}>{racer.name}</div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* RIGHT SIDEBAR: Solid background, Info HUD */}
              <div className={`race-sidebar-right theme-bg-${activeRaceInfo.terrain.toLowerCase()}`}>
                <div className="track-info-hud-v2">
                  <h2 style={{margin:0, padding:0}}>{activeRaceInfo.terrain} Track</h2>
                  <p style={{margin:0, padding:0, opacity: 0.8, fontSize: '0.9rem'}}>{activeRaceInfo.class} - {activeRaceInfo.prize}</p>
                </div>
                
                <div className="distance-hud-v2">
                  {Math.floor(Math.max(...racers.map(r => r.distance)) / 100).toFixed(1)}m
                </div>
              </div>
            </div>

            <div className={`race-footer-bar theme-bg-darker-${activeRaceInfo.terrain.toLowerCase()}`}>
              {raceStatus === 'waiting' && <button className="btn btn-primary" onClick={() => startRaceSimulation()}>Start Simulation</button>}
              {raceStatus === 'finished' && (() => {
                const player = racers.find(r => r.isPlayer);
                const isTop3 = player && player.position <= 3;
                let prizeText = "0 ETH";
                if (player?.position === 1) prizeText = "0.000045 ETH (1st)";
                if (player?.position === 2) prizeText = "0.000027 ETH (2nd)";
                if (player?.position === 3) prizeText = "0.000018 ETH (3rd)";
                
                return (
                  <div style={{display: 'flex', gap: '1rem'}}>
                    {isTop3 && !player.isGuest && (
                      <button 
                        className="btn btn-primary" 
                        onClick={() => handleClaimPrize(player.position)}
                        disabled={isClaimingPrize}
                      >
                        {isClaimingPrize ? 'Claiming...' : `Claim ${prizeText}`}
                      </button>
                    )}
                    <button className="btn btn-outline" style={{backgroundColor: 'white', color: 'black'}} onClick={returnToLobby}>Return to Lobby</button>
                  </div>
                );
              })()}
            </div>

          </section>
        )}

        {currentView === 'inventory' && (
          <section className="inventory-page animated-enter">
            <div className="inventory-header-bar">
              <h2>My Collection</h2>
              <div className="inventory-stats" style={{display: 'flex', gap: '2rem'}}>
                <span>Total Pangolins: <strong style={{color: 'var(--primary)'}}>{activeInventory.length}</strong></span>
              </div>
            </div>
            
            {player && <BetaInventory wallet={player.wallet} contract={player.beta?.contract ?? null} onMintBeta={() => setBetaOpen(true)} />}
            <h3 style={{ margin: '0 0 0.8rem', fontSize: '1.3rem' }}>Genesis Pangolins</h3>
            <div className="filter-tabs">
              {['All', 'Legendary', 'Rare', 'Uncommon', 'Common'].map(filter => (
                <button 
                  key={filter}
                  className={`filter-btn ${inventoryFilter === filter ? 'active' : ''}`}
                  onClick={() => setInventoryFilter(filter)}
                >
                  {filter}
                </button>
              ))}
            </div>

            <div className="inventory-grid-page">
              {isFetchingNFTs ? (
                <div style={{ textAlign: 'center', padding: '3rem', width: '100%', gridColumn: '1 / -1' }}>
                  <h3>Loading your Pangolins from Web3...</h3>
                </div>
              ) : activeInventory.length === 0 ? (
                <div className="empty-state" style={{gridColumn: '1/-1', textAlign: 'center', padding: '4rem', background: 'var(--bg-card)', borderRadius: '16px'}}>
                  <h3 style={{marginBottom: '1rem'}}>No Genesis Pangolins yet</h3>
                  <p style={{color: 'var(--text-muted)', marginBottom: player ? 0 : '2rem'}}>Genesis Pangolins arrive with the Genesis mint. During the Beta season you race with your Beta pass.</p>
                  {!player && <button className="btn btn-primary" onClick={joinTestSeason}>Join the Beta Season</button>}
                </div>
              ) : (
                filteredInventory.map(nft => (
                  <div key={nft.id} className="inventory-card glass-panel" style={nft.isBeta ? { border: '2px solid rgba(255,215,0,0.6)', boxShadow: '0 0 20px rgba(255,215,0,0.15)' } : {}}>
                    <div className="inv-card-header">
                      <span className="inv-id">{nft.isBeta ? '🏆' : nft.id}</span>
                      <span className="lvl-badge">LVL {nft.level}</span>
                      {nft.isBeta
                        ? <span className="badge" style={{ background: 'linear-gradient(135deg, #ffd700, #ff8c00)', color: '#000', fontWeight: 'bold' }}>BETA</span>
                        : <span className={`badge rarity-${nft.rarity?.toLowerCase() || 'common'}`}>{nft.rarity || 'Common'}</span>
                      }
                    </div>
                    <div className="inv-card-image" style={{cursor: 'pointer'}} onClick={() => setExpandedImage(
                      nft.avatar?.startsWith('http') || nft.avatar?.startsWith('/') ? nft.avatar : `/${nft.avatar}`
                    )}>
                      <TransparentImage 
                        src={nft.avatar?.startsWith('http') || nft.avatar?.startsWith('/') ? nft.avatar : `/${nft.avatar || 'pangolin_sprite.png'}`} 
                        alt={nft.name} 
                      />
                    </div>
                    <div className="inv-card-body">
                      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                        <h3 style={{margin: 0, fontSize: nft.isBeta ? '0.85rem' : undefined}}>{nft.name}</h3>
                        {walletConnected && nft.tokenId && !nft.isBeta && (
                          <button onClick={() => handleRename(nft.tokenId, nft.name)} style={{background: 'transparent', border: '1px solid var(--primary)', color: 'var(--primary)', padding: '2px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '10px'}}>Rename</button>
                        )}
                      </div>
                      {nft.isBeta
                        ? <span className="badge" style={{ marginTop: '0.5rem', display: 'inline-block', background: 'rgba(255,215,0,0.1)', color: '#ffd700', border: '1px solid rgba(255,215,0,0.3)' }}>Beta Tester</span>
                        : <span className="badge trait-badge" style={{marginTop: '0.5rem', display: 'inline-block'}}>{nft.trait}</span>
                      }
                      <button onClick={() => setSelectedNFTDetails(nft)} className="btn btn-outline" style={{width: '100%', marginTop: '1rem', padding: '0.5rem'}}>View Details</button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        )}

        {currentView === 'marketplace' && (
          <section className="inventory-page animated-enter" style={{position: 'relative'}}>
            {/* Purchase Success Modal */}
            {buySuccess && (
              <div style={{position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.8)', zIndex: 100, display: 'flex', justifyContent: 'center', alignItems: 'center'}}>
                <div className="glass-panel" style={{padding: '3rem', textAlign: 'center', borderRadius: '15px', border: '2px solid var(--color-success)', boxShadow: '0 0 30px rgba(0,255,136,0.3)', background: 'var(--bg-panel)'}} onClick={e => e.stopPropagation()}>
                  <h2 style={{color: 'var(--color-success)', fontSize: '2.5rem', marginBottom: '1rem'}}>Purchase Successful!</h2>
                  <div style={{width: '150px', height: '150px', margin: '0 auto', background: 'white', padding: '10px', borderRadius: '10px', marginBottom: '1.5rem'}}>
                    <img src={`/${buySuccess.avatar}`} style={{width: '100%', height: '100%', objectFit: 'contain'}} />
                  </div>
                  <p style={{fontSize: '1.2rem', marginBottom: '2rem'}}>You successfully acquired <strong>{buySuccess.name}</strong> ({buySuccess.id}) for {buySuccess.price} ETH!</p>
                  <button className="btn btn-primary" onClick={() => { setBuySuccess(null); setCurrentView('inventory'); }}>
                    View in Inventory
                  </button>
                </div>
              </div>
            )}
            
            <div className="inventory-header-bar">
              <h2>Marketplace</h2>
              <div className="inventory-stats">
                <span style={{display: 'flex', gap: '15px'}}>
                  <span>ETH: <strong style={{color: '#ffd700', fontSize: '1.5rem'}}>{playerBalance}</strong></span>
                </span>
              </div>
            </div>
            
            <div className="inventory-grid-page">
              {marketListings.map(nft => (
                <div key={nft.id} className="inventory-card glass-panel" style={{position: 'relative'}}>
                  <div className="inv-card-header">
                    <span className="inv-id">{nft.id}</span>
                    <span className="lvl-badge">LVL {nft.level}</span>
                    <span className={`badge rarity-${nft.rarity.toLowerCase()}`}>{nft.rarity}</span>
                  </div>
                  <div className="inv-card-image" style={{height: '180px'}}>
                    <TransparentImage src={`/${nft.avatar}`} alt={nft.name} />
                  </div>
                  <div className="inv-card-body">
                    <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                      <h3>{nft.name}</h3>
                      <span className="badge trait-badge">{nft.trait}</span>
                    </div>
                    
                    <div className="price-tag" style={{marginTop: '0.5rem', marginBottom: '0.5rem', fontSize: '1.3rem', fontWeight: 'bold', color: '#ffd700', display: 'flex', alignItems: 'center', gap: '5px'}}>
                      <svg width="12" height="20" viewBox="0 0 320 512" fill="currentColor"><path d="M311.9 260.8L160 353.6 8 260.8 160 0l151.9 260.8zM160 383.4L8 290.6 160 512l152-221.4-152 92.8z"/></svg>
                      {nft.price} ETH
                    </div>
                    
                    <div className="inv-card-stats-grid" style={{marginTop: '0'}}>
                      <div className="stat-col">
                        <span className="stat-label">Speed</span>
                        <span className="stat-val">{nft.speed}</span>
                      </div>
                      <div className="stat-col">
                        <span className="stat-label">Accel</span>
                        <span className="stat-val">{nft.acceleration}</span>
                      </div>
                      <div className="stat-col">
                        <span className="stat-label">Endur</span>
                        <span className="stat-val">{nft.endurance}</span>
                      </div>
                    </div>
                    
                    <button 
                      className="btn btn-primary" 
                      style={{width: '100%', marginTop: '1rem', padding: '0.8rem'}}
                      onClick={() => handleBuyNFT(nft)}
                      disabled={playerBalance < nft.price || isProcessingBuy}
                    >
                      {playerBalance >= nft.price ? 'Buy Now' : 'Insufficient Funds'}
                    </button>
                  </div>
                </div>
              ))}
              {marketListings.length === 0 && (
                <div style={{gridColumn: '1 / -1', textAlign: 'center', padding: '3rem', fontSize: '1.2rem', color: 'var(--text-muted)'}}>
                  No Pangolins currently listed on the market.
                </div>
              )}
            </div>

            {/* Transaction Processing Modal */}
            {isProcessingBuy && (
              <div className="inventory-modal-overlay">
                <div className="glass-panel" style={{padding: '3rem', textAlign: 'center', borderRadius: '15px'}}>
                  <div className="spinner" style={{width: '50px', height: '50px', border: '5px solid rgba(255,123,0,0.3)', borderTop: '5px solid var(--primary)', borderRadius: '50%', margin: '0 auto 1rem auto', animation: 'spin 1s linear infinite'}}></div>
                  <h2>Processing Transaction...</h2>
                  <p style={{color: 'var(--text-muted)'}}>Confirming on blockchain...</p>
                </div>
              </div>
            )}
          </section>
        )}

        {currentView === 'leaderboard' && (
          <SeasonLeaderboard playerWallet={player?.wallet ?? null} />
        )}

        {currentView === 'my-races' && (
          <Profile
            signedIn={!!player}
            signingIn={signingIn}
            onSignIn={signIn}
            onMintBeta={() => setBetaOpen(true)}
            onReplay={(id) => { unlockAnnounce(); setReplayRaceId(id); setCurrentView('replay'); }}
            onOpenRoom={(id) => {
              unlockAnnounce();
              setActiveCategoryInfo(mockCategories[0]);
              setOnlineRaceId(id);
              setCurrentView('online-race');
            }}
            onGoRace={() => setCurrentView('rally')}
            onPlayer={applyPlayer}
          />
        )}

        {currentView === 'laboratory' && (
          <section className="laboratory-section">
            <div className="container">
              <div className="lab-header">
                <h1 className="section-title">The Laboratory</h1>
                <p className="text-muted">Select two Pangolins to incubate a new egg. Breeding opens after the Genesis mint; costs will be announced then.</p>
              </div>

              <div className="lab-grid">
                <div className="parents-container">
                  <div className="parent-slot glass-panel">
                    <h3 className="slot-title">Father (Male)</h3>
                    {parentA ? (
                      <div className="selected-parent">
                        <div className="parent-avatar" style={{ padding: 0, overflow: 'hidden', border: '2px solid var(--primary)' }}>
                          <TransparentImage src={parentA.avatar.startsWith('http') ? parentA.avatar : `/${parentA.avatar}`} alt="nft" className="nft-avatar-img" />
                        </div>
                        <div className="parent-details">
                          <h4>{parentA.name}</h4>
                          <span className={`badge rarity-${parentA.rarity.toLowerCase()}`}>{parentA.rarity}</span>
                          <span className="badge trait-badge">{parentA.traits?.find((t: any) => t.trait_type === 'Body')?.value || 'Male'}</span>
                        </div>
                        <button className="btn-small btn-outline" onClick={() => setParentA(null)}>Remove</button>
                      </div>
                    ) : (
                      <div className="empty-slot" style={{ opacity: 0.6, cursor: 'not-allowed' }}>
                        <div className="add-icon">🔒</div>
                        <p>Coming Soon</p>
                      </div>
                    )}
                  </div>

                  <div className="dna-connector">
                    <div className="dna-icon">🧬</div>
                  </div>

                  <div className="parent-slot glass-panel">
                    <h3 className="slot-title">Mother (Female)</h3>
                    {parentB ? (
                      <div className="selected-parent">
                        <div className="parent-avatar" style={{ padding: 0, overflow: 'hidden', border: '2px solid var(--primary)' }}>
                          <TransparentImage src={parentB.avatar.startsWith('http') ? parentB.avatar : `/${parentB.avatar}`} alt="nft" className="nft-avatar-img" />
                        </div>
                        <div className="parent-details">
                          <h4>{parentB.name}</h4>
                          <span className={`badge rarity-${parentB.rarity.toLowerCase()}`}>{parentB.rarity}</span>
                          <span className="badge trait-badge">{parentB.traits?.find((t: any) => t.trait_type === 'Body')?.value || 'Female'}</span>
                        </div>
                        <button className="btn-small btn-outline" onClick={() => setParentB(null)}>Remove</button>
                      </div>
                    ) : (
                      <div className="empty-slot" style={{ opacity: 0.6, cursor: 'not-allowed' }}>
                        <div className="add-icon">🔒</div>
                        <p>Coming Soon</p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="incubation-panel glass-panel">
                  <h3 className="panel-title">Incubation Analysis</h3>
                  
                  <div className="genetics-stats">
                    <div className="trait-probabilities">
                      <h4>Body Trait Inheritance</h4>
                      {parentA && parentB ? (
                        <>
                          <div className="prob-bar">
                            <div className="prob-label"><span>{parentA.traits?.find((t: any) => t.trait_type === 'Body')?.value || 'Father\'s Body'}</span> <span>40%</span></div>
                            <div className="progress"><div className="progress-fill" style={{width: '40%'}}></div></div>
                          </div>
                          <div className="prob-bar">
                            <div className="prob-label"><span>{parentB.traits?.find((t: any) => t.trait_type === 'Body')?.value || 'Mother\'s Body'}</span> <span>40%</span></div>
                            <div className="progress"><div className="progress-fill" style={{width: '40%'}}></div></div>
                          </div>
                          <div className="prob-bar">
                            <div className="prob-label"><span>Mutation (Random)</span> <span className="text-primary">20%</span></div>
                            <div className="progress"><div className="progress-fill mutation" style={{width: '20%'}}></div></div>
                          </div>
                        </>
                      ) : (
                        <p className="text-muted text-sm">Select two parents to view genetics analysis.</p>
                      )}
                    </div>
                  </div>

                  <div className="breeding-cost">
                    <div className="cost-label">Breeding Cost</div>
                    <div className="cost-value">
                      <span className="token-icon">🪙</span>
                      TBA
                    </div>
                  </div>

                  {!isIncubating && !isHatchReady && !newOffspring && (
                    <button 
                      className={`btn btn-primary w-full incubate-btn disabled`}
                      disabled={true}
                      onClick={incubateEgg}
                    >
                      Coming Soon
                    </button>
                  )}

                  {isIncubating && (
                    <button className="btn w-full incubate-btn incubating-state" disabled style={{ background: 'var(--primary-glow)', color: 'white', position: 'relative', overflow: 'hidden' }}>
                      <span className="loader-dna">🧬</span> Incubating... {timeRemaining}
                    </button>
                  )}
                  
                  {isHatchReady && !newOffspring && (
                    <button 
                      className="btn w-full incubate-btn" 
                      style={{ background: 'linear-gradient(90deg, #00ff88 0%, #00a050 100%)', color: '#0b0614', fontWeight: 'bold' }}
                      onClick={hatchEgg}
                      disabled={isMintingBaby}
                    >
                      {isMintingBaby ? 'Minting Baby...' : '✨ Hatch Egg! ✨'}
                    </button>
                  )}
                </div>
              </div>
            </div>

            {isMintingBaby && (
              <div className="hatching-egg-overlay">
                <div className="magic-egg"></div>
                <h2 style={{color: '#ffd700', marginTop: '2rem', fontSize: '2rem', textShadow: '0 0 10px #ffd700'}}>Hatching on Blockchain...</h2>
              </div>
            )}

            {newOffspring && (
              <div className="hatching-modal-overlay">
                <div className="hatching-modal glass-panel" style={{ background: '#1a1a24', color: 'white' }}>
                  <h2 style={{color: '#ffd700', fontSize: '2.5rem', marginBottom: '1rem', textShadow: '0 0 20px rgba(255, 215, 0, 0.5)'}}>Egg Hatched!</h2>
                  <div className="offspring-avatar-box">
                    <TransparentImage src={newOffspring.avatar} alt="Newborn Pangolin" className="nft-avatar-img" />
                  </div>
                  <h3 style={{fontSize: '2rem', marginTop: '1rem', color: 'white'}}>{newOffspring.name}</h3>
                  <div className="offspring-stats" style={{marginTop: '1.5rem', display: 'flex', gap: '1rem', justifyContent: 'center'}}>
                    <span className="badge rarity-legendary" style={{fontSize: '1.2rem', padding: '0.5rem 1rem'}}>{newOffspring.rarity}</span>
                    <span className="badge trait-badge" style={{fontSize: '1.2rem', padding: '0.5rem 1rem', background: 'linear-gradient(45deg, #ff416c, #ff4b2b)', color: '#fff'}}>{newOffspring.trait}</span>
                  </div>
                  
                  <div style={{marginTop: '2rem', display: 'flex', gap: '1rem', justifyContent: 'center'}}>
                     <button className="btn btn-primary" onClick={() => setNewOffspring(null)}>Collect Newborn</button>
                  </div>
                </div>
              </div>
            )}

            {isSelectingParent && (
              <div className="inventory-modal-overlay">
                <div className="inventory-modal glass-panel">
                  <div className="inventory-header">
                    <h2>Select {isSelectingParent === 'A' ? 'Father (Male)' : 'Mother (Female)'}</h2>
                    <button className="btn-close" onClick={() => setIsSelectingParent(null)}>✕</button>
                  </div>
                  <div className="inventory-grid">
                    {!walletConnected && (
                      <div style={{gridColumn: '1 / -1', textAlign: 'center', padding: '2rem', color: 'var(--text-muted)'}}>
                        Please connect your wallet to select parents.
                      </div>
                    )}
                    {walletConnected && myNFTs.length === 0 && (
                      <div style={{gridColumn: '1 / -1', textAlign: 'center', padding: '2rem', color: 'var(--text-muted)'}}>
                        You don't have any Pangolins in your inventory yet.
                      </div>
                    )}
                    {(walletConnected ? myNFTs : []).filter(nft => {
                      if ((nft.breedCount || 0) >= 7) return false; // Max 7 breeds
                      
                      const gender = nft.traits?.find((t: any) => t.trait_type === 'Gender')?.value;
                      if (!gender) return true; // Fallback for failed metadata
                      if (isSelectingParent === 'A') return gender === 'Male';
                      if (isSelectingParent === 'B') return gender === 'Female';
                      return true;
                    }).map(nft => {
                      const isSelectedOther = (isSelectingParent === 'A' && parentB?.id === nft.id) || (isSelectingParent === 'B' && parentA?.id === nft.id);
                      return (
                        <div 
                          key={nft.id} 
                          className={`inventory-item ${isSelectedOther ? 'disabled' : ''}`}
                          onClick={() => !isSelectedOther && handleSelectFromInventory(nft)}
                        >
                          <div className="inv-avatar-box">
                            <TransparentImage src={nft.avatar} alt={nft.name} className="nft-avatar-img" />
                          </div>
                          <h4>{nft.name}</h4>
                          <div className="inv-badges">
                            <span className={`badge rarity-${nft.rarity.toLowerCase()}`}>{nft.rarity}</span>
                            <span className="badge trait-badge">{nft.traits?.find((t: any) => t.trait_type === 'Body')?.value || nft.trait}</span>
                            <span className="badge" style={{background: 'var(--bg-dark)', color: 'var(--text-muted)'}}>{nft.breedCount || 0}/7 Breeds</span>
                          </div>
                          {isSelectedOther && <div className="selected-overlay">Already Selected</div>}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}
          </section>
        )}
        {/* NFT Selection Modal for Racing */}
      {isSelectingRaceNft && (
        <div style={{position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.85)', zIndex: 10000, display: 'flex', justifyContent: 'center', alignItems: 'center', backdropFilter: 'blur(10px)'}} onClick={() => setIsSelectingRaceNft(false)}>
          <div className="glass-panel" style={{display: 'flex', flexDirection: 'column', maxWidth: '800px', width: '90%', maxHeight: '90vh', background: 'var(--bg-panel)', borderRadius: '16px', border: '1px solid var(--primary)', padding: '2rem'}} onClick={e => e.stopPropagation()}>
            <h2>Select a Racer</h2>
            <div style={{display: 'flex', flexWrap: 'wrap', gap: '1rem', overflowY: 'auto', marginTop: '1rem', paddingBottom: '1rem'}}>
              {myNFTs.length === 0 ? (
                <p>You don't own any Pangolins yet! Go to the Rally or Laboratory to mint one.</p>
              ) : (
                myNFTs.map(nft => (
                  <div key={nft.id} style={{width: '150px', background: 'var(--bg-card)', borderRadius: '12px', padding: '1rem', cursor: 'pointer', border: selectedRacingNft?.id === nft.id ? '2px solid var(--color-success)' : '1px solid var(--border)'}} onClick={() => { setSelectedRacingNft(nft); setIsSelectingRaceNft(false); }}>
                    <TransparentImage src={nft.avatar.startsWith('http') || nft.avatar.startsWith('/') ? nft.avatar : `/${nft.avatar}`} alt={nft.name} />
                    <h4 style={{textAlign: 'center', margin: '10px 0 0 0', fontSize: '0.9rem'}}>{nft.name}</h4>
                    <p style={{textAlign: 'center', margin: '5px 0 0 0', fontSize: '0.8rem', color: 'var(--primary)'}}>Speed: {nft.speed}</p>
                  </div>
                ))
              )}
            </div>
            <button className="btn btn-outline" style={{marginTop: '2rem'}} onClick={() => setIsSelectingRaceNft(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Global Registration Success Modal Overlay */}
        {registrationSuccess && (
          <div style={{position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.85)', zIndex: 9999, display: 'flex', justifyContent: 'center', alignItems: 'center'}}>
            <div className="glass-panel" style={{padding: '3rem', textAlign: 'center', borderRadius: '15px', border: '2px solid var(--color-success)', boxShadow: '0 0 30px rgba(0,255,136,0.2)', background: 'var(--bg-panel)', maxWidth: '500px'}} onClick={e => e.stopPropagation()}>
              <div style={{fontSize: '4rem', marginBottom: '1rem'}}>🏁</div>
              <h2 style={{color: 'var(--color-success)', fontSize: '2rem', marginBottom: '1rem'}}>Registration Successful!</h2>
              <p style={{fontSize: '1.1rem', marginBottom: '1rem'}}>You successfully joined the race on <strong>{registrationSuccess.map}</strong>.</p>
              <p style={{color: 'var(--text-muted)', marginBottom: '2rem'}}>Once the room fills up (10/10) and the race completes, you will be able to watch the replay in your Race History.</p>
              <div style={{display: 'flex', gap: '1rem', justifyContent: 'center'}}>
                <button className="btn btn-outline" onClick={() => setRegistrationSuccess(null)}>
                  Close
                </button>
                <button className="btn btn-primary" onClick={() => { setRegistrationSuccess(null); setCurrentView('my-races'); }}>
                  Go to My Races
                </button>
              </div>
            </div>
          </div>
        )}

        {currentView === 'how-to-play' && (
          <Litepaper />
        )}

            {currentView === 'referral' && (
              <section className="referral-page">
                <div className="referral-header">
                  <h2>Refer & Earn</h2>
                  <p>Invite your friends, share the Rally, and earn $PANG commissions directly to your wallet.</p>
                </div>
                
                <div className="ref-stats-grid">
                  <div className="ref-stat-card">
                    <h3>Invite Via Code</h3>
                    {userReferralCode ? (
                      <div className="ref-code-box">
                        <span>{userReferralCode}</span>
                        <button className="copy-btn" onClick={() => {
                          if(walletConnected) {
                            navigator.clipboard.writeText(`${window.location.origin}/?ref=${userReferralCode}`);
                            showToast('Referral link copied!', 'success');
                          }
                        }}>Copy Link</button>
                      </div>
                    ) : (
                      <div style={{display: 'flex', gap: '0.5rem', width: '100%', alignItems: 'center'}}>
                        <input 
                          type="text" 
                          placeholder="e.g. GAMER123" 
                          value={createCodeInput}
                          onChange={(e) => setCreateCodeInput(e.target.value)}
                          style={{
                            background: 'var(--bg-dark)', 
                            border: '1px solid var(--border-color)', 
                            color: 'var(--text-main)', 
                            padding: '0.5rem', 
                            borderRadius: '8px', 
                            flex: '1 1 0%',
                            minWidth: 0,
                            width: '100%'
                          }}
                        />
                        <button className="copy-btn" style={{flexShrink: 0, padding: '0.5rem'}} onClick={handleCreateReferralCode} disabled={!walletConnected}>Create</button>
                      </div>
                    )}
                  </div>
                  
                  <div className="ref-stat-card">
                    <h3>Total Direct Referrals</h3>
                    <div className="ref-stat-value">{directRefs}</div>
                  </div>
                  
                  <div className="ref-stat-card">
                    <h3>Total Secondary Referrals</h3>
                    <div className="ref-stat-value">{secondaryRefs}</div>
                  </div>
                  
                  <div className="ref-stat-card">
                    <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                      <h3>Claimable Commissions</h3>
                      {Number(claimableComms) > 0 && (
                        <button className="copy-btn" style={{background: 'var(--pangs-orange)', color: '#fff', fontWeight: 'bold'}} onClick={handleClaimCommissions}>Claim</button>
                      )}
                    </div>
                    <div className="ref-stat-value" style={{color: 'var(--pangs-orange)'}}>{claimableComms} <span style={{fontSize: '1rem', fontWeight: 'normal'}}>$PANG</span></div>
                  </div>
                </div>
                
                <div className="ref-steps-section">
                  <h3>How to Get Rewards</h3>
                  <div className="ref-steps-grid">
                    <div className="ref-step-card">
                      <div className="ref-step-num">1</div>
                      <h4>Share your Referral</h4>
                      <p>Share your unique referral link with your friends and audience across social media.</p>
                    </div>
                    
                    <div className="ref-step-card">
                      <div className="ref-step-num">2</div>
                      <h4>Sign up, Mint & Race</h4>
                      <p>Invite your friends to mint their Genesis NFT using your link, and encourage them to win races!</p>
                    </div>
                    
                    <div className="ref-step-card">
                      <div className="ref-step-num">3</div>
                      <h4>Earn Passive Income</h4>
                      <p>Earn 10% Direct & 5% Secondary commissions from Minting. <b>PLUS</b>, get a permanent 2% & 1% cut from every Race Prize they win!</p>
                    </div>
                  </div>
                </div>
              </section>
            )}
       </Suspense>
      </main>
    </>
  )
}

export default App
