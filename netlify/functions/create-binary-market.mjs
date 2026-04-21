import { Contract, JsonRpcProvider, Wallet, isAddress } from 'ethers'

const DEFAULT_BINARY_ADDRESS =
  process.env.VWALA_BINARY_ADDRESS ||
  process.env.BINARY_PREDICTIONS_ADDRESS ||
  process.env.VITE_BINARY_PREDICTIONS_ADDRESS ||
  ''

const PREDICTIONS_ABI = [
  'function createMarket(uint64 marketId, string assetSymbol, string question, uint64 closeAt, int256 referencePriceE8, uint16 feeBps, uint16 yesProbBps, uint16 noProbBps) external',
  'function getMarketState(uint64 marketId) external view returns (bool exists, address authority, uint64 storedMarketId, uint8 status, bool hasWinner, uint8 winningSide, uint256 createdAt, uint256 resolvedAt, uint256 closeAt)',
  'error MarketAlreadyExists()',
  'error InvalidProbabilityConfig()',
  'error Unauthorized()'
]

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type'
    }
  })
}

function getRpcUrl() {
  return String(
    process.env.POLYGON_RPC_URL ||
    process.env.VITE_POLYGON_RPC_URL ||
    ''
  ).trim()
}

function getDeployerKey() {
  return String(process.env.DEPLOYER_PRIVATE_KEY || '').trim()
}

function getBinaryAddress() {
  return String(DEFAULT_BINARY_ADDRESS || '').trim()
}

function normalizeText(value, fallback = '') {
  return String(value || fallback).trim()
}

function normalizeUintString(value) {
  const text = String(value || '').trim()
  return /^\d+$/.test(text) ? text : ''
}

export default async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'content-type'
      }
    })
  }

  if (request.method !== 'POST') {
    return json({ ok: false, error: 'Método não permitido.' }, 405)
  }

  try {
    const rpcUrl = getRpcUrl()
    const deployerKey = getDeployerKey()
    const binaryAddress = getBinaryAddress()

    if (!rpcUrl) throw new Error('POLYGON_RPC_URL não configurado.')
    if (!deployerKey) throw new Error('DEPLOYER_PRIVATE_KEY não configurado.')
    if (!binaryAddress) throw new Error('BINARY_PREDICTIONS_ADDRESS não configurado.')
    if (!isAddress(binaryAddress)) throw new Error(`Endereço inválido do contrato binário: ${binaryAddress}`)

    const body = await request.json().catch(() => ({}))

    const marketId = normalizeUintString(body.marketId)
    const assetSymbol = normalizeText(body.assetSymbol, 'CRYPTO').toUpperCase()
    const question = normalizeText(body.question, 'Mercado binário')
    const closeAt = normalizeUintString(body.closeAt)
    const referencePriceE8 = normalizeText(body.referencePriceE8, '0')
    const feeBps = Number(body.feeBps ?? 0)
    const yesProbBps = Number(body.yesProbBps ?? 5000)
    const noProbBps = Number(body.noProbBps ?? 5000)

    if (!marketId) throw new Error('marketId inválido.')
    if (!closeAt) throw new Error('closeAt inválido.')
    if (!/^-?\d+$/.test(referencePriceE8)) throw new Error('referencePriceE8 inválido.')

    const provider = new JsonRpcProvider(rpcUrl)
    const signer = new Wallet(deployerKey, provider)
    const contract = new Contract(binaryAddress, PREDICTIONS_ABI, signer)

    const marketState = await contract.getMarketState(BigInt(marketId))

    if (marketState[0]) {
      return json({
        ok: true,
        alreadyExists: true,
        marketId,
        authority: String(marketState[1] || ''),
        operator: signer.address
      })
    }

    const tx = await contract.createMarket(
      BigInt(marketId),
      assetSymbol,
      question,
      BigInt(closeAt),
      BigInt(referencePriceE8),
      feeBps,
      yesProbBps,
      noProbBps
    )

    await tx.wait()

    const createdState = await contract.getMarketState(BigInt(marketId))

    return json({
      ok: true,
      created: true,
      marketId,
      assetSymbol,
      authority: String(createdState[1] || ''),
      operator: signer.address,
      hash: tx.hash
    })
  } catch (error) {
    return json({
      ok: false,
      error: error?.shortMessage || error?.message || String(error)
    }, 500)
  }
}