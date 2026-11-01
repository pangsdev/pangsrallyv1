const { ethers } = require("hardhat");
const fs = require("fs");

async function fetchHolders(contractAddress, outputName) {
    console.log(`\n==========================================`);
    console.log(`Fetching data for contract: ${contractAddress}`);
    console.log(`==========================================`);
    
    // ERC721 minimal ABI to get totalSupply and ownerOf
    const abi = [
        "function totalSupply() view returns (uint256)",
        "function ownerOf(uint256 tokenId) view returns (address)"
    ];

    const provider = ethers.provider;
    const contract = new ethers.Contract(contractAddress, abi, provider);

    let totalSupply = 0;
    try {
        totalSupply = await contract.totalSupply();
        console.log(`Total Supply: ${totalSupply}`);
    } catch (error) {
        console.error("Could not get totalSupply. Assuming 10000.");
        totalSupply = 10000;
    }

    const holders = new Set();
    const batchSize = 50;
    
    for (let i = 1; i <= Number(totalSupply); i += batchSize) {
        const promises = [];
        for (let j = i; j < i + batchSize && j <= Number(totalSupply); j++) {
            promises.push(
                contract.ownerOf(j).catch(() => null) // Ignore errors for burned/non-existent
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

    const outputPath = `/Users/macintoshi/Desktop/ai-agents/pangsrally/smart-contracts/${outputName}-allowlist.csv`;
    fs.writeFileSync(outputPath, csvContent);
    console.log(`✅ CSV written to: ${outputPath}`);
}

async function main() {
    // py0py0py0py0
    await fetchHolders("0x08dc7cb3f4ccc8eea782e2924d151e2130f22b28", "py0py0");
    
    // hoodini
    await fetchHolders("0x603d1a631da50034db1e04e9e2308951e70af714", "hoodini");
    
    console.log("\nAll collections processed successfully! 🚀");
}

main().catch(console.error);
