import { network } from 'hardhat'

async function main() {
  const { ethers } = await network.connect('polygon')

  const Factory = await ethers.getContractFactory('VWalaExternalPool')
  const contract = await Factory.deploy()

  await contract.waitForDeployment()

  console.log('VWalaExternalPool deployed to:', await contract.getAddress())
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})