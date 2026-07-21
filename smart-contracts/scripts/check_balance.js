import hardhat from "hardhat";
async function main() {
  const balance = await hardhat.ethers.provider.getBalance("0x70997970c51812dc3a010c7d01b50e0d17dc79c8");
  console.log("Balance:", hardhat.ethers.formatEther(balance));
}
main().catch(console.error);
