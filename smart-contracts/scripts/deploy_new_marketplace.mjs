import hre from "hardhat";

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying Marketplace with account:", deployer.address);

  // New Official NFT Address on Robinhood
  const nftAddress = "0xfa4543737062C234F981503B887027a7F0BF3D56";

  const Marketplace = await hre.ethers.getContractFactory("PangsMarketplace");
  const marketplace = await Marketplace.deploy(nftAddress);
  await marketplace.waitForDeployment();
  const marketplaceAddress = await marketplace.getAddress();
  console.log("New PangsMarketplace deployed to:", marketplaceAddress);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
