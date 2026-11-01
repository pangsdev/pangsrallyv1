const { ethers } = require("hardhat");
require('dotenv').config({ path: '../.env' });

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying PangsRallyBetaPass with account:", deployer.address);

  const PANGS_TOKEN_ADDRESS = process.env.PANGS_TOKEN_ADDRESS  || '0x3390d9C9ac5e05D1a6eeAa954808d2784302137c';
  const TREASURY_WALLET     = process.env.TREASURY_WALLET_ADDRESS;
  const INITIAL_OWNER       = deployer.address;

  // Yeni Pinata CID ile premium Beta Pass görsel URI'si
  const NEW_CID   = "bafybeieithrryvgrica4exmr4ag5hex3qaf6qbzoa5y3dyrw7en2y6lcai";
  const imageUrl  = `https://gateway.pinata.cloud/ipfs/${NEW_CID}`;
  const metadata  = {
    name:        "Pangs Rally Beta Pass",
    description: "Exclusive Beta Pass for the Pangs Rally On-Chain Racing Game. Holders get access to beta races and earn $PANGS rewards.",
    image:       imageUrl,
    attributes: [
      { trait_type: "Edition", value: "Beta"            },
      { trait_type: "Type",    value: "Rookie Pangolin" },
      { trait_type: "Body",    value: "Gold"            }
    ]
  };
  const TOKEN_URI = `data:application/json;base64,${Buffer.from(JSON.stringify(metadata)).toString("base64")}`;

  const BetaPass = await ethers.getContractFactory("PangsRallyBetaPass");
  const betaPass = await BetaPass.deploy(
    INITIAL_OWNER,
    PANGS_TOKEN_ADDRESS,
    TREASURY_WALLET,
    TOKEN_URI
  );

  await betaPass.waitForDeployment();
  const address = await betaPass.getAddress();

  console.log("PangsRallyBetaPass deployed to:", address);
  console.log("  Royalty: %5 -> Treasury:", TREASURY_WALLET);
  console.log("  1-per-wallet limit: active");
  console.log("  Image:", imageUrl);
  console.log("\nUpdate VITE_BETA_PASS_CONTRACT_ADDRESS =", address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
