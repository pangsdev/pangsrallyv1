import pkg from 'hardhat';
const { ethers } = pkg;

async function main() {
  const CONTRACT_ADDRESS = "0xf5DaFf515ECfc3928b24367b8A70B5505d89296f";
  
  const [deployer] = await ethers.getSigners();
  console.log("Setting up official contract with account:", deployer.address);

  const ContractFactory = await ethers.getContractFactory("PangsRallyOfficial");
  const contract = ContractFactory.attach(CONTRACT_ADDRESS);

  console.log("Setting BaseURI...");
  await (await contract.setBaseURI("ipfs://QmYourIpfsHash/")).wait();

  console.log("Setting Mint Price...");
  const price = ethers.parseUnits("250000", 18);
  await (await contract.setMintPrice(price)).wait();

  console.log("Activating Mint...");
  await (await contract.setMintActive(true)).wait();

  console.log("✅ Setup Complete!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
