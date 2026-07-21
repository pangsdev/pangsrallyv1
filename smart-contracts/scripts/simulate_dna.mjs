import hardhat from "hardhat";

async function main() {
  const [deployer] = await hardhat.ethers.getSigners();
  
  console.log("Getting PangsRally contract...");
  const PangsRally = await hardhat.ethers.getContractFactory("PangsRally");
  const contract = PangsRally.attach("0x6e910E141351E9AD90aBD5E83107301DE63A2043");
  
  // Mint 2 tokens to deployer
  console.log("Minting 2 Gen 0s to User...");
  let tx = await contract.connect(deployer).mint(2, { value: hardhat.ethers.parseEther("0.0002") });
  await tx.wait();
  
  // Check DNA
  const p1DNA = await contract.pangolinDNA(1);
  const p2DNA = await contract.pangolinDNA(2);
  console.log("P1 DNA:", p1DNA.toString());
  console.log("P2 DNA:", p2DNA.toString());
  
  // Breed them
  console.log("Breeding Gen 1...");
  tx = await contract.connect(deployer).breed(1, 2, { value: hardhat.ethers.parseEther("0.0001") });
  let receipt = await tx.wait();
  
  // Check child DNA
  const childDNA = await contract.pangolinDNA(3);
  console.log("Child DNA:", childDNA.toString());
}

main().catch(console.error);
