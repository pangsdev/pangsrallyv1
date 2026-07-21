import { ethers } from "ethers";

async function main() {
  const RPC_URL = "https://rpc.mainnet.chain.robinhood.com";
  const CONTRACT_ADDRESS = "0x091B8d2a77257dC306C5C7F2981E4eC2F4D8e4Af";
  // The user's address from the screenshot: 0x627...fc2c
  const USER_ADDRESS = "0x627290d915aFda37f618FB10b275081D107FFC2c";
  
  const abi = [
    "function tokensOfOwner(address) view returns (uint256[])",
    "function totalSupply() view returns (uint256)"
  ];
  
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const contract = new ethers.Contract(CONTRACT_ADDRESS, abi, provider);

  try {
    const supply = await contract.totalSupply();
    console.log("Total Supply:", supply.toString());
    
    const tokens = await contract.tokensOfOwner(USER_ADDRESS);
    console.log("Tokens owned by", USER_ADDRESS, ":", tokens.map(t => t.toString()));
  } catch(e) {
    console.error("Error reading mapping:", e.message);
  }
}
main();
