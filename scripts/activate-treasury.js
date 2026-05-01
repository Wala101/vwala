import { JsonRpcProvider, Wallet, Contract, parseUnits, formatUnits } from 'ethers'
import dotenv from 'dotenv'
dotenv.config()

const CONTRACT_ADDRESS = process.env.USER_PREDICTIONS_ADDRESS
const TOKEN_ADDRESS = process.env.VITE_VWALA_TOKEN

const PREDICTIONS_ABI = [
  'function bootstrapTreasury(uint256 amount) external',
  'function treasuryActive() external view returns (bool)'
]

const TOKEN_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)'
]

async function main() {
  const provider = new JsonRpcProvider(process.env.POLYGON_RPC_URL)
  const wallet = new Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider)

  const contract = new Contract(CONTRACT_ADDRESS, PREDICTIONS_ABI, wallet)
  const token = new Contract(TOKEN_ADDRESS, TOKEN_ABI, wallet)

  const amount = parseUnits(process.env.BOOTSTRAP_AMOUNT || '1000', 18)

  console.log(`Carteira: ${wallet.address}`)

  const active = await contract.treasuryActive()
  if (active) {
    console.log('✅ Treasury já ativa')
    return
  }

  const balance = await token.balanceOf(wallet.address)
  console.log(`Saldo: ${formatUnits(balance, 18)} VWALA`)

  if (balance < amount) {
    throw new Error('Saldo insuficiente para bootstrap')
  }

  const allowance = await token.allowance(wallet.address, CONTRACT_ADDRESS)
  console.log(`Allowance atual: ${formatUnits(allowance, 18)} VWALA`)

  if (allowance < amount) {
    console.log('📝 Aprovando tokens...')
    const approveTx = await token.approve(CONTRACT_ADDRESS, amount)
    await approveTx.wait()
    console.log('✅ Approve concluído')
  }

  console.log('🚀 Executando bootstrap...')
  const tx = await contract.bootstrapTreasury(amount)
  console.log(`📤 Tx: ${tx.hash}`)

  await tx.wait()
  console.log('✅ Treasury ativada com sucesso!')
}

main().catch((error) => {
  console.error('❌ Erro:', error.shortMessage || error.message)
})