const { ethers } = require("hardhat");
const fs = require("fs");

async function main() {
    const CONTRACT_ADDRESS = "0x9ec6c5b9f572a9b02138e553bc5f5882da735f45";
    const OUTPUT_NAME = "onchainhoodies";
    
    console.log(`\n==========================================`);
    console.log(`Fetching data for contract: ${CONTRACT_ADDRESS}`);
    console.log(`==========================================`);
    
    // ERC721 minimal ABI to get totalSupply and ownerOf
    const abi = [
        "function totalSupply() view returns (uint256)",
        "function ownerOf(uint256 tokenId) view returns (address)"
    ];

    const provider = ethers.provider;
    const contract = new ethers.Contract(CONTRACT_ADDRESS, abi, provider);

    let totalSupply = 0;
    try {
        totalSupply = await contract.totalSupply();
        console.log(`Total Supply: ${totalSupply}`);
    } catch (error) {
        console.error("Could not get totalSupply. Assuming 5000.");
        totalSupply = 5000;
    }

    const holders = new Set();
    const batchSize = 50;
    
    for (let i = 1; i <= Number(totalSupply); i += batchSize) {
        const promises = [];
        for (let j = i; j < i + batchSize && j <= Number(totalSupply); j++) {
            promises.push(
                contract.ownerOf(j).catch(() => null)
            );
        }
        
        const results = await Promise.all(promises);
        results.forEach(owner => {
            if (owner && owner !== ethers.ZeroAddress) {
                holders.add(owner);
            }
        });
        
        if (i % 1000 === 1 || (i + batchSize - 1) >= Number(totalSupply)) {
            console.log(`Processed up to token ID ${Math.min(i + batchSize - 1, Number(totalSupply))}`);
        }
    }

    const uniqueHolders = Array.from(holders);
    console.log(`Found ${uniqueHolders.length} unique holders.`);

    let csvContent = "Wallet address,Custom mint limit (optional),Custom price in native token e.g. ETH (optional)\n";
    uniqueHolders.forEach(address => {
        csvContent += `${address},1,\n`;
    });

    const outputPath = `/Users/macintoshi/Desktop/ai-agents/pangsrally/smart-contracts/${OUTPUT_NAME}-allowlist.csv`;
    fs.writeFileSync(outputPath, csvContent);
    console.log(`✅ CSV written to: ${outputPath}`);
}

main().catch(console.error);
