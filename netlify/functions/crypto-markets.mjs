const COINS = [
  { id: 'bitcoin', assetSymbol: 'BTC', fallbackPrice: 94500 },
  { id: 'ethereum', assetSymbol: 'ETH', fallbackPrice: 3100 },
  { id: 'solana', assetSymbol: 'SOL', fallbackPrice: 182 },
  { id: 'binancecoin', assetSymbol: 'BNB', fallbackPrice: 610 },
  { id: 'ripple', assetSymbol: 'XRP', fallbackPrice: 2.15 },
  { id: 'cardano', assetSymbol: 'ADA', fallbackPrice: 0.72 },
  { id: 'dogecoin', assetSymbol: 'DOGE', fallbackPrice: 0.18 },
  { id: 'tron', assetSymbol: 'TRX', fallbackPrice: 0.12 },
  { id: 'chainlink', assetSymbol: 'LINK', fallbackPrice: 14.5 },
  { id: 'avalanche-2', assetSymbol: 'AVAX', fallbackPrice: 27 },
  { id: 'polkadot', assetSymbol: 'DOT', fallbackPrice: 6.8 },
  { id: 'matic-network', assetSymbol: 'MATIC', fallbackPrice: 0.95 },
  { id: 'litecoin', assetSymbol: 'LTC', fallbackPrice: 84 },
  { id: 'bitcoin-cash', assetSymbol: 'BCH', fallbackPrice: 460 },
  { id: 'shiba-inu', assetSymbol: 'SHIB', fallbackPrice: 0.000025 }
]

const MARKET_RULE_VERSION = 'DAY00V1'
const TARGET_PCT = 0.001

function getTargetPriceUsd(currentPrice) {
  const price = Number(currentPrice || 0)

  if (!Number.isFinite(price) || price <= 0) {
    return 0
  }

  return Number((price * (1 + TARGET_PCT)).toFixed(2))
}

function getDailyMarketCloseTimestamp(fromDate = new Date()) {
  const base = new Date(fromDate)

  const close = new Date(
    base.getFullYear(),
    base.getMonth(),
    base.getDate() + 1,
    0,
    0,
    0,
    0
  )

  return Math.floor(close.getTime() / 1000)
}

function buildBinaryMarketId(symbol, closeAt) {
  const seed = `${String(symbol || 'CRYPTO')}_${MARKET_RULE_VERSION}`
    .split('')
    .reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) % 100000, 17)

  return (BigInt(closeAt) * 100000n + BigInt(seed)).toString()
}

function buildFallbackMarkets() {
  const closeAt = getDailyMarketCloseTimestamp()

  return COINS.map((coin) => ({
    marketId: buildBinaryMarketId(coin.assetSymbol, closeAt),
    assetSymbol: coin.assetSymbol,
    imageUrl: '/logo.png',
  question: `${coin.assetSymbol} fechará 0,1% acima da referência até 00:00?`,
referencePriceUsd: getTargetPriceUsd(coin.fallbackPrice),
currentPriceUsd: coin.fallbackPrice,
    closeAt,
    probYesBps: 5000,
    probNoBps: 5000
  }))
}

export async function handler() {
  try {
    const apiKey = String(process.env.COINGECKO_DEMO_API_KEY || '').trim()
    const closeAt = getDailyMarketCloseTimestamp()

    if (!apiKey) {
      return {
        statusCode: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'public, max-age=30'
        },
        body: JSON.stringify({
          markets: buildFallbackMarkets()
        })
      }
    }

    const ids = COINS.map((coin) => coin.id).join(',')

    const url = new URL('https://api.coingecko.com/api/v3/coins/markets')
    url.searchParams.set('vs_currency', 'usd')
    url.searchParams.set('ids', ids)
    url.searchParams.set('sparkline', 'false')
    url.searchParams.set('price_change_percentage', '24h')
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        'x-cg-demo-api-key': apiKey
      }
    })

    if (!response.ok) {
      throw new Error(`CoinGecko retornou ${response.status}`)
    }

    const payload = await response.json()
    const rows = Array.isArray(payload) ? payload : []
    const byId = new Map(rows.map((row) => [row.id, row]))

    const markets = COINS.map((coin) => {
      const row = byId.get(coin.id)

      const currentPriceUsd = Number(row?.current_price || coin.fallbackPrice)
const referencePriceUsd = getTargetPriceUsd(currentPriceUsd)

      return {
        marketId: buildBinaryMarketId(coin.assetSymbol, closeAt),
        assetSymbol: coin.assetSymbol,
        imageUrl: String(row?.image || '/logo.png'),
        question: `${coin.assetSymbol} fechará 0,1% acima da referência até 00:00?`,
        referencePriceUsd,
        currentPriceUsd,
        closeAt,
        probYesBps: 5000,
        probNoBps: 5000
      }
    })

    return {
      statusCode: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, max-age=60'
      },
      body: JSON.stringify({ markets })
    }
  } catch (error) {
    console.error('crypto-markets error:', error)

    return {
      statusCode: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, max-age=30'
      },
      body: JSON.stringify({
        markets: buildFallbackMarkets()
      })
    }
  }
}