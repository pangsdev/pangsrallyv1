import hardhat from "hardhat";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// .env dosyasını oku
dotenv.config({ path: join(__dirname, '../../.env') });

async function main() {
  const { ethers } = hardhat;
  
  // Hardhat'in ağ ayarlarından signer'ı alalım (genelde ilk hesap)
  const [deployer] = await ethers.getSigners();

  console.log("Deploying contracts with the account:", deployer.address);

  // Gerekli adresleri alalım
  const pangsAddress = process.env.PANGS_TOKEN_ADDRESS;
  const treasuryAddress = process.env.VITE_TREASURY_WALLET_ADDRESS;
  
  // NOTE: OpenSea'den mintlenen Genesis kontratının adresini buraya gireceksiniz
  // Şimdilik test için deployer adresi veya mock bir adres koyabilirsiniz
  const openseaGenesisAddress = "0x0000000000000000000000000000000000000000"; 

  if (!pangsAddress || !treasuryAddress) {
    throw new Error("Missing env variables. Check PANGS_TOKEN_ADDRESS or VITE_TREASURY_WALLET_ADDRESS.");
  }

  console.log("PANGS Token Address:", pangsAddress);
  console.log("Royalty/Treasury Address:", treasuryAddress);
  console.log("Placeholder Genesis Address:", openseaGenesisAddress);

  // 1. PangsRallyGen1 Kontratını Al
  const PangsRallyGen1 = await ethers.getContractFactory("PangsRallyGen1");

  // 2. Deploy (constructor args: pangsToken, genesisContract, royaltyReceiver)
  console.log("Deploying PangsRallyGen1...");
  const pangsRally = await PangsRallyGen1.deploy(
    pangsAddress,
    openseaGenesisAddress,
    treasuryAddress
  );

  // Deploy olmasını bekle
  await pangsRally.waitForDeployment();
  const contractAddress = await pangsRally.getAddress();

  console.log("==========================================");
  console.log("PangsRallyGen1 (Breeding) successfully deployed to:", contractAddress);
  console.log("==========================================");
  
  console.log("\n[!] IMPORTANT: Don't forget to update your .env file!");
  console.log("VITE_CONTRACT_ADDRESS=" + contractAddress);
  console.log("Once you deploy Genesis on OpenSea, call setGenesisContract() on this contract!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
