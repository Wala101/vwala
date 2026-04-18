import { defineConfig } from 'hardhat/config'
import hardhatEthers from '@nomicfoundation/hardhat-ethers'
import 'dotenv/config'

export default defineConfig({
  plugins: [hardhatEthers],
  solidity: {
  version: '0.8.24',
  settings: {
    optimizer: {
      enabled: true,
      runs: 200
    }
  }
},
networks: {
  polygon: {
    type: 'http',
    chainType: 'generic',
    url: process.env.POLYGON_RPC_URL || '',
    accounts: process.env.DEPLOYER_PRIVATE_KEY
      ? [process.env.DEPLOYER_PRIVATE_KEY]
      : []
  }
}
})