import { network } from 'hardhat'
import 'dotenv/config'

const PREDICTIONS_ADDRESS =
  process.env.BINARY_PREDICTIONS_ADDRESS ||
  process.env.VITE_BINARY_PREDICTIONS_ADDRESS ||
  '0x798474EC1C9f32ca2537bCD4f88d7b422baEE23d'

const VWALA_TOKEN_ADDRESS =
  process.env.VWALA_TOKEN_ADDRESS ||
  process.env.VITE_VWALA_TOKEN ||
  '0x7bD1f6f4F5CEf026b643758605737CB48b4B7D83'

const TX_HASH =
  '0x318e2b2635ce2fc0a0683b6af227c3086a0c33ca9a52f226e19ceb7ae686829c'

async function main() {
  const { ethers } = await network.create()
  const provider = ethers.provider

  const predictions = await ethers.getContractAt(
    [
      'function treasuryActive() view returns (bool)',
      'function treasuryBootstrapped() view returns (uint256)',
      'event TreasuryBootstrapped(address indexed sender, uint256 amount)'
    ],
    PREDICTIONS_ADDRESS
  )

  const token = await ethers.getContractAt(
    [
      'function balanceOf(address account) view returns (uint256)',
      'function decimals() view returns (uint8)'
    ],
    VWALA_TOKEN_ADDRESS
  )

  const [active, bootstrapped, contractTokenBalance, decimals, receipt] = await Promise.all([
    predictions.treasuryActive(),
    predictions.treasuryBootstrapped(),
    token.balanceOf(PREDICTIONS_ADDRESS),
    token.decimals(),
    provider.getTransactionReceipt(TX_HASH)
  ])

  console.log('PREDICTIONS_ADDRESS:', PREDICTIONS_ADDRESS)
  console.log('TX_HASH:', TX_HASH)
  console.log('Treasury active:', active)
  console.log('Treasury bootstrapped raw:', bootstrapped.toString())
  console.log('Treasury bootstrapped formatted:', ethers.formatUnits(bootstrapped, decimals))
  console.log('Contract token balance raw:', contractTokenBalance.toString())
  console.log('Contract token balance formatted:', ethers.formatUnits(contractTokenBalance, decimals))
  console.log('Receipt status:', receipt?.status)
  console.log('Receipt block:', receipt?.blockNumber)
  console.log('Logs count:', receipt?.logs?.length || 0)

  if (receipt?.logs?.length) {
    for (const log of receipt.logs) {
      try {
        const parsed = predictions.interface.parseLog(log)
        console.log('Parsed log:', parsed?.name, parsed?.args)
      } catch {
        // ignora logs de outros contratos
      }
    }
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})