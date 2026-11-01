const { ethers } = require("hardhat");
require('dotenv').config({ path: '../.env' });
const fs = require('fs');
const path = require('path');

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Starting Beta Pass Airdrop with account:", deployer.address);

  const BETA_PASS_ADDRESS = process.env.VITE_BETA_PASS_CONTRACT_ADDRESS;
  if (!BETA_PASS_ADDRESS) {
    throw new Error("VITE_BETA_PASS_CONTRACT_ADDRESS is not set in .env");
  }
  
  console.log("Beta Pass Contract Address:", BETA_PASS_ADDRESS);

  const betaPass = await ethers.getContractAt("PangsRallyBetaPass", BETA_PASS_ADDRESS);

  // Airdrop listesini JSON dosyasından okuyalım
  const listPath = path.join(__dirname, 'airdrop_list.json');
  
  if (!fs.existsSync(listPath)) {
    console.error(`\nHATA: Airdrop listesi bulunamadi! Lutfen ${listPath} dosyasini olusturun.`);
    console.error(`Ornek icerik:\n[\n  "0x123...",\n  "0xabc..."\n]`);
    process.exit(1);
  }

  const rawData = fs.readFileSync(listPath);
  let recipients = JSON.parse(rawData);

  console.log(`\nToplam ${recipients.length} adres bulundu. Airdrop islemine baslaniyor...`);

  // Eger cok fazla adres varsa gas limiti asilmamasi icin 50'lik parcalara bolelim
  const chunkSize = 50;
  for (let i = 0; i < recipients.length; i += chunkSize) {
    const chunk = recipients.slice(i, i + chunkSize);
    console.log(`  [Batch ${i / chunkSize + 1}] Gonderilen adres sayisi: ${chunk.length}...`);
    
    try {
      const tx = await betaPass.airdrop(chunk);
      await tx.wait();
      console.log(`  [Batch ${i / chunkSize + 1}] Basarili! Hash: ${tx.hash}`);
    } catch (error) {
      console.error(`  [Batch ${i / chunkSize + 1}] HATA: Airdrop sirasinda bir sorun olustu:`, error.message);
    }
  }

  console.log("\nAirdrop islemi tamamlandi! 🚀");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
