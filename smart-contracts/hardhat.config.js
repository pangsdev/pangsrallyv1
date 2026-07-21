import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

/** @type import('hardhat/config').HardhatUserConfig */
export default {
  solidity: {
    version: "0.8.27",
    settings: {
      evmVersion: "cancun",
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    hardhat: {
      chainId: 31337
    },
    robinhood: {
      url: "https://rpc.mainnet.chain.robinhood.com",
      chainId: 4663,
      accounts: process.env.DEV_WALLET_PRIVATE_KEY ? [process.env.DEV_WALLET_PRIVATE_KEY] : []
    }
  }
};
