import hre from "hardhat";

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log("Deploying contracts with the account:", deployer.address);

  // Address of the main PangsRally ERC721 contract
  const nftAddress = "0x6e910E141351E9AD90aBD5E83107301DE63A2043";

  // Deploy Marketplace
  const Marketplace = await hre.ethers.getContractFactory("PangsMarketplace");
  const marketplace = await Marketplace.deploy(nftAddress);
  await marketplace.waitForDeployment();
  const marketplaceAddress = await marketplace.getAddress();
  console.log("PangsMarketplace deployed to:", marketplaceAddress);

  // Deploy Racing
  const Racing = await hre.ethers.getContractFactory("PangsRacing");
  const racing = await Racing.deploy();
  await racing.waitForDeployment();
  const racingAddress = await racing.getAddress();
  console.log("PangsRacing deployed to:", racingAddress);
  
  console.log("Done! Make sure to update the addresses in your frontend env or constants.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
