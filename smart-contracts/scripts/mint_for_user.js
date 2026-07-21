import hardhat from "hardhat";

async function main() {
  const contractAddress = "0xa513E6E4b8f2a923D98304ec87F64353C4D5C853";
  const targetAddress = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"; // User's Rabby address

  const PangsRally = await hardhat.ethers.getContractFactory("PangsRally");
  const contract = PangsRally.attach(contractAddress);

  console.log(`Minting 3 NFTs to ${targetAddress}...`);

  // We are calling mint from the deployer account (which has 10000 ETH)
  // Wait, the mint function does _mint(msg.sender, quantity). 
  // We need to mint TO the target address. 
  // Since our contract only has mint() which mints to msg.sender, we can't mint to someone else unless we add a function or just send them the NFTs.
  
  // Let's mint to deployer, then transfer to the user!
  const price = await contract.mintPrice();
  const tx = await contract.mint(3, { value: price * 3n });
  await tx.wait();
  
  console.log("Minted to deployer. Now transferring to user...");
  
  const tokens = await contract.tokensOfOwner((await hardhat.ethers.getSigners())[0].address);
  for (let i = 0; i < 3; i++) {
    const tokenId = tokens[i];
    await contract.transferFrom((await hardhat.ethers.getSigners())[0].address, targetAddress, tokenId);
    console.log(`Transferred Token #${tokenId} to ${targetAddress}`);
  }

  console.log("All done! User now has 3 NFTs.");
}

main().catch(console.error);
