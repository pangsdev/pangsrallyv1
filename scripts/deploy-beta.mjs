#!/usr/bin/env node
/**
 * Deploys PangsRallyBeta to Robinhood Chain with plain ethers (Hardhat hangs on the
 * iCloud-evicted smart-contracts/node_modules). Uses the compiled artifact in
 * smart-contracts/deployments/PangsRallyBeta.artifact.json.
 *
 *   node scripts/deploy-beta.mjs --uri ipfs://<metadata CID>            # estimate only (default)
 *   node scripts/deploy-beta.mjs --uri ipfs://<metadata CID> --deploy   # spends real gas
 *
 * .env: DEV_WALLET_PRIVATE_KEY (deployer + owner), BETA_SIGNER_ADDRESS (voucher signer),
 * TREASURY_WALLET_ADDRESS (5% royalty; deployer if unset). Keys are never printed.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { ContractFactory, JsonRpcProvider, Wallet, formatEther, isAddress } from 'ethers';

const RPC = 'https://rpc.mainnet.chain.robinhood.com';
const CHAIN_ID = 4663;
const root = new URL('..', import.meta.url);
const env = Object.fromEntries(readFileSync(new URL('.env', root), 'utf8').split('\n')
  .map(l => l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)).filter(Boolean)
  .map(([, k, v]) => [k, v.replace(/^["']|["']$/g, '')]));
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };
const deploy = process.argv.includes('--deploy');
const uri = arg('uri') || 'ipfs://placeholder';
if (deploy && !/^ipfs:\/\/\w{20,}/.test(uri)) { console.error('Pass --uri ipfs://<metadata CID> to deploy.'); process.exit(1); }

const provider = new JsonRpcProvider(RPC, CHAIN_ID, { staticNetwork: true });
const deployer = new Wallet(env.DEV_WALLET_PRIVATE_KEY, provider);
const signer = env.BETA_SIGNER_ADDRESS;
const royalty = isAddress(env.TREASURY_WALLET_ADDRESS || '') ? env.TREASURY_WALLET_ADDRESS : deployer.address;
if (!isAddress(signer || '')) { console.error('BETA_SIGNER_ADDRESS missing in .env'); process.exit(1); }

const art = JSON.parse(readFileSync(new URL('smart-contracts/deployments/PangsRallyBeta.artifact.json', root), 'utf8'));
const factory = new ContractFactory(art.abi, art.bytecode, deployer);
const tx = await factory.getDeployTransaction(deployer.address, signer, royalty, uri);

const [balance, gas, fee] = await Promise.all([provider.getBalance(deployer.address), provider.estimateGas({ ...tx, from: deployer.address }), provider.getFeeData()]);
const price = fee.maxFeePerGas ?? fee.gasPrice ?? 0n;
console.log(`Deployer (owner): ${deployer.address}`);
console.log(`Voucher signer:   ${signer}`);
console.log(`Royalty 5% to:    ${royalty}`);
console.log(`Token URI:        ${uri}`);
console.log(`Balance:          ${formatEther(balance)} ETH`);
console.log(`Estimated gas:    ${gas} × ${formatEther(price * 1_000_000_000n / 1_000_000_000n)} ETH/gas ≈ ${formatEther(gas * price)} ETH (upper bound)`);
if (!deploy) { console.log('\nEstimate only. Add --deploy to send the transaction.'); process.exit(0); }
if (balance < gas * price) { console.error('Not enough ETH for gas.'); process.exit(1); }

const contract = await factory.deploy(deployer.address, signer, royalty, uri);
console.log(`Sent: ${contract.deploymentTransaction().hash}`);
await contract.waitForDeployment();
const address = await contract.getAddress();
console.log(`PangsRallyBeta deployed to: ${address}`);
writeFileSync(new URL('smart-contracts/deployments/PangsRallyBeta.robinhood.json', root),
  JSON.stringify({ address, chainId: CHAIN_ID, owner: deployer.address, voucherSigner: signer, royaltyReceiver: royalty, tokenURI: uri, tx: contract.deploymentTransaction().hash, deployedAt: new Date().toISOString() }, null, 2) + '\n');
