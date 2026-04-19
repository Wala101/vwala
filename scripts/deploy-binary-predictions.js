import { network } from 'hardhat'
import 'dotenv/config'

async function main() {
  const { ethers, networkName } = await network.create()

  const collateralToken =
    process.env.VWALA_TOKEN_ADDRESS || '0x7bD1f6f4F5CEf026b643758605737CB48b4B7D83'

  const [deployer] = await ethers.getSigners()
  const operator = deployer.address

  console.log(`Deploying to ${networkName}...`)
  console.log('Deploy wallet:', deployer.address)
  console.log('Operator wallet:', operator)
  console.log('Collateral token:', collateralToken)

  const contract = await ethers.deployContract(
    'VWalaBinaryPredictions',
    [collateralToken, operator],
    deployer
  )

  await contract.waitForDeployment()

  const contractAddress = await contract.getAddress()

  console.log('VWalaBinaryPredictions deployed at:', contractAddress)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})