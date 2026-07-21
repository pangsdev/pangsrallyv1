import fs from 'fs';
import path from 'path';

const metadataDir = path.join(process.cwd(), 'public/metadata');
const TOTAL_SUPPLY = 777;

function calculateRarity() {
  const traitCounts = {};
  const nftRarities = {};

  // Step 1: Count occurrences of each trait
  for (let i = 1; i <= TOTAL_SUPPLY; i++) {
    const filePath = path.join(metadataDir, `${i}.json`);
    if (!fs.existsSync(filePath)) continue;

    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    
    data.attributes.forEach(attr => {
      // Ignore numeric traits for rarity calculation (Speed, Burst Power, Luck)
      if (attr.display_type === 'number') return;
      
      const type = attr.trait_type;
      const val = attr.value;
      
      if (!traitCounts[type]) traitCounts[type] = {};
      if (!traitCounts[type][val]) traitCounts[type][val] = 0;
      traitCounts[type][val]++;
    });
  }

  // Step 2: Calculate percentages and score for each NFT
  for (let i = 1; i <= TOTAL_SUPPLY; i++) {
    const filePath = path.join(metadataDir, `${i}.json`);
    if (!fs.existsSync(filePath)) continue;

    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    let score = 0;
    let traitCount = 0;

    data.attributes.forEach(attr => {
      if (attr.display_type === 'number') return;
      const count = traitCounts[attr.trait_type][attr.value];
      const percentage = (count / TOTAL_SUPPLY) * 100;
      
      // Rarity score: rarer traits add more score.
      // E.g., 1% trait = 100 points, 50% trait = 2 points
      score += (100 / percentage);
      traitCount++;
    });

    const avgScore = score / traitCount;
    
    let tier = 'Common';
    if (avgScore > 40) tier = 'Legendary';
    else if (avgScore > 20) tier = 'Epic';
    else if (avgScore > 10) tier = 'Rare';
    else if (avgScore > 5) tier = 'Uncommon';

    nftRarities[i] = {
      tier,
      score: avgScore.toFixed(2)
    };
  }

  const output = {
    traitFrequencies: {},
    nftRarities
  };

  // Format trait frequencies as percentages
  for (const type in traitCounts) {
    output.traitFrequencies[type] = {};
    for (const val in traitCounts[type]) {
      const count = traitCounts[type][val];
      output.traitFrequencies[type][val] = ((count / TOTAL_SUPPLY) * 100).toFixed(1);
    }
  }

  fs.writeFileSync(
    path.join(process.cwd(), 'src', 'rarity-data.json'), 
    JSON.stringify(output, null, 2)
  );
  
  console.log('Rarity calculation complete. Saved to src/rarity-data.json');
}

calculateRarity();
