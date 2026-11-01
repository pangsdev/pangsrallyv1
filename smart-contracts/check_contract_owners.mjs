import { ethers } from "ethers";
const provider = new ethers.JsonRpcProvider("https://rpc.mainnet.chain.robinhood.com");
const RACING_ABI = [{"inputs":[],"name":"owner","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"}];
const RACING_ADDRESS = '0xB2e3B007ef89d44De33a489627b07eA77b7EAAa1';
const NFT_ADDRESS = '0xf5DaFf515ECfc3928b24367b8A70B5505d89296f';

async function main() {
  const racing = new ethers.Contract(RACING_ADDRESS, RACING_ABI, provider);
  const nft = new ethers.Contract(NFT_ADDRESS, RACING_ABI, provider);
  console.log("Racing owner:", await racing.owner());
  console.log("NFT owner:", await nft.owner());
}
main();
