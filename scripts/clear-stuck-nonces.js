import { network } from 'hardhat'
import 'dotenv/config'

const NONCES_TO_CANCEL = [12, 13, 14, 15]

async function main() {
  console.log('Conectando na rede...')
  const { ethers } = await network.create()
  const [deployer] = await ethers.getSigners()

  const walletAddress = await deployer.getAddress()
  console.log('Wallet:', walletAddress)

  for (const nonce of NONCES_TO_CANCEL) {
    console.log(`Enviando cancelamento do nonce ${nonce}...`)

    const tx = await deployer.sendTransaction({
      to: walletAddress,
      value: 0n,
      nonce,
      gasLimit: 21000n,
      maxFeePerGas: ethers.parseUnits('400', 'gwei'),
      maxPriorityFeePerGas: ethers.parseUnits('150', 'gwei')
    })

    console.log(`tx nonce ${nonce}:`, tx.hash)
  }

  console.log('Cancelamentos enviados.')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})