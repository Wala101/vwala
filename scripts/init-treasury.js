import { network } from 'hardhat'
import 'dotenv/config'

const BETTING_ADDRESS =
  process.env.VITE_WALA_BETTING_ADDRESS || '0x486ea8E0E7C320b0b4940bce4e8Bf09905cf917f'

async function main() {
  console.log('Conectando na rede...')
  console.log('BETTING_ADDRESS:', BETTING_ADDRESS)

  const { ethers } = await network.create()
  const [deployer] = await ethers.getSigners()

  console.log('Wallet deployer/operator:', deployer.address)

  const contract = await ethers.getContractAt('WalaBetting', BETTING_ADDRESS, deployer)

  const treasuryBefore = await contract.treasury()
  console.log('Antes -> Treasury ativa:', treasuryBefore.active)
  console.log('Antes -> Total deposited:', treasuryBefore.totalDeposited.toString())
  console.log('Antes -> Tracked balance:', treasuryBefore.trackedBalance.toString())

  if (!treasuryBefore.active) {
    const tx = await contract.initTreasury()
    console.log('tx initTreasury:', tx.hash)
    console.log('Aguardando confirmação do init por até 120s...')

    const receipt = await tx.wait(1, 120000)
    console.log('Init status:', receipt?.status)
    console.log('Init block:', receipt?.blockNumber)
  } else {
    console.log('Treasury já estava ativa, nada para fazer.')
  }

  const treasuryAfter = await contract.treasury()
  console.log('Depois -> Treasury ativa:', treasuryAfter.active)
  console.log('Depois -> Total deposited:', treasuryAfter.totalDeposited.toString())
  console.log('Depois -> Tracked balance:', treasuryAfter.trackedBalance.toString())
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})