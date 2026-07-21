const { ethers } = require('ethers');
const fs = require('fs');

async function main() {
    const provider = new ethers.JsonRpcProvider("https://rpc.testnet.robinhood.com");
    const contractData = JSON.parse(fs.readFileSync('src/PangsRally.json', 'utf8'));
    const contract = new ethers.Contract("0x6e910E141351E9AD90aBD5E83107301DE63A2043", contractData.abi, provider);
    
    const p1 = await contract.childToParents(3, 0);
    const p2 = await contract.childToParents(3, 1);
    const dna = await contract.pangolinDNA(3);
    console.log("Token 3:", { p1: p1.toString(), p2: p2.toString(), dna: dna.toString() });
}
main().catch(console.error);
