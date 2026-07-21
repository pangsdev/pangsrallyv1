import pkg from 'hardhat';
const { ethers } = pkg;
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying official contract with account:", deployer.address);

  // 1. Get Environment Variables
  const treasuryWallet = process.env.TREASURY_WALLET_ADDRESS;
  const pangsTokenAddress = process.env.PANGS_TOKEN_ADDRESS;

  if (!treasuryWallet) {
    console.error("❌ CRITICAL ERROR: TREASURY_WALLET_ADDRESS is missing in .env");
    process.exit(1);
  }

  if (!pangsTokenAddress) {
    console.error("❌ CRITICAL ERROR: PANGS_TOKEN_ADDRESS is missing in .env");
    console.error("⚠️  Please create the $PANGS token first, then add its address to the .env file.");
    process.exit(1);
  }

  console.log("Treasury Wallet:", treasuryWallet);
  console.log("PANGS Token Address:", pangsTokenAddress);

  // 2. Deploy Contract
  const ContractFactory = await ethers.getContractFactory("PangsRallyOfficial");
  
  console.log("Deploying PangsRallyOfficial...");
  const contract = await ContractFactory.deploy(
    deployer.address,
    pangsTokenAddress,
    treasuryWallet
  );

  await contract.waitForDeployment();
  const address = await contract.getAddress();
  
  console.log("✅ PangsRallyOfficial deployed successfully to:", address);

  // 3. Post-Deployment Instructions
  console.log("\n-------------------------------------------------");
  console.log("🚀 NEXT STEPS FOR ADMIN:");
  console.log("1. Add the BaseURI (IPFS link) using setBaseURI()");
  console.log("2. Set the mint price using setMintPrice()");
  console.log("3. Unpause the minting using setMintActive(true)");
  console.log("-------------------------------------------------");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
