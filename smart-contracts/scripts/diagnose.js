import { ethers } from "ethers";
import fs from "fs";

const CONTRACT_ADDRESS = "0x71323a359206512CeceE8586b957E61CDA87DF22";
const WALLET = "0x627290d915aFda37f618FB10b275081D107FFC2c";
const RPC = "https://rpc.mainnet.chain.robinhood.com";

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  
  // Load ABI
  const artifact = JSON.parse(fs.readFileSync("artifacts/contracts/PangsRally.sol/PangsRally.json", "utf8"));
  const contract = new ethers.Contract(CONTRACT_ADDRESS, artifact.abi, provider);

  console.log("=== PANGSRALLY V3 DIAGNOSTIC ===");
  console.log("Contract:", CONTRACT_ADDRESS);
  console.log("Wallet:", WALLET);
  console.log("");

  // 1. Basic contract info
  try {
    const name = await contract.name();
    const symbol = await contract.symbol();
    const totalSupply = await contract.totalSupply();
    const maxSupply = await contract.MAX_SUPPLY();
    const isSaleActive = await contract.isSaleActive();
    const mintPrice = await contract.mintPrice();
    console.log("1. Contract Info:");
    console.log("   Name:", name);
    console.log("   Symbol:", symbol);
    console.log("   Total Supply:", totalSupply.toString());
    console.log("   Max Supply:", maxSupply.toString());
    console.log("   Sale Active:", isSaleActive);
    console.log("   Mint Price:", ethers.formatEther(mintPrice), "ETH");
  } catch (e) {
    console.log("1. ERROR reading basic info:", e.message);
  }

  // 2. Check balance of wallet
  try {
    const balance = await contract.balanceOf(WALLET);
    console.log("\n2. NFT Balance of wallet:", balance.toString());
  } catch (e) {
    console.log("\n2. ERROR checking balance:", e.message);
  }

  // 3. Try tokensOfOwner (ERC721AQueryable)
  try {
    const tokens = await contract.tokensOfOwner(WALLET);
    console.log("\n3. Tokens owned:", tokens.map(t => t.toString()));
    
    // 4. For each token, get tokenURI
    for (const tokenId of tokens) {
      try {
        const uri = await contract.tokenURI(tokenId);
        console.log(`\n4. Token #${tokenId} URI:`, uri);
        
        // 5. Try to fetch the metadata from IPFS
        const httpUri = uri.replace("ipfs://", "https://gateway.lighthouse.storage/ipfs/");
        console.log("   HTTP URL:", httpUri);
        
        const res = await fetch(httpUri);
        console.log("   Fetch Status:", res.status);
        if (res.ok) {
          const metadata = await res.json();
          console.log("   Name:", metadata.name);
          console.log("   Image:", metadata.image);
          console.log("   Attributes count:", metadata.attributes?.length);
        } else {
          console.log("   Fetch FAILED. Response:", await res.text());
        }
      } catch (e) {
        console.log(`   ERROR for token #${tokenId}:`, e.message);
      }
    }
  } catch (e) {
    console.log("\n3. ERROR with tokensOfOwner:", e.message);
  }

  // 5. Try _startTokenId
  try {
    // We can't call internal functions directly, but let's check token 0 and 1
    console.log("\n5. Token existence checks:");
    for (const id of [0, 1, 2]) {
      try {
        const owner = await contract.ownerOf(id);
        console.log(`   Token #${id}: owned by ${owner}`);
      } catch (e) {
        console.log(`   Token #${id}: does NOT exist`);
      }
    }
  } catch (e) {
    console.log("5. ERROR:", e.message);
  }
  
  // 6. Check baseURI by checking tokenURI of token 1 (if exists)
  try {
    const uri1 = await contract.tokenURI(1);
    console.log("\n6. tokenURI(1):", uri1);
  } catch(e) {
    console.log("\n6. tokenURI(1) ERROR:", e.message);
  }
}

main().catch(console.error);
