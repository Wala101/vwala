import { network } from 'hardhat'
import 'dotenv/config'

const BETTING_ADDRESS = '0x3276c60b77e70C79Ac4aDA7003C0980fdCC3CfBF'

async function main() {
  console.log('Conectando na rede...')
const { ethers } = await network.create()
  const [deployer] = await ethers.getSigners()

  const contract = await ethers.getContractAt('WalaBetting', BETTING_ADDRESS, deployer)

  const tx = await contract.initTreasury()
console.log('tx initTreasury:', tx.hash)
console.log('Aguardando confirmação do init por até 120s...')

const receipt = await tx.wait(1, 120000)
console.log('Init status:', receipt?.status)
console.log('Init block:', receipt?.blockNumber)

const treasury = await contract.treasury()
console.log('Treasury ativa:', treasury.active)
console.log('Total deposited:', treasury.totalDeposited.toString())
console.log('Tracked balance:', treasury.trackedBalance.toString())
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})