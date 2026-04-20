import { network } from 'hardhat'
import 'dotenv/config'

const BETTING_ADDRESS =
  process.env.VITE_WALA_BETTING_ADDRESS || '0x486ea8E0E7C320b0b4940bce4e8Bf09905cf917f'

const VWALA_TOKEN_ADDRESS =
  process.env.VITE_VWALA_TOKEN || '0x7bD1f6f4F5CEf026b643758605737CB48b4B7D83'

const DEPOSIT_AMOUNT = '1000' // ajuste aqui

async function main() {
  console.log('Conectando na rede...')
  console.log('BETTING_ADDRESS:', BETTING_ADDRESS)
  console.log('VWALA_TOKEN_ADDRESS:', VWALA_TOKEN_ADDRESS)
  console.log('DEPOSIT_AMOUNT:', DEPOSIT_AMOUNT)

  const { ethers } = await network.create()
  const [deployer] = await ethers.getSigners()

  console.log('Wallet deployer/operator:', deployer.address)

  const betting = await ethers.getContractAt('WalaBetting', BETTING_ADDRESS, deployer)

  const token = await ethers.getContractAt(
    [
      'function decimals() view returns (uint8)',
      'function balanceOf(address account) view returns (uint256)',
      'function allowance(address owner, address spender) view returns (uint256)',
      'function approve(address spender, uint256 amount) external returns (bool)'
    ],
    VWALA_TOKEN_ADDRESS,
    deployer
  )

  const decimals = await token.decimals()
  const amountWei = ethers.parseUnits(DEPOSIT_AMOUNT, decimals)

  const treasuryBefore = await betting.treasury()
  console.log('Antes -> Treasury ativa:', treasuryBefore.active)
  console.log('Antes -> Total deposited:', treasuryBefore.totalDeposited.toString())
  console.log('Antes -> Tracked balance:', treasuryBefore.trackedBalance.toString())

  if (!treasuryBefore.active) {
    throw new Error('A treasury não está ativa. Rode primeiro o init-treasury.')
  }

  const walletBalance = await token.balanceOf(deployer.address)
  console.log('Saldo vWALA wallet:', walletBalance.toString())

  if (walletBalance < amountWei) {
    throw new Error('Saldo de vWALA insuficiente na wallet operator.')
  }

  const allowanceBefore = await token.allowance(deployer.address, BETTING_ADDRESS)
  console.log('Allowance antes:', allowanceBefore.toString())

  if (allowanceBefore < amountWei) {
    const approveTx = await token.approve(BETTING_ADDRESS, amountWei)
    console.log('tx approve:', approveTx.hash)
    const approveReceipt = await approveTx.wait(1, 120000)
    console.log('Approve status:', approveReceipt?.status)
  } else {
    console.log('Allowance já suficiente.')
  }

  const depositTx = await betting.depositTreasury(amountWei)
  console.log('tx depositTreasury:', depositTx.hash)

  const depositReceipt = await depositTx.wait(1, 120000)
  console.log('Deposit status:', depositReceipt?.status)
  console.log('Deposit block:', depositReceipt?.blockNumber)

  const treasuryAfter = await betting.treasury()
  console.log('Depois -> Treasury ativa:', treasuryAfter.active)
  console.log('Depois -> Total deposited:', treasuryAfter.totalDeposited.toString())
  console.log('Depois -> Tracked balance:', treasuryAfter.trackedBalance.toString())
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
