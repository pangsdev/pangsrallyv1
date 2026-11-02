/**
 * Deploys PangsRallyBeta (test season pass: free, gas only, voucher-gated).
 * NOT run automatically — it spends real gas on Robinhood Chain from DEV_WALLET_PRIVATE_KEY.
 *
 *   BETA_SIGNER_ADDRESS=0x...  BETA_TOKEN_URI=ipfs://<metadata CID>  \
 *     npx hardhat run scripts/deploy_beta_season.cjs --network robinhood
 *
 * BETA_SIGNER_ADDRESS: address of the server key (BETA_SIGNER_KEY, a Supabase function secret).
 * BETA_TOKEN_URI: metadata JSON (name, description, image = design/beta-nft/beta-lavender.png on IPFS).
 * Royalty (5%) goes to TREASURY_WALLET_ADDRESS, or the deployer if unset.
 */
const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const signer = process.env.BETA_SIGNER_ADDRESS;
  const uri = process.env.BETA_TOKEN_URI;
  if (!ethers.isAddress(signer || "")) throw new Error("Set BETA_SIGNER_ADDRESS");
  if (!uri) throw new Error("Set BETA_TOKEN_URI");
  const royalty = process.env.TREASURY_WALLET_ADDRESS || deployer.address;

  console.log("Deployer:", deployer.address, "| voucher signer:", signer, "| royalty to:", royalty);
  const Beta = await ethers.getContractFactory("PangsRallyBeta");
  const beta = await Beta.deploy(deployer.address, signer, royalty, uri);
  await beta.waitForDeployment();
  console.log("PangsRallyBeta deployed to:", await beta.getAddress());
  console.log("Next: supabase secrets set BETA_CONTRACT=<address> BETA_SIGNER_KEY=<server key>");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
