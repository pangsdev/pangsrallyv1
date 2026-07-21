import hardhat from "hardhat";

async function main() {
  const [deployer] = await hardhat.ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);

  const PangsRally = await hardhat.ethers.getContractFactory("PangsRally");
  const pangsRally = await PangsRally.deploy();
  await pangsRally.waitForDeployment();

  const address = await pangsRally.getAddress();
  console.log("PangsRally Genesis Contract deployed to:", address);

  // Set the Base URI to the Pinata IPFS CID
  const baseURI = "ipfs://QmbjySSREte2rc1f8FmAfvy4Ze8xi8uTcv2WkqNUc5rTJQ/";
  console.log("Setting Base URI to:", baseURI);
  
  const tx = await pangsRally.setBaseURI(baseURI);
  await tx.wait();
  
  // Enable the sale so the user can test minting
  console.log("Enabling the public sale...");
  const saleTx = await pangsRally.toggleSale();
  await saleTx.wait();

  console.log("Deployment and Configuration Complete! 🚀");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
