const { ethers } = require("hardhat");

async function main() {
  const CONTRACT_ADDRESS = "0x091B8d2a77257dC306C5C7F2981E4eC2F4D8e4Af";
  const NEW_BASE_URI = "https://pangsrally.vercel.app/api/metadata/";

  console.log("Updating base URI for contract:", CONTRACT_ADDRESS);
  const PangsRally = await ethers.getContractFactory("PangsRally");
  const contract = PangsRally.attach(CONTRACT_ADDRESS);

  const tx = await contract.setBaseURI(NEW_BASE_URI);
  console.log("Transaction sent:", tx.hash);
  await tx.wait();
  console.log("Base URI successfully updated to:", NEW_BASE_URI);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
