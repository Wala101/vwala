import { network } from 'hardhat'
import 'dotenv/config'

const BETTING_ADDRESS = '0x3276c60b77e70C79Ac4aDA7003C0980fdCC3CfBF'
const VWALA_TOKEN = '0x7bD1f6f4F5CEf026b643758605737CB48b4B7D83'

// ajuste aqui o valor que quer depositar
const DEPOSIT_AMOUNT = '1000000'

const ERC20_ABI = [
  'function approve(address spender, uint256 value) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
  'function balanceOf(address account) external view returns (uint256)'
]

async function main() {
  const { ethers } = await network.create('polygon')
  const [deployer] = await ethers.getSigners()

  const token = new ethers.Contract(VWALA_TOKEN, ERC20_ABI, deployer)
  const contract = await ethers.getContractAt('WalaBetting', BETTING_ADDRESS, deployer)

  const decimals = await token.decimals()
  const amount = ethers.parseUnits(DEPOSIT_AMOUNT, decimals)

  const walletAddress = await deployer.getAddress()
  const balance = await token.balanceOf(walletAddress)

  console.log('Wallet:', walletAddress)
  console.log('Saldo vWALA:', ethers.formatUnits(balance, decimals))
  console.log('Depositando vWALA:', DEPOSIT_AMOUNT)

  const approveTx = await token.approve(BETTING_ADDRESS, amount)
console.log('tx approve:', approveTx.hash)
console.log('Aguardando confirmação do approve por até 120s...')

const approveReceipt = await approveTx.wait(1, 120000)
console.log('Approve status:', approveReceipt?.status)
console.log('Approve block:', approveReceipt?.blockNumber)

const allowance = await token.allowance(walletAddress, BETTING_ADDRESS)
console.log('Allowance liberada:', ethers.formatUnits(allowance, decimals))

console.log('Enviando depositTreasury...')
const depositTx = await contract.depositTreasury(amount)
console.log('tx depositTreasury:', depositTx.hash)
console.log('Aguardando confirmação do depósito por até 120s...')

const depositReceipt = await depositTx.wait(1, 120000)
console.log('Deposit status:', depositReceipt?.status)
console.log('Deposit block:', depositReceipt?.blockNumber)

  const treasury = await contract.treasury()
  console.log('Total deposited:', ethers.formatUnits(treasury.totalDeposited, decimals))
  console.log('Tracked balance:', ethers.formatUnits(treasury.trackedBalance, decimals))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
