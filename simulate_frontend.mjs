import { ethers } from "ethers";
import fs from "fs";

async function main() {
  const RPC_URL = "https://rpc.mainnet.chain.robinhood.com";
  const CONTRACT_ADDRESS = "0x091B8d2a77257dC306C5C7F2981E4eC2F4D8e4Af";
  const USER_ADDRESS = "0x627290d915aFda37f618FB10b275081D107FFC2c";
  
  // Read ABI
  const abiRaw = fs.readFileSync("/Users/macintoshi/Desktop/ai-agents/pangsrally/src/PangsRally.json", "utf8");
  const PangsRallyContract = JSON.parse(abiRaw);
  
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const contract = new ethers.Contract(CONTRACT_ADDRESS, PangsRallyContract.abi, provider);

  try {
    const tokens = await contract.tokensOfOwner(USER_ADDRESS);
    console.log("Tokens:", tokens.map(t => t.toString()));
    
    for (let i = 0; i < tokens.length; i++) {
        const tokenId = tokens[i];
        console.log(`Processing token ${tokenId}...`);
        
        let onChainName = await contract.pangolinNames(tokenId);
        console.log(`Name: ${onChainName}`);
        
        let bCount = await contract.breedCount(tokenId);
        console.log(`BreedCount: ${bCount.toString()}`);
    }
  } catch(e) {
    console.error("Simulation failed:", e);
  }
}
main();
