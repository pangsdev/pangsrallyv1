const json = {
  "name": "Pangs Rally Beta Pass",
  "description": "Exclusive Beta Pass for the Pangs Rally On-Chain Racing Game.",
  "image": "https://teal-tiny-woodpecker-727.mypinata.cloud/ipfs/bafybeifn3o4vbb335dftw3iigbylfss3oovbax6s522j22ooyvnhm5p2y4/1.png",
  "attributes": [
    {
      "trait_type": "Edition",
      "value": "Beta"
    },
    {
      "trait_type": "Type",
      "value": "Rookie Pangolin"
    }
  ]
};
const base64 = Buffer.from(JSON.stringify(json)).toString('base64');
console.log(`data:application/json;base64,${base64}`);
