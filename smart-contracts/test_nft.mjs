import { ethers } from "ethers";
const provider = new ethers.JsonRpcProvider("https://rpc.mainnet.chain.robinhood.com");
const NFT_ADDRESS = '0xf5DaFf515ECfc3928b24367b8A70B5505d89296f';

async function main() {
  const code = await provider.getCode(NFT_ADDRESS);
  console.log("Code length:", code.length);
}
main();
