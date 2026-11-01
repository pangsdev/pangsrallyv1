const { ethers } = require("hardhat");
const fs = require("fs");

async function main() {
    const CONTRACT_ADDRESS = "0x539cdd042c2f3d93ebc5be7dfff0c79f3b4fabf0";
    
    // ERC721 minimal ABI to get totalSupply and ownerOf
    const abi = [
        "function totalSupply() view returns (uint256)",
        "function ownerOf(uint256 tokenId) view returns (address)"
    ];

    const provider = ethers.provider;
    const contract = new ethers.Contract(CONTRACT_ADDRESS, abi, provider);

    console.log(`Fetching data for contract: ${CONTRACT_ADDRESS}`);
    
    let totalSupply = 0;
    try {
        totalSupply = await contract.totalSupply();
        console.log(`Total Supply: ${totalSupply}`);
    } catch (error) {
        console.error("Could not get totalSupply. Assuming 500 for testing or it's not ERC721Enumerable.");
        totalSupply = 500; // Fallback for a fast demo
    }

    const holders = new Set();
    
    // Batch process to avoid hitting RPC rate limits
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
        
        console.log(`Processed up to token ID ${Math.min(i + batchSize - 1, Number(totalSupply))}`);
    }

    const uniqueHolders = Array.from(holders);
    console.log(`Found ${uniqueHolders.length} unique holders.`);

    // Generate OpenSea Allowlist CSV
    // Format: Wallet address,Custom mint limit (optional),Custom price in native token e.g. ETH (optional)
    let csvContent = "Wallet address,Custom mint limit (optional),Custom price in native token e.g. ETH (optional)\n";
    
    uniqueHolders.forEach(address => {
        // We set 1 mint limit, and empty price (or leave both empty)
        csvContent += `${address},1,\n`;
    });

    const outputPath = "/Users/macintoshi/Desktop/ai-agents/pangsrally/smart-contracts/stonkbrokers-allowlist.csv";
    fs.writeFileSync(outputPath, csvContent);
    console.log(`CSV written to: ${outputPath}`);
}

main().catch(console.error);
