import { network } from 'hardhat'
import 'dotenv/config'

const ERC20_ABI = [
  'function decimals() view returns (uint8)',
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)'
]

const PREDICTIONS_ABI = [
  'function bootstrapTreasury(uint256 amount) external',
  'function treasuryActive() view returns (bool)',
  'function treasuryBootstrapped() view returns (uint256)'
]

async function main() {
  const { ethers, networkName } = await network.create()

  const tokenAddress =
    process.env.VWALA_TOKEN_ADDRESS || '0x7bD1f6f4F5CEf026b643758605737CB48b4B7D83'

  const predictionsAddress =
    process.env.BINARY_PREDICTIONS_ADDRESS ||
    process.env.VITE_BINARY_PREDICTIONS_ADDRESS ||
    '0x798474EC1C9f32ca2537bCD4f88d7b422baEE23d'

  const bootstrapAmountRaw = String(
    process.env.BOOTSTRAP_AMOUNT || '1000'
  ).trim()

  const [signer] = await ethers.getSigners()

  console.log(`Network: ${networkName}`)
  console.log(`Wallet: ${signer.address}`)
  console.log(`Token: ${tokenAddress}`)
  console.log(`Predictions: ${predictionsAddress}`)
  console.log(`Bootstrap amount: ${bootstrapAmountRaw}`)

  const token = new ethers.Contract(tokenAddress, ERC20_ABI, signer)
  const predictions = new ethers.Contract(predictionsAddress, PREDICTIONS_ABI, signer)

  const decimals = Number(await token.decimals())
  const amount = ethers.parseUnits(bootstrapAmountRaw, decimals)

  const [balance, allowanceBefore, treasuryActiveBefore, bootstrappedBefore] =
    await Promise.all([
      token.balanceOf(signer.address),
      token.allowance(signer.address, predictionsAddress),
      predictions.treasuryActive(),
      predictions.treasuryBootstrapped()
    ])

  console.log('Token balance:', ethers.formatUnits(balance, decimals))
  console.log('Allowance before:', ethers.formatUnits(allowanceBefore, decimals))
  console.log('Treasury active before:', treasuryActiveBefore)
  console.log('Treasury bootstrapped before:', ethers.formatUnits(bootstrappedBefore, decimals))

  if (balance < amount) {
    throw new Error('Saldo de vWALA insuficiente para bootstrap.')
  }

  if (allowanceBefore < amount) {
    console.log('Enviando approve...')
    const approveTx = await token.approve(predictionsAddress, amount)
    await approveTx.wait()
    console.log('Approve confirmado:', approveTx.hash)
  } else {
    console.log('Approve já suficiente.')
  }

  console.log('Chamando bootstrapTreasury...')
  const bootstrapTx = await predictions.bootstrapTreasury(amount)
  await bootstrapTx.wait()

  const [allowanceAfter, treasuryActiveAfter, bootstrappedAfter] =
    await Promise.all([
      token.allowance(signer.address, predictionsAddress),
      predictions.treasuryActive(),
      predictions.treasuryBootstrapped()
    ])

  console.log('Bootstrap confirmado:', bootstrapTx.hash)
  console.log('Allowance after:', ethers.formatUnits(allowanceAfter, decimals))
  console.log('Treasury active after:', treasuryActiveAfter)
  console.log('Treasury bootstrapped after:', ethers.formatUnits(bootstrappedAfter, decimals))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})