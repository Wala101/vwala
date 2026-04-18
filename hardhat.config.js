import { defineConfig } from 'hardhat/config'
import hardhatEthers from '@nomicfoundation/hardhat-ethers'
import 'dotenv/config'

function normalizePrivateKey(value = '') {
  const raw = String(value || '').trim()

  if (!raw) return ''
  return raw.startsWith('0x') ? raw : `0x${raw}`
}

const deployerPrivateKey = normalizePrivateKey(process.env.DEPLOYER_PRIVATE_KEY)

export default defineConfig({
  plugins: [hardhatEthers],
  solidity: {
    version: '0.8.24',
    settings: {
      viaIR: true,
      optimizer: {
        enabled: true,
        runs: 200,
        details: {
          yulDetails: {
            optimizerSteps: 'u'
          }
        }
      }
    }
  },
  networks: {
    polygon: {
      type: 'http',
      chainType: 'generic',
      chainId: 137,
      url: process.env.POLYGON_RPC_URL || '',
      accounts: deployerPrivateKey ? [deployerPrivateKey] : []
    }
  }
})