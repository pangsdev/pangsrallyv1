const fs = require('fs');
const path = require('path');

const map = {
  'discoverer': 'Discoverer',
  'asdas': 'Galactic',
  'asas': 'Racer',
  'wew': 'Halo',
  'qqqq': 'Old',
  'safaribag': 'Safari',
};

// Update _metadata.json
const metadataPath = path.join(__dirname, 'nft/json/_metadata.json');
const data = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
let changedCount = 0;

data.forEach(item => {
  item.attributes.forEach(attr => {
    if (attr.trait_type === 'Belt' && map[attr.value]) {
      attr.value = map[attr.value];
      changedCount++;
    }
  });
});

fs.writeFileSync(metadataPath, JSON.stringify(data, null, 2));
console.log(`Updated _metadata.json: ${changedCount} belts changed.`);

// Update individual files
let filesChanged = 0;
for (let i = 1; i <= 777; i++) {
  const file = path.join(__dirname, `nft/json/${i}.json`);
  if (fs.existsSync(file)) {
    const item = JSON.parse(fs.readFileSync(file, 'utf8'));
    let changed = false;
    item.attributes.forEach(attr => {
      if (attr.trait_type === 'Belt' && map[attr.value]) {
        attr.value = map[attr.value];
        changed = true;
      }
    });
    if (changed) {
      fs.writeFileSync(file, JSON.stringify(item, null, 2));
      filesChanged++;
    }
  }
}
console.log(`Updated ${filesChanged} individual JSON files.`);
