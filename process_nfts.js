import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const NFT_COUNT = 1000;
const inputJsonDir = path.join(__dirname, 'nft', 'json');
const inputImageDir = path.join(__dirname, 'nft', 'images');
const outputJsonDir = path.join(__dirname, 'public', 'metadata');
const outputImageDir = path.join(__dirname, 'public', 'nft-images');

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

async function processNfts() {
    console.log("Processing " + NFT_COUNT + " NFTs...");
    for (let i = 1; i <= NFT_COUNT; i++) {
        const jsonPath = path.join(inputJsonDir, `${i}.json`);
        if (fs.existsSync(jsonPath)) {
            let metadata = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
            metadata.attributes = metadata.attributes.filter(a => 
                !['Speed', 'Burst Power', 'Endurance', 'Weather Adaptation', 'Rarity'].includes(a.trait_type)
            );
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
            metadata.image = `ipfs://[CID_PLACEHOLDER]/${i}.webp`;
            fs.writeFileSync(path.join(outputJsonDir, `${i}.json`), JSON.stringify(metadata, null, 2));
        }

        const imgIn = path.join(inputImageDir, `${i}.png`);
        const imgOut = path.join(outputImageDir, `${i}.webp`);
        if (fs.existsSync(imgIn)) {
            await sharp(imgIn).webp({ quality: 80 }).toFile(imgOut);
            if (i % 100 === 0) console.log(`Processed ${i} images`);
        }
    }
    console.log("Done!");
}

processNfts().catch(console.error);
