const fs = require('fs');
const path = require('path');

const filesToMerge = [
    'stonkbrokers-allowlist.csv',
    'brokerpunks-allowlist.csv',
    'py0py0-allowlist.csv',
    'hoodrats-allowlist.csv',
    'hoodini-allowlist.csv',
    'onchainhoodies-allowlist.csv',
    'chainmancers-allowlist.csv'
];

const uniqueWallets = new Set();
let totalExtracted = 0;

console.log("Merging allowlists...");

filesToMerge.forEach(file => {
    const filePath = path.join(__dirname, '..', file);
    if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n');
        
        let fileCount = 0;
        lines.forEach(line => {
            const trimmedLine = line.trim();
            // Skip the header or empty lines
            if (trimmedLine && !trimmedLine.startsWith("Wallet address")) {
                const parts = trimmedLine.split(',');
                const address = parts[0].trim().toLowerCase();
                if (address && address.startsWith('0x')) {
                    uniqueWallets.add(address);
                    fileCount++;
                    totalExtracted++;
                }
            }
        });
        console.log(`- Read ${fileCount} addresses from ${file}`);
    } else {
        console.log(`- WARNING: File not found: ${file}`);
    }
});

console.log(`\nTotal addresses extracted across all lists: ${totalExtracted}`);
console.log(`Total UNIQUE addresses (after removing duplicates): ${uniqueWallets.size}`);

let csvContent = "Wallet address,Custom mint limit (optional),Custom price in native token e.g. ETH (optional)\n";
Array.from(uniqueWallets).forEach(address => {
    csvContent += `${address},1,\n`;
});

const outputPath = path.join(__dirname, '..', 'combined-allowlist.csv');
fs.writeFileSync(outputPath, csvContent);
console.log(`\n✅ Combined CSV written to: ${outputPath}`);
