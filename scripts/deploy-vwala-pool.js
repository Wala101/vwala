import { network } from 'hardhat'

async function main() {
  const { ethers } = await network.connect('polygon')

  const contract = await ethers.deployContract('VWalaPool')
  await contract.waitForDeployment()

  console.log('VWalaPool deployed to:', await contract.getAddress())
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})