import { ethers } from 'ethers'

const provider = new ethers.JsonRpcProvider(
  import.meta.env.VITE_POLYGON_RPC_URL
)

export async function run(walletAddress) {
  if (!walletAddress) throw new Error('Sem wallet')

  const pending = await provider.getTransactionCount(walletAddress, 'pending')
  const latest = await provider.getTransactionCount(walletAddress, 'latest')

  console.log('[NONCE DEBUG]', {
    walletAddress,
    pending,
    latest,
    stuck: pending - latest
  })

  alert(
    `Wallet: ${walletAddress}\nPending: ${pending}\nLatest: ${latest}\nStuck: ${pending - latest}`
  )
}