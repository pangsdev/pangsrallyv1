import { ethers } from "ethers";

async function main() {
  const RPC_URL = "https://rpc.mainnet.chain.robinhood.com";
  const CONTRACT_ADDRESS = "0x091B8d2a77257dC306C5C7F2981E4eC2F4D8e4Af";
  
  const abi = [
    "function childToParents(uint256, uint256) view returns (uint256)"
  ];
  
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const contract = new ethers.Contract(CONTRACT_ADDRESS, abi, provider);

  try {
    const parent1 = await contract.childToParents(1, 0);
    const parent2 = await contract.childToParents(1, 1);
    console.log("Parents for 1:", parent1.toString(), parent2.toString());
  } catch(e) {
    console.error("Error reading mapping:", e.message);
  }
}
main();
