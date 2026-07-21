import { useState, useEffect, useRef } from 'react';
import { ethers } from 'ethers';
import PangsRallyContract from './PangsRally.json';
import rarityData from './rarity-data.json';
import seedrandom from 'seedrandom';
import { MARKETPLACE_ADDRESS, MARKETPLACE_ABI, RACING_ADDRESS, RACING_ABI, PANGS_TOKEN_ADDRESS, ERC20_ABI } from './contracts';
import './App.css'
import Litepaper from './components/Litepaper';

const CONTRACT_ADDRESS = "0xf5DaFf515ECfc3928b24367b8A70B5505d89296f";

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
  useEffect(() => {
    const timer = setTimeout(onClose, 5000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const bgColor = type === 'success' ? 'linear-gradient(135deg, #00ff88, #00cc6a)' : type === 'error' ? 'linear-gradient(135deg, #ff4466, #cc0033)' : 'linear-gradient(135deg, #6c5ce7, #a29bfe)';
  return (
    <div style={{position: 'fixed', top: '90px', right: '20px', zIndex: 10000, background: bgColor, color: 'white', padding: '1rem 1.5rem', borderRadius: '12px', boxShadow: '0 8px 32px rgba(0,0,0,0.3)', maxWidth: '400px', animation: 'slideInRight 0.3s ease', display: 'flex', alignItems: 'center', gap: '12px', backdropFilter: 'blur(10px)'}}>
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
  } catch (e) {
    return "/pangolin_sprite.png";
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
  const [currentView, setCurrentView] = useState<'landing' | 'how-to-play' | 'laboratory' | 'rally' | 'room-browser' | 'race-room' | 'live-race' | 'inventory' | 'marketplace' | 'leaderboard' | 'my-races' | 'referral'>('landing');
  
  // Initialize theme from localStorage or default to 'light'
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const savedTheme = localStorage.getItem('pangsRallyTheme');
    return (savedTheme as 'dark' | 'light') || 'light';
  });

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

  // Hero Image Cycler
  const [heroImageIndex, setHeroImageIndex] = useState(1);

  useEffect(() => {
    const interval = setInterval(() => {
      setHeroImageIndex(prev => (prev % 1000) + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Live Race State
  const [activeCategoryInfo, setActiveCategoryInfo] = useState<any>(null); // Selected from Rally Lobby
  const [isSelectingRaceNft, setIsSelectingRaceNft] = useState<boolean>(false);
  const [selectedRacingNft, setSelectedRacingNft] = useState<any>(null);
  
  // Inventory & Marketplace State
  const [inventoryFilter, setInventoryFilter] = useState('All');
  const [playerBalance, setPlayerBalance] = useState('0.00');
  const [pangsBalance, setPangsBalance] = useState('0.00');
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

  // Leaderboard State
  // (Leaderboard coming soon)

  // My Races State (Replays)
  const [myRaces, setMyRaces] = useState<any[]>([]);

  useEffect(() => {
    if (currentView === 'my-races') {
      fetch('http://localhost:3001/api/race/history')
        .then(res => res.json())
        .then(data => setMyRaces(data))
        .catch(err => console.error("Error fetching races:", err));
    }
  }, [currentView]);

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
          
          try {
            const pangsContract = new ethers.Contract(PANGS_TOKEN_ADDRESS, ERC20_ABI, provider);
            const pBalance = await pangsContract.balanceOf(accounts[0]);
            const pDecimals = await pangsContract.decimals();
            setPangsBalance(Number(ethers.formatUnits(pBalance, pDecimals)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
            
            // Fetch Referral Stats
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
            
          } catch (err) {
            console.error("Failed to fetch PANGS balance", err);
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

  // Apply Theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('pangsRallyTheme', theme);
  }, [theme]);

  // Auto-reconnect wallet on page load
  useEffect(() => {
    const savedAddress = localStorage.getItem('pangsRallyWallet');
    if (savedAddress && (window as any).ethereum) {
      (async () => {
        try {
          const provider = new ethers.BrowserProvider((window as any).ethereum);
          const accounts = await provider.send('eth_accounts', []);
          if (accounts.length > 0) {
            const addr = accounts[0];
            setWalletConnected(true);
            setFullWalletAddress(addr);
            setWalletAddress(`${addr.substring(0, 5)}...${addr.substring(addr.length - 4)}`);
            fetchMyNFTs(addr);
          }
        } catch (e) {
          console.error('Auto-reconnect failed:', e);
        }
      })();
    }
  }, []);

  const showToast = (message: string, type: 'success'|'error'|'info' = 'info') => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message, type }]);
  };

  const removeToast = (id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

  const fetchMyNFTs = async (address: string) => {
    setIsFetchingNFTs(true);
    try {
      const provider = new ethers.BrowserProvider((window as any).ethereum);
      const contract = new ethers.Contract(CONTRACT_ADDRESS, PangsRallyContract.abi, provider);
      
      const tokens = await contract.tokensOfOwner(address);
      const nfts = [];
      
      for(let i=0; i<tokens.length; i++) {
        const tokenId = tokens[i];
        const tokenIdStr = tokenId.toString();
        
        try {
          const metadataUrl = `${window.location.origin}/api/metadata/${tokenIdStr}`;
          
          let metadata = { name: `Pangs Rally #${tokenIdStr}`, image: ``, attributes: [] as any[] };
          try {
            const res = await fetch(metadataUrl);
            if (res.ok) {
              const text = await res.text();
              if (text.startsWith('{')) {
                metadata = JSON.parse(text);
              } else {
                // Local dev fallback
                const fallbackRes = await fetch(`/metadata/${tokenIdStr}.json`);
                if (fallbackRes.ok) metadata = await fallbackRes.json();
              }
            } else {
              const fallbackRes = await fetch(`/metadata/${tokenIdStr}.json`);
              if (fallbackRes.ok) metadata = await fallbackRes.json();
            }
          } catch(e) {
            try {
              const fallbackRes = await fetch(`/metadata/${tokenIdStr}.json`);
              if (fallbackRes.ok) metadata = await fallbackRes.json();
            } catch(e2) {
              // ignore
            }
          }
          
          const getTrait = (name: string) => metadata.attributes.find((a: any) => a.trait_type === name)?.value || null;
          
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
          } else if (!imageUrl) {
              imageUrl = `nft-images/${tokenIdStr}.png`;
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
             endurance: 50,
             level: 1,
             bodyColor: getTrait('Body') || 'Default',
             breedCount: Number(bCount)
          });
        } catch (fetchErr) {
          console.error("Critical error building token object for", tokenId, fetchErr);
        }
      }
      setMyNFTs(nfts);
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

  const connectWallet = async () => {
    if (typeof (window as any).ethereum !== 'undefined') {
      try {
        const provider = new ethers.BrowserProvider((window as any).ethereum);
        
        // Add Robinhood Mainnet automatically for the user
        try {
          await provider.send('wallet_switchEthereumChain', [{ chainId: '0x1237' }]);
        } catch (switchError: any) {
          if (switchError.code === 4902) {
            await provider.send('wallet_addEthereumChain', [{
              chainId: '0x1237',
              chainName: 'Robinhood Chain',
              rpcUrls: ['https://rpc.mainnet.chain.robinhood.com'],
              nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }
            }]);
          }
        }

        const accounts = await provider.send("eth_requestAccounts", []);
        if (accounts.length > 0) {
          setWalletConnected(true);
          const address = accounts[0];
          setFullWalletAddress(address);
          setWalletAddress(`${address.substring(0, 5)}...${address.substring(address.length - 4)}`);
          localStorage.setItem('pangsRallyWallet', address);
          
          // Fetch NFTs
          fetchMyNFTs(address);
        }
      } catch (error) {
        console.error("Wallet connection failed:", error);
        showToast('Wallet connection failed. Please try again.', 'error');
      }
    } else {
      showToast('No Web3 wallet detected. Please install MetaMask or Rabby.', 'error');
    }
  };

  const mintNFT = async () => {
    if (!walletConnected) {
      showToast('Please connect your wallet first!', 'error');
      return;
    }
    try {
      const provider = new ethers.BrowserProvider((window as any).ethereum);
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(CONTRACT_ADDRESS, PangsRallyContract.abi, signer);
      
      const referrerCodeOrAddr = localStorage.getItem('pangsrally_referrer') || '';
      let referrerAddress = ethers.ZeroAddress;
      
      if (referrerCodeOrAddr) {
        if (referrerCodeOrAddr.startsWith('0x') && referrerCodeOrAddr.length === 42) {
            referrerAddress = referrerCodeOrAddr;
        } else {
            const resolved = await contract.codeToAddress(referrerCodeOrAddr);
            if (resolved !== ethers.ZeroAddress) {
                referrerAddress = resolved;
            }
        }
      }
      
      const price = await contract.mintPrice();
      const pangsContract = new ethers.Contract(PANGS_TOKEN_ADDRESS, [
        "function allowance(address owner, address spender) view returns (uint256)",
        "function approve(address spender, uint256 amount) returns (bool)"
      ], signer);
      
      const allowance = await pangsContract.allowance(signer.address, CONTRACT_ADDRESS);
      if (allowance < price) {
        showToast('Approving $PANGS for mint...', 'info');
        const txApprove = await pangsContract.approve(CONTRACT_ADDRESS, price);
        await txApprove.wait();
      }
      
      const tx = await contract.mint(1, referrerAddress);
      showToast('Mint transaction submitted! Waiting for confirmation...', 'info');
      
      await tx.wait();
      showToast('Mint successful! Your new Pangolin has joined the rally! 🎉', 'success');
      
      // Refresh NFTs
      fetchMyNFTs(signer.address);
    } catch (err: any) {
      console.error(err);
      showToast(err.reason || 'Minting failed.', 'error');
    }
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
    { id: 'cat1', name: 'Class 5', terrain: 'Forest', icon: '🌲', entry: 'Locked', prize: '? $PANGS', color: '#b8ce55', bgClass: 'bg-forest' },
    { id: 'cat2', name: 'Class 4', terrain: 'Desert', icon: '🏜️', entry: 'Locked', prize: '? $PANGS', color: '#e67e22', bgClass: 'bg-desert' },
    { id: 'cat3', name: 'Class 3', terrain: 'Volcanic', icon: '🌋', entry: 'Locked', prize: '? $PANGS', color: '#e74c3c', bgClass: 'bg-volcanic' },
    { id: 'cat4', name: 'Class 2', terrain: 'Midnight', icon: '🌙', entry: 'Locked', prize: '? $PANGS', color: '#9b59b6', bgClass: 'bg-midnight' },
  ];

  const viewRooms = (category: any) => {
    setActiveCategoryInfo(category);
    setCurrentView('room-browser');
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
      const randImg = Math.floor(randomFn() * 990) + 10;
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
        const prizeNum = parseFloat(activeRaceInfo.prize.split(' ')[0]);
        const calculatedPrize = isPlayerRacer.position === 1 ? prizeNum * 0.5 : isPlayerRacer.position === 2 ? prizeNum * 0.3 : isPlayerRacer.position === 3 ? prizeNum * 0.2 : 0;
        const newRaceRecord = {
          id: Date.now(),
          map: activeRaceInfo.terrain,
          class: activeRaceInfo.class,
          status: 'Completed',
          position: isPlayerRacer.position,
          prize: isPlayerRacer.position <= 3 ? `${calculatedPrize.toFixed(4)} ETH` : '-',
          racersSnapshot: racers.map(r => ({...r}))
        };
        setMyRaces(prev => [newRaceRecord, ...prev]);
      }
    }
  }, [raceStatus, isReplayMode, activeRaceInfo]);

  const [isJoiningRace, setIsJoiningRace] = useState(false);
  const [isClaimingPrize, setIsClaimingPrize] = useState(false);

  const handleClaimPrize = async (position: number) => {
    if (!(window as any).ethereum) return;
    setIsClaimingPrize(true);
    
    // Prize pool = entry fees collected. Currently 1 real player × 0.0001 ETH = 0.0001 pool
    // Top 3 positions: 50% for 1st, 30% for 2nd, 20% for 3rd (after 10% platform fee)
    // Net pool = 0.0001 × 0.9 = 0.00009 ETH
    let ethAmount = "0";
    if (position === 1) ethAmount = "0.000045";      // ~50% of net pool
    else if (position === 2) ethAmount = "0.000027";  // ~30% of net pool
    else if (position === 3) ethAmount = "0.000018";  // ~20% of net pool
    else {
      showToast("You are not in the top 3!", "error");
      setIsClaimingPrize(false);
      return;
    }

    try {
      const provider = new ethers.BrowserProvider((window as any).ethereum);
      const signer = await provider.getSigner();
      const playerAddress = signer.address;
      
      showToast("Requesting authorization from server...", "info");
      
      // Request signature from backend
      const res = await fetch('http://localhost:3001/api/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerAddress, amount: ethAmount })
      });
      
      if (!res.ok) {
        throw new Error("Failed to get authorization from server");
      }
      
      const { amountWei, nonce, signature } = await res.json();
      
      const raceContract = new ethers.Contract(RACING_ADDRESS, RACING_ABI, signer);
      
      showToast("Confirming on blockchain...", "info");
      // Call the secure claim function on the smart contract
      const tx = await raceContract.claimPrize(amountWei, nonce, signature);
      await tx.wait();
      
      showToast(`Top ${position} Prize (${ethAmount} ETH) claimed successfully!`, "success");
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
      if (!(window as any).ethereum) return;
      setIsJoiningRace(true);
      try {
        const provider = new ethers.BrowserProvider((window as any).ethereum);
        const signer = await provider.getSigner();
        const playerAddress = signer.address;
        const raceContract = new ethers.Contract(RACING_ADDRESS, RACING_ABI, signer);
        
        showToast("Joining race...", "info");
        const entryFee = ethers.parseEther("0.0001");
        
        // Ensure roomId is an integer since mock ids are like 'cat1'
        const roomIdStr = activeRaceInfo?.id ? String(activeRaceInfo.id).replace(/\D/g, '') : '1';
        const roomId = parseInt(roomIdStr) || 1;
        
        const tx = await raceContract.joinRace(roomId, selectedRacingNft.tokenId, { value: entryFee });
        await tx.wait();
        showToast("Successfully joined on-chain!", "success");

        // Now register with backend to get deterministic seed
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 1500);
          const res = await fetch('http://localhost:3001/api/race/join', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerAddress, map: activeRaceInfo.terrain, nftData: selectedRacingNft }),
            signal: controller.signal
          });
          clearTimeout(timeoutId);
          const data = await res.json();
          prngRef.current = seedrandom(data.seed);
        } catch(backendErr) {
          console.warn('Backend unavailable, using local seed:', backendErr);
          const fallbackSeed = `${playerAddress}-${Date.now()}-${Math.random()}`;
          prngRef.current = seedrandom(fallbackSeed);
        }
      } catch(e: any) {
        console.error(e);
        showToast(e.reason || "Failed to join race", "error");
        setIsJoiningRace(false);
        return;
      }
      setIsJoiningRace(false);
    }
    
    setIsReplayMode(isReplay);
    setHasPlayerJoined(true);
    setCurrentView('live-race');
    setRaceStatus('waiting');
    
    // Generate racers deterministically using the seed (works for both live and replay)
    setCameraProgress(0);
    const randomFn = prngRef.current || Math.random;
    
    const fetchBotSpriteForSeed = async (botTokenId: number): Promise<string> => {
        return await fetchBotBodyColor(botTokenId);
    };
    
    // Create player racer object
    const playerRacer = {
      id: 1,
      name: selectedRacingNft.name || 'Replay Racer',
      distance: 0,
      speed: 0,
      targetSpeed: (selectedRacingNft.speed || 50) + Math.floor(randomFn() * 20),
      position: 1,
      image: selectedRacingNft.image || `nft-images/${selectedRacingNft.tokenId || 1}.webp`,
      avatar: selectedRacingNft.avatar || `nft-images/${selectedRacingNft.tokenId || 1}.webp`,
      sprite: getBodySpriteFromAttributes(selectedRacingNft.attributes || []),
      isPlayer: true,
      finishTime: null
    };
    
    const newBots = [];
    for (let i = 0; i < 9; i++) {
      const randImg = Math.floor(randomFn() * 990) + 10;
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
      {toasts.map(toast => (
        <Toast key={toast.id} message={toast.message} type={toast.type} onClose={() => removeToast(toast.id)} />
      ))}

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

      <header className="app-header">
        <div className="container header-container">
          <div className="logo" onClick={() => setCurrentView('landing')} style={{cursor: 'pointer', display: 'flex', alignItems: 'center'}}>
            <img src={theme === 'light' ? "/light-logo.png" : "/dark-logo.png"} alt="Pangs Rally Logo" className="logo-img" />
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
              My Races
            </a>
            <a 
              className={currentView === 'referral' ? 'active' : ''} 
              onClick={() => setCurrentView('referral')}
              style={{cursor: 'pointer', color: 'var(--pangs-orange)'}}
            >
              Refer & Earn
            </a>
          </nav>
          <div className="header-actions" style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
            <button className="theme-toggle" onClick={toggleTheme} aria-label="Toggle Theme">
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
            {walletConnected ? (
              <div 
                className="wallet-connected-badge glass-panel" 
                onClick={() => {
                  setWalletConnected(false);
                  setWalletAddress('');
                  setMyNFTs([]);
                  setUserReferralCode('');
                  showToast('Wallet disconnected', 'info');
                }}
                title="Click to disconnect"
                style={{ cursor: 'pointer' }}
              >
                  <span className="wallet-dot"></span>
                  {walletAddress}
              </div>
            ) : (
              <button className="btn btn-primary" onClick={connectWallet}>Connect Wallet</button>
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
        {currentView === 'landing' && (
          <>
            <section className="hero-section">
              <div className="container">
                <div className="hero-content">
                  <h1 className="hero-title">
                    Race. Breed. <br />
                    <span className="text-gradient">Dominate the Track.</span>
                  </h1>
                  <p className="hero-subtitle">
                    Collect unique Pangolin NFTs, strategize your traits for different terrains, and race to earn $PANG in the ultimate Web3 auto-racing experience.
                  </p>
                  <div className="hero-actions">
                    <button className="btn btn-primary" onClick={mintNFT} disabled style={{ opacity: 0.5, cursor: 'not-allowed', background: '#333' }}>Mint Locked 🔒</button>
                    <a href="https://app.virtuals.io/virtuals/115020" target="_blank" rel="noopener noreferrer" className="btn btn-outline" style={{ borderColor: 'var(--pangs-orange)', color: 'var(--pangs-orange)', textDecoration: 'none' }}>Trade $PANGS</a>
                    <button className="btn btn-outline" onClick={() => setCurrentView('rally')}>Enter Game</button>
                  </div>
                  <p style={{ marginTop: '1rem', color: 'var(--pangs-orange)', fontWeight: 'bold', fontSize: '0.9rem' }}>
                    * Minting will begin after the $PANGS Token Launch.
                  </p>
                </div>
                <div className="hero-image-container">
                  <div className="placeholder-pangolin">
                    <img src={`/nft-images/${heroImageIndex}.webp`} alt="Pangolin NFT" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </div>
                </div>
              </div>
            </section>

            <section className="features-section" id="features">
              <div className="container">
                <h2 className="section-title">Core Mechanics</h2>
                <div className="features-grid">
                  <div className="feature-card glass-panel">
                    <div className="feature-icon">🏁</div>
                    <h3 className="feature-title">The Rally</h3>
                    <p className="feature-desc">
                      Enter daily missions or competitive races. Match your Pangolin's terrain traits to the track for a massive advantage.
                    </p>
                  </div>
                  <div className="feature-card glass-panel">
                    <div className="feature-icon">🧬</div>
                    <h3 className="feature-title">The Laboratory</h3>
                    <p className="feature-desc">
                      Breed your Pangolins to create powerful offspring. Pass down rare traits and aim for the elusive Mythic rarity.
                    </p>
                  </div>
                  <div className="feature-card glass-panel">
                    <div className="feature-icon">⚡</div>
                    <h3 className="feature-title">Level & Progress</h3>
                    <p className="feature-desc">
                      Gain experience by dominating the tracks. Pay a $PANGS fee to Level Up your Pangolin and unlock permanent racing advantages.
                    </p>
                  </div>
                </div>
              </div>
            </section>
          </>
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
                          <span className="terrain-icon">{cat.icon}</span>
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
                        🔒 Locked
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
                    {isTop3 && (
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
                <div style={{ textAlign: 'center', padding: '3rem', width: '100%', gridColumn: '1 / -1' }}>
                  <h3>No Pangolins found!</h3>
                  <p>Go to the Home page to get your first racer.</p>
                </div>
              ) : (
                filteredInventory.map(nft => (
                  <div key={nft.id} className="inventory-card glass-panel">
                    <div className="inv-card-header">
                      <span className="inv-id">{nft.id}</span>
                      <span className="lvl-badge">LVL {nft.level}</span>
                      <span className={`badge rarity-${nft.rarity?.toLowerCase() || 'common'}`}>{nft.rarity || 'Common'}</span>
                    </div>
                    <div className="inv-card-image" style={{cursor: 'pointer'}} onClick={() => setExpandedImage(nft.avatar.startsWith('http') ? nft.avatar : `/${nft.avatar}`)}>
                      <TransparentImage src={nft.avatar.startsWith('http') ? nft.avatar : `/${nft.avatar}`} alt={nft.name} />
                    </div>
                    <div className="inv-card-body">
                      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                        <h3 style={{margin: 0}}>{nft.name}</h3>
                        {walletConnected && nft.tokenId && (
                          <button onClick={() => handleRename(nft.tokenId, nft.name)} style={{background: 'transparent', border: '1px solid var(--primary)', color: 'var(--primary)', padding: '2px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '10px'}}>Rename</button>
                        )}
                      </div>
                      <span className="badge trait-badge" style={{marginTop: '0.5rem', display: 'inline-block'}}>{nft.trait}</span>
                      
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
                  <span>$PANGS: <strong style={{color: 'var(--pangs-orange)', fontSize: '1.5rem'}}>{pangsBalance}</strong></span>
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
          <section className="leaderboard-section" style={{ paddingTop: '140px', minHeight: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            <div className="container" style={{ textAlign: 'center' }}>
              <h1 className="section-title" style={{ fontSize: '4rem', color: 'var(--primary)' }}>Coming Soon</h1>
              <p className="text-muted" style={{ fontSize: '1.5rem', marginTop: '1rem' }}>Global Leaderboards and Seasonal Rewards are currently under construction.</p>
              <button 
                className="btn btn-primary" 
                style={{ marginTop: '2rem' }}
                onClick={() => setCurrentView('landing')}
              >
                Back to Home
              </button>
            </div>
          </section>
        )}

        {currentView === 'my-races' && (
          <section className="inventory-page animated-enter">
            <div className="inventory-header-bar">
              <h2>My Races (Race History)</h2>
              <div className="inventory-stats">
                <span>Total Races: <strong style={{color: 'var(--primary)'}}>{myRaces.length}</strong></span>
              </div>
            </div>
            
            <div className="leaderboard-list glass-panel" style={{marginTop: '2rem'}}>
              <div className="lb-list-header" style={{gridTemplateColumns: '1fr 2fr 1fr 1fr 1fr 1fr'}}>
                <div>Race ID</div>
                <div>Map</div>
                <div>Status</div>
                <div>Position</div>
                <div>Reward</div>
                <div>Action</div>
              </div>
              {walletConnected ? (
                <>
                  {myRaces.map((race) => (
                    <div key={race.id} className="lb-list-row" style={{gridTemplateColumns: '1fr 2fr 1fr 1fr 1fr 1fr'}}>
                      <div style={{fontWeight: 'bold', color: 'var(--text-muted)'}}>{race.id}</div>
                      <div>{race.map} <span style={{fontSize: '0.8rem', color: 'var(--text-muted)'}}>({race.participants}/10)</span></div>
                      <div>
                        {race.status === 'completed' ? (
                          <span className="badge" style={{background: 'rgba(0, 255, 136, 0.2)', color: 'var(--color-success)'}}>Completed</span>
                        ) : (
                          <span className="badge" style={{background: 'rgba(255, 215, 0, 0.2)', color: '#ffd700'}}>Pending</span>
                        )}
                      </div>
                      <div style={{fontWeight: 'bold'}}>{race.position}</div>
                      <div style={{color: '#ffd700', fontWeight: 'bold'}}>{race.reward}</div>
                      <div>
                        {race.status === 'completed' && (
                          <button 
                            className="btn btn-outline" 
                            style={{padding: '0.5rem 1rem', fontSize: '0.9rem'}}
                            onClick={() => {
                              setActiveRaceInfo({ terrain: race.map, class: 'Replay' });
                              prngRef.current = seedrandom(race.seed);
                              // We need a dummy racer to watch
                              setSelectedRacingNft({
                                tokenId: 1, name: 'Replay Racer', speed: 50, attributes: [], image: 'nft-images/1.webp'
                              });
                              startRaceSimulation(true); // Pass true to enable replay mode
                            }}
                          >
                            Watch Replay
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  {myRaces.length === 0 && (
                    <div style={{padding: '3rem', textAlign: 'center', color: 'var(--text-muted)'}}>
                      You haven't participated in any races yet.
                    </div>
                  )}
                </>
              ) : (
                <div style={{padding: '3rem', textAlign: 'center', color: 'var(--text-muted)'}}>
                  Please connect your wallet to view your race history.
                </div>
              )}
            </div>
          </section>
        )}

        {currentView === 'laboratory' && (
          <section className="laboratory-section">
            <div className="container">
              <div className="lab-header">
                <h1 className="section-title">The Laboratory</h1>
                <p className="text-muted">Select two Pangolins to incubate a new egg. Breeding costs $PANGS and requires both parents to be off cooldown.</p>
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
                      {parentA && parentB ? '? $PANGS' : '? $PANGS'}
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
                  <p>Invite your friends, share the Rally, and earn $PANGS commissions directly to your wallet.</p>
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
                    <div className="ref-stat-value" style={{color: 'var(--pangs-orange)'}}>{claimableComms} <span style={{fontSize: '1rem', fontWeight: 'normal'}}>$PANGS</span></div>
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

      </main>
    </>
  )
}

export default App
