import { Contract, JsonRpcProvider, Wallet } from 'ethers'

const DEFAULT_BINARY_ADDRESS = process.env.VWALA_BINARY_ADDRESS

const MARKET_STATUS = {
  OPEN: 0,
  CLOSED: 1,
  RESOLVED: 2
}

const OUTCOME = {
  NO: 0,
  YES: 1
}

const TARGET_PCT = 0.001 // 0.1%

const BINARY_ABI = [
  'function getMarket(uint64 marketId) view returns (bool exists, uint8 status, bool resolved, uint8 outcome, uint256 referencePrice, uint256 closeAt)',
  'function closeMarket(uint64 marketId)',
  'function resolveMarket(uint64 marketId, uint8 outcome)'
]

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*'
    }
  })
}

function getRpcUrl() {
  return String(process.env.POLYGON_RPC_URL || '').trim()
}

function getDeployerKey() {
  return String(process.env.DEPLOYER_PRIVATE_KEY || '').trim()
}

function getBinaryAddress() {
  return String(process.env.VWALA_BINARY_ADDRESS || DEFAULT_BINARY_ADDRESS).trim()
}

function normalizeMarketId(value) {
  const text = String(value || '').trim()
  if (!/^\d+$/.test(text)) return ''
  return text
}

async function getCurrentPrice(symbol) {
  const apiKey = String(process.env.COINGECKO_DEMO_API_KEY || '').trim()

  const url = new URL('https://api.coingecko.com/api/v3/simple/price')
  url.searchParams.set('ids', symbol)
  url.searchParams.set('vs_currencies', 'usd')

  const response = await fetch(url.toString(), {
    headers: apiKey ? { 'x-cg-demo-api-key': apiKey } : {}
  })

  if (!response.ok) {
    throw new Error('Erro ao buscar preço')
  }

  const data = await response.json()
  return Number(data?.[symbol]?.usd || 0)
}

function computeOutcome(referencePrice, currentPrice) {
  const target = referencePrice * (1 + TARGET_PCT)

  return currentPrice >= target
    ? OUTCOME.YES
    : OUTCOME.NO
}

export default async (request) => {
  if (request.method !== 'GET') {
    return json({ ok: false, error: 'Método inválido' }, 405)
  }

  try {
    const url = new URL(request.url)
    const marketId = normalizeMarketId(url.searchParams.get('marketId'))

    if (!marketId) {
      throw new Error('marketId inválido')
    }

    const rpcUrl = getRpcUrl()
    const deployerKey = getDeployerKey()
    const binaryAddress = getBinaryAddress()

    if (!rpcUrl || !deployerKey || !binaryAddress) {
      throw new Error('ENV não configurado')
    }

    const provider = new JsonRpcProvider(rpcUrl)
    const signer = new Wallet(deployerKey, provider)
    const contract = new Contract(binaryAddress, BINARY_ABI, signer)

    const market = await contract.getMarket(BigInt(marketId))

    if (!market[0]) {
      return json({ ok: false, error: 'Market não existe' })
    }

    const status = Number(market[1])
    const referencePrice = Number(market[4])
    const closeAt = Number(market[5])
    const now = Math.floor(Date.now() / 1000)

    // 🔒 ainda aberto
    if (now < closeAt) {
      return json({
        ok: true,
        action: 'waiting',
        reason: 'market still open'
      })
    }

    // 🔒 fechar mercado
    if (status === MARKET_STATUS.OPEN) {
      const tx = await contract.closeMarket(BigInt(marketId))
      await tx.wait()

      return json({
        ok: true,
        action: 'closed',
        hash: tx.hash
      })
    }

    // 🔒 resolver mercado
    if (status === MARKET_STATUS.CLOSED) {
      // ⚠️ aqui você precisa mapear symbol corretamente
      // por enquanto exemplo fixo:
      const symbol = 'bitcoin'

      const currentPrice = await getCurrentPrice(symbol)
      const outcome = computeOutcome(referencePrice, currentPrice)

      const tx = await contract.resolveMarket(BigInt(marketId), outcome)
      await tx.wait()

      return json({
        ok: true,
        action: 'resolved',
        outcome,
        hash: tx.hash
      })
    }

    return json({
      ok: true,
      action: 'already_resolved'
    })

  } catch (error) {
    return json({
      ok: false,
      error: error.message
    }, 500)
  }
}