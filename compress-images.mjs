import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const inputDir = path.join(process.cwd(), 'nft/images');
const outputDir = path.join(process.cwd(), 'public/nft-images');

async function processImages() {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const files = fs.readdirSync(inputDir).filter(f => f.endsWith('.png'));
  console.log(`Found ${files.length} images to compress...`);

  let count = 0;
  for (const file of files) {
    const inputPath = path.join(inputDir, file);
    const outputPath = path.join(outputDir, file.replace('.png', '.webp'));

    try {
      await sharp(inputPath)
        .resize(500, 500, { fit: 'inside' })
        .webp({ quality: 60 })
        .toFile(outputPath);
      count++;
      if (count % 100 === 0) console.log(`Processed ${count}/${files.length}`);
    } catch (err) {
      console.error(`Error processing ${file}:`, err);
    }
  }

  console.log('Finished processing all images.');
}

processImages();
