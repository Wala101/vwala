import { network } from 'hardhat'
import 'dotenv/config'

const PREDICTIONS_ABI = [
  'function resolveMarket(uint64 marketId, int256 finalPriceE8) external',
  'function getMarketState(uint64 marketId) external view returns (bool exists, address authority, uint64 storedMarketId, uint8 status, bool hasWinner, uint8 winningSide, uint256 createdAt, uint256 resolvedAt, uint256 closeAt)',
  'function getMarketMeta(uint64 marketId) external view returns (string assetSymbol, string question, int256 referencePriceE8)'
]

function toPriceE8(value) {
  const numeric = Number(String(value || '').trim())

  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error('Preço final inválido.')
  }

  return BigInt(Math.round(numeric * 100000000))
}

async function main() {
  const { ethers, networkName } = await network.create()

  const predictionsAddress =
    process.env.BINARY_PREDICTIONS_ADDRESS ||
    process.env.VITE_BINARY_PREDICTIONS_ADDRESS ||
    '0x798474EC1C9f32ca2537bCD4f88d7b422baEE23d'

  const marketIdRaw = String(process.env.RESOLVE_MARKET_ID || '').trim()
  const finalPriceRaw = String(process.env.RESOLVE_FINAL_PRICE_USD || '').trim()

  if (!marketIdRaw) {
    throw new Error('Defina RESOLVE_MARKET_ID no .env')
  }

  if (!finalPriceRaw) {
    throw new Error('Defina RESOLVE_FINAL_PRICE_USD no .env')
  }

  const marketId = BigInt(marketIdRaw)
  const finalPriceE8 = toPriceE8(finalPriceRaw)

  const [signer] = await ethers.getSigners()
  const predictions = new ethers.Contract(predictionsAddress, PREDICTIONS_ABI, signer)

  console.log(`Network: ${networkName}`)
  console.log(`Wallet: ${signer.address}`)
  console.log(`Predictions: ${predictionsAddress}`)
  console.log(`Market ID: ${marketIdRaw}`)
  console.log(`Final price USD: ${finalPriceRaw}`)

  const [stateBefore, meta] = await Promise.all([
    predictions.getMarketState(marketId),
    predictions.getMarketMeta(marketId)
  ])

  console.log('Exists before:', stateBefore[0])
  console.log('Status before:', Number(stateBefore[3]))
  console.log('Has winner before:', stateBefore[4])
  console.log('Resolved at before:', Number(stateBefore[7]))
  console.log('Close at:', Number(stateBefore[8]))
  console.log('Asset:', meta[0])
  console.log('Question:', meta[1])
  console.log('Reference price E8:', meta[2].toString())

  const tx = await predictions.resolveMarket(marketId, finalPriceE8)
  await tx.wait()

  const stateAfter = await predictions.getMarketState(marketId)

  console.log('Resolve hash:', tx.hash)
  console.log('Status after:', Number(stateAfter[3]))
  console.log('Has winner after:', stateAfter[4])
  console.log('Winning side after:', Number(stateAfter[5]))
  console.log('Resolved at after:', Number(stateAfter[7]))
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})