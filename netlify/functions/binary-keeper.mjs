import { Contract, JsonRpcProvider, Wallet, isAddress } from 'ethers'
const DEFAULT_BINARY_ADDRESS = process.env.VWALA_BINARY_ADDRESS

const MARKET_STATUS = {
  OPEN: 0,
  CLOSED: 1,
  RESOLVED: 2
}

const OUTCOME = {
  YES: 0,
  NO: 1
}

const TARGET_PCT = 0.001 // 0.1%

const COINGECKO_IDS_BY_SYMBOL = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  BNB: 'binancecoin',
  XRP: 'ripple',
  ADA: 'cardano',
  DOGE: 'dogecoin',
  TRX: 'tron',
  LINK: 'chainlink',
  AVAX: 'avalanche-2',
  DOT: 'polkadot',
  POL: 'polygon',
  LTC: 'litecoin',
  BCH: 'bitcoin-cash',
  SHIB: 'shiba-inu'
}

const BINARY_ABI = [
  'function getMarketState(uint64 marketId) external view returns (bool exists, address authority, uint64 storedMarketId, uint8 status, bool hasWinner, uint8 winningSide, uint256 createdAt, uint256 resolvedAt, uint256 closeAt)',
  'function getMarketMeta(uint64 marketId) external view returns (string assetSymbol, string question, int256 referencePriceE8)',
  'function closeMarket(uint64 marketId)',
  'function resolveMarket(uint64 marketId, uint8 outcome)',
  'error Unauthorized()',
  'error MarketNotFound()',
  'error MarketNotOpen()',
  'error MarketClosed()',
  'error MarketAlreadyResolved()',
  'error MarketNotResolved()'
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
  return String(
    process.env.VWALA_BINARY_ADDRESS ||
    process.env.BINARY_PREDICTIONS_ADDRESS ||
    process.env.VITE_BINARY_PREDICTIONS_ADDRESS ||
    DEFAULT_BINARY_ADDRESS ||
    ''
  ).trim()
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

function getCoinGeckoIdFromAssetSymbol(assetSymbol) {
  const normalized = String(assetSymbol || '').trim().toUpperCase()
  return COINGECKO_IDS_BY_SYMBOL[normalized] || ''
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

if (!isAddress(binaryAddress)) {
  throw new Error(`VWALA_BINARY_ADDRESS inválido: ${binaryAddress}`)
}

const provider = new JsonRpcProvider(rpcUrl)
const signer = new Wallet(deployerKey, provider)

console.log('[BINARY KEEPER INPUT]', {
  marketId,
  binaryAddress,
  operator: signer.address
})

const contract = new Contract(binaryAddress, BINARY_ABI, signer)

    const marketState = await contract.getMarketState(BigInt(marketId))
const marketMeta = await contract.getMarketMeta(BigInt(marketId))

if (!marketState[0]) {
  return json({ ok: false, error: 'Market não existe' })
}

const status = Number(marketState[3])
const assetSymbol = String(marketMeta[0] || '').trim().toUpperCase()
const referencePrice = Number(marketMeta[2]) / 100000000
const closeAt = Number(marketState[8])
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
  const coinGeckoId = getCoinGeckoIdFromAssetSymbol(assetSymbol)

  if (!coinGeckoId) {
    throw new Error(`AssetSymbol sem mapeamento para CoinGecko: ${assetSymbol}`)
  }

  const currentPrice = await getCurrentPrice(coinGeckoId)
  const outcome = computeOutcome(referencePrice, currentPrice)

  console.log('[BINARY KEEPER PRE-RESOLVE]', {
    marketId,
    operator: signer.address,
    authority: String(marketState[1] || ''),
    status,
    hasWinner: Boolean(marketState[4]),
    winningSide: Number(marketState[5]),
    assetSymbol,
    coinGeckoId,
    referencePrice,
    currentPrice,
    outcome
  })

  // ⚠️ remover staticCall pois pode falhar mesmo com tx válida
  console.log('[BINARY KEEPER SKIP STATIC CALL]', {
    marketId,
    outcome
  })

  const tx = await contract.resolveMarket(BigInt(marketId), outcome)
  await tx.wait()

  return json({
    ok: true,
    action: 'resolved',
    operator: signer.address,
    authority: String(marketState[1] || ''),
    assetSymbol,
    coinGeckoId,
    referencePrice,
    currentPrice,
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