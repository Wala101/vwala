import 'dotenv/config'
import { ethers } from 'ethers'

const provider = new ethers.JsonRpcProvider(process.env.VITE_POLYGON_RPC_URL)
const wallet = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider)

async function cancelAllPending() {
  const latest = await provider.getTransactionCount(wallet.address, 'latest')
  const pending = await provider.getTransactionCount(wallet.address, 'pending')

  console.log(`Wallet: ${wallet.address}`)
  console.log(`Latest nonce : ${latest}`)
  console.log(`Pending nonce: ${pending}`)

  const diff = pending - latest

  if (diff <= 0) {
    console.log('Nenhuma transação pendente.')
    return
  }

  const feeData = await provider.getFeeData()

  const maxPriorityFeePerGas =
    feeData.maxPriorityFeePerGas ?? ethers.parseUnits('50', 'gwei')

  const maxFeePerGas =
    (feeData.maxFeePerGas ?? ethers.parseUnits('200', 'gwei')) * 2n

  for (let nonce = latest; nonce < pending; nonce++) {
    console.log(`Substituindo nonce ${nonce}...`)

    try {
      const tx = await wallet.sendTransaction({
        to: wallet.address,
        value: 0,
        nonce,
        gasLimit: 21000,
        maxFeePerGas,
        maxPriorityFeePerGas,
      })

      console.log(`Enviado: ${tx.hash}`)

      // 🔥 garante broadcast real
      await tx.wait()

      console.log(`Confirmado nonce ${nonce}`)
    } catch (err) {
      console.log(`Falha no nonce ${nonce}:`, err.message)
    }
  }

  console.log('Processo finalizado.')
}

cancelAllPending().catch(console.error)