import hre from 'hardhat'
import 'dotenv/config'

async function main() {
  const { ethers } = await hre.network.connect()

  const contractAddress = process.env.USER_PREDICTIONS_ADDRESS
  const tokenAddress = process.env.VITE_VWALA_TOKEN
  const bootstrapAmount = process.env.BOOTSTRAP_AMOUNT || '10000'

  if (!contractAddress) throw new Error('USER_PREDICTIONS_ADDRESS não definido')
  if (!tokenAddress) throw new Error('VITE_VWALA_TOKEN não definido')

  const deployer = await ethers.provider.getSigner()
  const deployerAddress = await deployer.getAddress()

  console.log(`Carteira: ${deployerAddress}`)

  const predictions = await ethers.getContractAt(
    'VWalaUserPredictions',
    contractAddress,
    deployer
  )

  const token = await ethers.getContractAt(
    [
      'function balanceOf(address) view returns (uint256)',
      'function allowance(address,address) view returns (uint256)',
      'function approve(address,uint256) returns (bool)'
    ],
    tokenAddress,
    deployer
  )

  const amount = ethers.parseUnits(bootstrapAmount, 18)

  if (await predictions.treasuryActive()) {
    console.log('✅ Treasury já ativa')
    return
  }

  const balance = await token.balanceOf(deployerAddress)
  console.log(`Saldo: ${ethers.formatUnits(balance, 18)} vWALA`)

  if (balance < amount) {
    throw new Error('Saldo insuficiente para bootstrap')
  }

  const allowance = await token.allowance(deployerAddress, contractAddress)
  console.log(`Allowance: ${ethers.formatUnits(allowance, 18)} vWALA`)

  if (allowance < amount) {
    console.log('📝 Aprovando tokens...')
    const approveTx = await token.approve(contractAddress, amount)
    await approveTx.wait()
    console.log('✅ Approve concluído')
  }

  console.log('🚀 Executando bootstrap...')
  const tx = await predictions.bootstrapTreasury(amount)
  await tx.wait()

  console.log(`✅ Treasury ativada! Tx: ${tx.hash}`)
}

main().catch((error) => {
  console.error('❌ Erro:', error.shortMessage || error.message)
  process.exit(1)
})