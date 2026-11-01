const { ethers } = require("hardhat");
require('dotenv').config({ path: '../.env' });

async function main() {
  const BETA_PASS_ADDRESS = process.env.VITE_BETA_PASS_CONTRACT_ADDRESS || "0x55C18bfaC6A791C88800375C61Aa3B67766Ab288";
  
  const [deployer] = await ethers.getSigners();
  console.log("Updating Beta Pass URI with account:", deployer.address);

  const betaPass = await ethers.getContractAt("PangsRallyBetaPass", BETA_PASS_ADDRESS);

  // New metadata with the premium Beta Pass card image hosted on Pinata
  const NEW_CID = "bafybeieithrryvgrica4exmr4ag5hex3qaf6qbzoa5y3dyrw7en2y6lcai";
  const imageUrl = `https://gateway.pinata.cloud/ipfs/${NEW_CID}`;

  const metadata = {
    name: "Pangs Rally Beta Pass",
    description: "Exclusive Beta Pass for the Pangs Rally On-Chain Racing Game. Holders get access to beta races and earn $PANGS rewards.",
    image: imageUrl,
    attributes: [
      { trait_type: "Edition", value: "Beta" },
      { trait_type: "Type",    value: "Rookie Pangolin" },
      { trait_type: "Body",    value: "Gold" }
    ]
  };

  const jsonStr = JSON.stringify(metadata);
  const base64  = Buffer.from(jsonStr).toString("base64");
  const NEW_URI = `data:application/json;base64,${base64}`;

  console.log("New image URL:", imageUrl);
  console.log("Sending transaction...");

  const tx = await betaPass.setTokenURI(NEW_URI);
  await tx.wait();

  console.log("Beta Pass URI successfully updated with new card image!");
  console.log("Image:", imageUrl);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
