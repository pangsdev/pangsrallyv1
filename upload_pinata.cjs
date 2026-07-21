const pinataSDK = require('@pinata/sdk');
const fs = require('fs');
const path = require('path');

const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySW5mb3JtYXRpb24iOnsiaWQiOiIwMzI4ZDBlOC1kNmNhLTQ1MGQtOTc3Ni1kZmI1NTEwZjUzMGUiLCJlbWFpbCI6ImVvc2NvZGVyN0BnbWFpbC5jb20iLCJlbWFpbF92ZXJpZmllZCI6dHJ1ZSwicGluX3BvbGljeSI6eyJyZWdpb25zIjpbeyJkZXNpcmVkUmVwbGljYXRpb25Db3VudCI6MSwiaWQiOiJGUkExIn0seyJkZXNpcmVkUmVwbGljYXRpb25Db3VudCI6MSwiaWQiOiJOWUMxIn1dLCJ2ZXJzaW9uIjoxfSwibWZhX2VuYWJsZWQiOmZhbHNlLCJzdGF0dXMiOiJBQ1RJVkUifSwiYXV0aGVudGljYXRpb25UeXBlIjoic2NvcGVkS2V5Iiwic2NvcGVkS2V5S2V5IjoiMjAwODU3MWZiMDkyZDg4MzYxMmIiLCJzY29wZWRLZXlTZWNyZXQiOiJkMzIxMTlhYjkyODdkYjczNGY0NDliN2Q3Nzk3YjBiMGQ0ZjYwNDk5MDMyM2NlODhjOTEzYjNjOWUzYTVlYjU2IiwiZXhwIjoxODE1NzgwMDg1fQ.ElFHU0qoQRnfzE9eFy5a83NSmweKEytmW4zIL8BA3k8';

const pinata = new pinataSDK({ pinataJWTKey: JWT });

const originalJsonPath = path.join(__dirname, 'nft', 'json');
const originalImagesPath = path.join(__dirname, 'nft', 'images'); // 2GB of PNGs
const metadataPath = path.join(__dirname, 'public', 'metadata');

if (!fs.existsSync(metadataPath)) fs.mkdirSync(metadataPath, { recursive: true });

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

async function main() {
    try {
        console.log("1. Authenticating with Pinata...");
        const res = await pinata.testAuthentication();
        console.log("Authenticated successfully!");

        console.log("2. Uploading 1000 PNG images to IPFS (This may take 10+ minutes for 2GB)...");
        const imgResult = await pinata.pinFromFS(originalImagesPath, {
            pinataMetadata: { name: 'PangsRally_Images_PNG_HQ' }
        });
        const imagesCid = imgResult.IpfsHash;
        console.log("Images CID:", imagesCid);

        console.log("3. Generating 1000 clean metadata files with correct name, description, CID and .png extension...");
        for (let i = 1; i <= 1000; i++) {
            const p = path.join(originalJsonPath, `${i}.json`);
            if (fs.existsSync(p)) {
                let metadata = JSON.parse(fs.readFileSync(p, 'utf8'));
                
                // Fix Name and Description
                metadata.name = `Pangs Rally #${i}`;
                metadata.description = "The official Pangs Rally Racing Pangolin.";

                // Filter out any previously added stats just in case
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

                metadata.image = `ipfs://${imagesCid}/${i}.png`; // <--- ORIGINAL PNG
                
                // Write clean JSON to public folder
                fs.writeFileSync(path.join(metadataPath, `${i}.json`), JSON.stringify(metadata, null, 2));
            }
        }
        console.log("Metadata files generated!");

        console.log("4. Uploading 1000 metadata files to IPFS...");
        const metaResult = await pinata.pinFromFS(metadataPath, {
            pinataMetadata: { name: 'PangsRally_Metadata_Final' }
        });
        const metaCid = metaResult.IpfsHash;
        console.log("Metadata CID:", metaCid);
        
        console.log("\n=== SUCCESS ===");
        console.log("BASE_TOKEN_URI=ipfs://" + metaCid + "/");

    } catch (e) {
        console.error("Error:", e);
    }
}

main();
