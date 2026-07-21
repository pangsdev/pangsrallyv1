import hardhat from "hardhat";

async function main() {
  const [deployer] = await hardhat.ethers.getSigners();
  const targetAddress = "0x627290d915afda37f618fb10b275081d107ffc2c";
  const amount = hardhat.ethers.parseEther("100.0"); // 100 ETH

  console.log(`Sending ${hardhat.ethers.formatEther(amount)} ETH from ${deployer.address} to ${targetAddress}...`);

  const tx = await deployer.sendTransaction({
    to: targetAddress,
    value: amount,
  });

  await tx.wait();

  console.log(`Successfully funded ${targetAddress} with 100 ETH! 💸`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
