import { network } from 'hardhat'

async function main() {
  const { ethers } = await network.create()

  const Factory = await ethers.getContractFactory('VWalaPool')
  const contract = await Factory.deploy()

  await contract.waitForDeployment()

  console.log('VWalaPool deployed to:', await contract.getAddress())
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})