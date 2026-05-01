import { network } from 'hardhat'

const { ethers, networkName } = await network.create()

async function main() {
  const [deployer] = await ethers.getSigners()

  console.log(`Deployando WalaTokenFactory em ${networkName}...`)
  console.log(`Deployer: ${deployer.address}`)

  const factory = await ethers.deployContract('WalaTokenFactory')
  await factory.waitForDeployment()

  const factoryAddress = await factory.getAddress()

  console.log('WALA_TOKEN_FACTORY_ADDRESS=' + factoryAddress)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})