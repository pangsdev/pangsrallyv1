/**
 * reveal_genesis.mjs
 * -------------------
 * Ana koleksiyonu reveal etmek için bu scripti çalıştır.
 *
 * Kullanım:
 *   GENESIS_BASE_URI="https://gateway.pinata.cloud/ipfs/YOUR_CID/" \
 *   npx hardhat run scripts/reveal_genesis.mjs --network robinhood
 *
 * Uyarı: Bu işlem GERİ ALINAMAZ. Contract'ta revealed=true olduktan sonra
 *        reveal() tekrar çağrılamaz. setBaseURI() ile URI güncellenebilir ama
 *        revealed=true kalır.
 */

import hardhat from "hardhat";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
dotenv.config({ path: join(__dirname, "../../.env") });

async function main() {
  const [deployer] = await hardhat.ethers.getSigners();
  const GENESIS_ADDRESS = process.env.VITE_CONTRACT_ADDRESS;
  const BASE_URI        = process.env.GENESIS_BASE_URI;

  if (!GENESIS_ADDRESS) throw new Error("VITE_CONTRACT_ADDRESS not set in .env");
  if (!BASE_URI)         throw new Error("GENESIS_BASE_URI env var required. Set it before running.");

  console.log("Revealing Genesis collection...");
  console.log("  Contract:", GENESIS_ADDRESS);
  console.log("  Base URI:", BASE_URI);
  console.log("  Deployer:", deployer.address);

  const pangsRally = await hardhat.ethers.getContractAt("PangsRally", GENESIS_ADDRESS);

  // Mevcut state kontrolü
  const alreadyRevealed = await pangsRally.revealed();
  if (alreadyRevealed) {
    console.error("Contract is already revealed! Use setBaseURI() to update URI if needed.");
    process.exit(1);
  }

  const currentSupply = await pangsRally.totalSupply();
  console.log(`  Current supply: ${currentSupply} NFTs`);

  console.log("\nSending reveal transaction...");
  const tx = await pangsRally.reveal(BASE_URI);
  await tx.wait();

  console.log("\n=== REVEAL SUCCESSFUL ===");
  console.log("All", currentSupply.toString(), "Pangolins are now revealed!");
  console.log("Token 1 URI example:", BASE_URI + "1.json");
  console.log("\nOpenSea and all platforms will now show real attributes.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
