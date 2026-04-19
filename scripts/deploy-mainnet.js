import { network } from 'hardhat'
import 'dotenv/config'

async function main() {
  const { ethers } = await network.create('polygon')
  const [deployer] = await ethers.getSigners()

  const deployerAddress = await deployer.getAddress()
  const balance = await ethers.provider.getBalance(deployerAddress)

  console.log('Deploy wallet:', deployerAddress)
  console.log('Operator automático:', deployerAddress)
  console.log('Saldo POL:', ethers.formatEther(balance))

  const contract = await ethers.deployContract(
    'WalaBetting',
    [deployerAddress],
    deployer
  )

  await contract.waitForDeployment()

  const contractAddress = await contract.getAddress()

  console.log('WalaBetting deployado em:', contractAddress)
  console.log('Operator final:', deployerAddress)
  console.log('vWALA fixo:', '0x7bD1f6f4F5CEf026b643758605737CB48b4B7D83')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})