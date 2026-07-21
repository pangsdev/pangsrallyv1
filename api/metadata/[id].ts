import { ethers } from 'ethers';

const CONTRACT_ADDRESS = "0x6e910E141351E9AD90aBD5E83107301DE63A2043";
const RPC_URL = "https://rpc.mainnet.chain.robinhood.com";

const abi = [
  "function childToParents(uint256, uint256) view returns (uint256)",
  "function pangolinDNA(uint256) view returns (uint256)"
];

const getGen0Metadata = async (id: number, req: any) => {
  const protocol = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers.host;
  const baseUrl = `${protocol}://${host}`;
  try {
    const cookie = req.headers.cookie;
    const response = await fetch(`${baseUrl}/metadata/${id}.json`, {
      headers: cookie ? { cookie } : {}
    });
    if (!response.ok) return null;
    const data = await response.json();
    // Do not force local image, keep IPFS image
    return data;
  } catch(e) {
    return null;
  }
}

// Map 16-bit DNA traits to visual properties based on our collection
const traitNames = ['Background', 'Body', 'Belt', 'Shoes', 'Neck', 'Mouth', 'Eyes', 'Hat', 'Gender', 'Arm', 'Weather Adaptation', 'Speed', 'Burst Power', 'Luck'];
const traitOptions: any = {
  "Background": ["green", "white", "yellow"],
  "Body": ["Red", "Rainbow", "Brown", "Blue", "Black", "Silver", "Albino", "Gold"],
  "Belt": ["none", "Discoverer", "Galactic", "Racer", "Halo", "Old", "Safari"],
  "Shoes": ["none", "Roller Skate"],
  "Neck": ["none", "Bone", "Emerald", "Grey Scarf", "Scarf", "Bitten Medal", "Blue Scarf"],
  "Mouth": ["none", "Bandana", "Nozzle", "Muzzle"],
  "Eyes": ["Police", "Thug", "none", "Retired", "GTech", "AIv2", "Gatsby", "Scorp", "Oogle", "Monocle", "AIGlasses"],
  "Hat": ["Viking", "none", "Safari", "Farmer", "SafariV2", "Beanie", "Felt", "Pirate", "Kabuto", "Hale", "Crown"],
  "Gender": ["Male", "Female"],
  "Arm": ["none", "qwe"],
  "Weather Adaptation": ["None", "Midnight", "Sandstorm", "Volcanic", "Forest"],
  "Speed": [90, 84, 89, 73, 91, 63, 62, 68, 82, 74, 97, 95, 77, 76, 79, 72, 96, 75, 61, 94, 93, 83, 99, 71, 78, 69, 85, 70, 92, 67, 66, 87, 86, 81, 98, 65, 88, 60, 80, 64, 100],
  "Burst Power": [5, 2, 1, 9, 8, 4, 6, 7, 10, 3],
  "Luck": [69, 27, 10, 48, 46, 64, 100, 36, 9, 15, 80, 76, 57, 32, 21, 47, 34, 74, 23, 49, 68, 35, 7, 19, 99, 51, 81, 38, 17, 54, 53, 28, 4, 70, 58, 73, 61, 39, 98, 91, 45, 94, 8, 5, 20, 1, 87, 3, 88, 40, 52, 66, 60, 41, 18, 55, 86, 6, 79, 89, 63, 14, 43, 50, 29, 56, 65, 83, 93, 78, 22, 77, 11, 67, 97, 44, 12, 25, 82, 16, 84, 42, 92, 96, 13, 95, 24, 30, 2, 75, 31, 72, 37, 85, 59, 90, 71, 62, 26, 33]
};

const decodeDNA = (dna: bigint) => {
    const attributes = [];
    for (let i = 0; i < traitNames.length; i++) {
        // Extract the 16-bit chunk for this trait
        // BigInt bitwise shift
        let chunk = Number((dna >> BigInt(i * 16)) & BigInt(0xFFFF));
        
        let traitName = traitNames[i];
        let options = traitOptions[traitName];
        
        // Ensure index doesn't go out of bounds of the options array
        let traitValue = options[chunk % options.length];
        
        attributes.push({ trait_type: traitName, value: traitValue });
    }
    return attributes;
}

const buildGen1Metadata = (id: number, dna: bigint) => {
    const attributes = decodeDNA(dna);
    // Assign a default Generation if not tracked dynamically, or just Gen 1 for simplicity for now
    attributes.push({ trait_type: 'Generation', value: 'Gen 1+' });
    
    // Pick avatar based on Body trait
    const bodyTrait = attributes.find((a: any) => a.trait_type === 'Body')?.value || 'Red';
    let image = 'nft-images/1.webp';
    if (bodyTrait === 'Blue') image = 'nft-images/2.webp';
    if (bodyTrait === 'Rainbow') image = 'nft-images/5.webp';
    
    return {
        name: `Pangs Rally #${id}`,
        description: `Bred Pangolin Gen 1+`,
        image: image,
        attributes: attributes
    };
}

export default async function handler(req: any, res: any) {
  let idParam = req.query.id as string;
  if (idParam && idParam.endsWith('.json')) {
      idParam = idParam.replace('.json', '');
  }
  const tokenId = parseInt(idParam, 10);

  if (isNaN(tokenId)) {
    return res.status(400).json({ error: "Invalid token ID" });
  }

  try {
    const provider = new ethers.JsonRpcProvider("https://rpc.mainnet.chain.robinhood.com");
    const contract = new ethers.Contract(CONTRACT_ADDRESS, abi, provider);

    let parent1 = 0n;
    let parent2 = 0n;
    let dna = 0n;
    try {
        parent1 = await contract.childToParents(tokenId, 0);
        parent2 = await contract.childToParents(tokenId, 1);
        dna = await contract.pangolinDNA(tokenId);
    } catch(e) {
        console.error("RPC Error:", e);
        return res.status(500).json({ error: "RPC Error" });
    }
    
    // If it has parents, it's a Bred Pangolin (Gen 1+)
    if (parent1 !== 0n && parent2 !== 0n) {
        const meta = buildGen1Metadata(tokenId, dna);
        if (meta) return res.status(200).json(meta);
        return res.status(404).json({ error: "Bred metadata not found" });
    }

    // Otherwise, it must be a Genesis (Gen 0)
    const meta = await getGen0Metadata(tokenId, req);
    if (meta) return res.status(200).json(meta);
    
    return res.status(404).json({ error: "Metadata not found" });

  } catch(e: any) {
      console.error(e);
      return res.status(500).json({ error: "Internal Server Error" });
  }
}
