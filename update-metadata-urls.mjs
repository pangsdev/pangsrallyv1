import fs from 'fs';
import path from 'path';

const metadataDir = path.join(process.cwd(), 'public/metadata');

function updateMetadata() {
  const files = fs.readdirSync(metadataDir).filter(f => f.endsWith('.json'));
  console.log(`Reverting ${files.length} metadata files for OpenSea high-res IPFS...`);

  let count = 0;
  for (const file of files) {
    const filePath = path.join(metadataDir, file);
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const tokenId = file.split('.')[0];
      
      // Revert image URL back to native IPFS for high-quality OpenSea rendering
      data.image = `ipfs://bafybeif2s5tz66i3wlbozkvxioschqvfmgzodeibbdp5xnt6wkg6raixqq/${tokenId}.png`;
      
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      count++;
    } catch (err) {
      console.error(`Error processing ${file}:`, err);
    }
  }

  console.log(`Successfully reverted ${count} metadata files.`);
}

updateMetadata();
