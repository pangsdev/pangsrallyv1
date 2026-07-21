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
      const p1 = await contract.childToParents(6, 0);
      const p2 = await contract.childToParents(6, 1);
      console.log("Token 6 Parents:", p1.toString(), p2.toString());
  } catch(e) {
      console.error("Token 6 error:", e);
  }
  try {
      const p1 = await contract.childToParents(7, 0);
      const p2 = await contract.childToParents(7, 1);
      console.log("Token 7 Parents:", p1.toString(), p2.toString());
  } catch(e) {
      console.error("Token 7 error:", e);
  }
}
main();
