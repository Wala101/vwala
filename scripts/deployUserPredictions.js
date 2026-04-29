import hre from 'hardhat'
import 'dotenv/config'

async function main() {
  const { ethers } = await hre.network.getOrCreate()

  const tokenAddress = process.env.VITE_VWALA_TOKEN
  const feeCollector = process.env.FEE_COLLECTOR || (await (await ethers.provider.getSigner()).getAddress())

  if (!tokenAddress) {
    throw new Error('VITE_VWALA_TOKEN não definido no .env')
  }

  const deployer = await ethers.provider.getSigner()
  const deployerAddress = await deployer.getAddress()

  console.log(`Deploying with: ${deployerAddress}`)
  console.log(`Token: ${tokenAddress}`)
  console.log(`Fee Collector: ${feeCollector}`)

  const Factory = await ethers.getContractFactory('VWalaUserPredictions', deployer)
  const contract = await Factory.deploy(tokenAddress, feeCollector)

  await contract.waitForDeployment()

  const address = await contract.getAddress()

  console.log('\n✅ VWalaUserPredictions deployed successfully!')
  console.log(`📍 Contract Address: ${address}`)
  console.log(`\nAdicione ao .env:`)
  console.log(`USER_PREDICTIONS_ADDRESS=${address}`)
}

main().catch((error) => {
  console.error('❌ Erro:', error.shortMessage || error.message)
  process.exit(1)
})
