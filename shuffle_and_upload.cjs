const pinataSDK = require('@pinata/sdk');
const fs = require('fs');
const path = require('path');

const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySW5mb3JtYXRpb24iOnsiaWQiOiIwMzI4ZDBlOC1kNmNhLTQ1MGQtOTc3Ni1kZmI1NTEwZjUzMGUiLCJlbWFpbCI6ImVvc2NvZGVyN0BnbWFpbC5jb20iLCJlbWFpbF92ZXJpZmllZCI6dHJ1ZSwicGluX3BvbGljeSI6eyJyZWdpb25zIjpbeyJkZXNpcmVkUmVwbGljYXRpb25Db3VudCI6MSwiaWQiOiJGUkExIn0seyJkZXNpcmVkUmVwbGljYXRpb25Db3VudCI6MSwiaWQiOiJOWUMxIn1dLCJ2ZXJzaW9uIjoxfSwibWZhX2VuYWJsZWQiOmZhbHNlLCJzdGF0dXMiOiJBQ1RJVkUifSwiYXV0aGVudGljYXRpb25UeXBlIjoic2NvcGVkS2V5Iiwic2NvcGVkS2V5S2V5IjoiMjAwODU3MWZiMDkyZDg4MzYxMmIiLCJzY29wZWRLZXlTZWNyZXQiOiJkMzIxMTlhYjkyODdkYjczNGY0NDliN2Q3Nzk3YjBiMGQ0ZjYwNDk5MDMyM2NlODhjOTEzYjNjOWUzYTVlYjU2IiwiZXhwIjoxODE1NzgwMDg1fQ.ElFHU0qoQRnfzE9eFy5a83NSmweKEytmW4zIL8BA3k8';
const pinata = new pinataSDK({ pinataJWTKey: JWT });

const originalJsonPath = path.join(__dirname, 'nft', 'json');
const originalImagesPath = path.join(__dirname, 'nft', 'images');

const shuffledImagesPath = path.join(__dirname, 'nft', 'shuffled_images');
const shuffledMetadataPath = path.join(__dirname, 'public', 'shuffled_metadata');

if (fs.existsSync(shuffledImagesPath)) fs.rmSync(shuffledImagesPath, { recursive: true, force: true });
if (fs.existsSync(shuffledMetadataPath)) fs.rmSync(shuffledMetadataPath, { recursive: true, force: true });

fs.mkdirSync(shuffledImagesPath, { recursive: true });
fs.mkdirSync(shuffledMetadataPath, { recursive: true });

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
        console.log("1. Generating Shuffle Map...");
        const ids = Array.from({ length: 1000 }, (_, i) => i + 1);
        for (let i = ids.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [ids[i], ids[j]] = [ids[j], ids[i]];
        }
        
        console.log("2. Copying and Shuffling Images...");
        for (let newId = 1; newId <= 1000; newId++) {
            const oldId = ids[newId - 1]; // Because arrays are 0-indexed
            const src = path.join(originalImagesPath, `${oldId}.png`);
            const dest = path.join(shuffledImagesPath, `${newId}.png`);
            if(fs.existsSync(src)) {
                fs.copyFileSync(src, dest);
            } else {
                console.warn(`Missing source image: ${oldId}.png`);
            }
        }

        console.log("3. Authenticating with Pinata...");
        await pinata.testAuthentication();
        
        console.log("4. Uploading 1000 SHUFFLED PNG images to IPFS...");
        const imgResult = await pinata.pinFromFS(shuffledImagesPath, {
            pinataMetadata: { name: 'PangsRally_Shuffled_Images' }
        });
        const imagesCid = imgResult.IpfsHash;
        console.log("Shuffled Images CID:", imagesCid);

        console.log("5. Generating 1000 clean, shuffled metadata files...");
        for (let newId = 1; newId <= 1000; newId++) {
            const oldId = ids[newId - 1];
            const p = path.join(originalJsonPath, `${oldId}.json`);
            if (fs.existsSync(p)) {
                let metadata = JSON.parse(fs.readFileSync(p, 'utf8'));
                
                metadata.name = `Pangs Rally #${newId}`; // The new ID is shown
                metadata.description = "The official Pangs Rally Racing Pangolin.";

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

                metadata.image = `ipfs://${imagesCid}/${newId}.png`;
                
                fs.writeFileSync(path.join(shuffledMetadataPath, `${newId}.json`), JSON.stringify(metadata, null, 2));
            }
        }

        console.log("6. Uploading 1000 SHUFFLED metadata files to IPFS...");
        const metaResult = await pinata.pinFromFS(shuffledMetadataPath, {
            pinataMetadata: { name: 'PangsRally_Shuffled_Metadata' }
        });
        const metaCid = metaResult.IpfsHash;
        
        console.log("\n=== SUCCESS ===");
        console.log("BASE_TOKEN_URI=ipfs://" + metaCid + "/");

        // Clean up 2GB of duplicate images to save disk space
        fs.rmSync(shuffledImagesPath, { recursive: true, force: true });
        console.log("Temporary shuffled image folder cleaned up.");

    } catch (e) {
        console.error("Error:", e);
    }
}

main();
