const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const NFT_COUNT = 1000;
const inputJsonDir = path.join(__dirname, 'nft', 'json');
const inputImageDir = path.join(__dirname, 'nft', 'images');
const outputJsonDir = path.join(__dirname, 'public', 'metadata');
const outputImageDir = path.join(__dirname, 'public', 'nft-images');

// Ensure output dirs exist
if (!fs.existsSync(outputJsonDir)) fs.mkdirSync(outputJsonDir, { recursive: true });
if (!fs.existsSync(outputImageDir)) fs.mkdirSync(outputImageDir, { recursive: true });

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getRandomWeather() {
    const roll = Math.random();
    if (roll < 0.3) return 'Desert';
    if (roll < 0.6) return 'Forest';
    if (roll < 0.8) return 'Snow';
    return 'Volcanic';
}

function calculateRarity(speed, burst, endurance) {
    const total = speed + burst + endurance;
    if (total >= 280) return 'Legendary';
    if (total >= 240) return 'Epic';
    if (total >= 190) return 'Rare';
    if (total >= 140) return 'Uncommon';
    return 'Common';
}

console.log("Processing " + NFT_COUNT + " NFTs...");

for (let i = 1; i <= NFT_COUNT; i++) {
    // 1. Process Metadata
    const jsonPath = path.join(inputJsonDir, `${i}.json`);
    if (fs.existsSync(jsonPath)) {
        let metadata = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        
        // Remove existing game stats if any
        metadata.attributes = metadata.attributes.filter(a => 
            !['Speed', 'Burst Power', 'Endurance', 'Weather Adaptation', 'Rarity'].includes(a.trait_type)
        );

        // Generate stats
        const speed = randomInt(30, 100);
        const burst = randomInt(30, 100);
        const endurance = randomInt(30, 100);
        const weather = getRandomWeather();
        const rarity = calculateRarity(speed, burst, endurance);

        metadata.attributes.push({ trait_type: 'Speed', value: speed });
        metadata.attributes.push({ trait_type: 'Burst Power', value: burst });
        metadata.attributes.push({ trait_type: 'Endurance', value: endurance });
        metadata.attributes.push({ trait_type: 'Weather Adaptation', value: weather });
        metadata.attributes.push({ trait_type: 'Rarity', value: rarity });

        // Fix image path
        metadata.image = `ipfs://[CID_PLACEHOLDER]/${i}.webp`;

        fs.writeFileSync(path.join(outputJsonDir, `${i}.json`), JSON.stringify(metadata, null, 2));
    }

    // 2. Process Image (Convert PNG to WebP)
    const imgIn = path.join(inputImageDir, `${i}.png`);
    const imgOut = path.join(outputImageDir, `${i}.webp`);
    if (fs.existsSync(imgIn)) {
        try {
            // using cwebp if available, otherwise just copy. Assuming user has basic unix tools. 
            // We can also use sharp, let's see if sharp is in node_modules
            execSync(`npx sharp -i ${imgIn} -o ${imgOut}`);
        } catch (e) {
            console.error(`Failed to convert image ${i}`);
        }
    }
}
console.log("Done processing metadata and images!");
