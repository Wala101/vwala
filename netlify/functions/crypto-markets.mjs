const COINS = [
  { id: 'bitcoin', assetSymbol: 'BTC', fallbackPrice: 94500 },
  { id: 'ethereum', assetSymbol: 'ETH', fallbackPrice: 3100 },
  { id: 'solana', assetSymbol: 'SOL', fallbackPrice: 182 }
]

function getNextFourHourCloseTimestamp(fromDate = new Date()) {
  const base = new Date(fromDate)
  const utcHour = base.getUTCHours()
  const nextWindowHour = Math.floor(utcHour / 4) * 4 + 4

  const close = new Date(Date.UTC(
    base.getUTCFullYear(),
    base.getUTCMonth(),
    base.getUTCDate(),
    0,
    0,
    0,
    0
  ))

  close.setUTCHours(nextWindowHour)

  return Math.floor(close.getTime() / 1000)
}

function buildBinaryMarketId(symbol, closeAt) {
  const seed = String(symbol || 'CRYPTO')
    .split('')
    .reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) % 100000, 17)

  return (BigInt(closeAt) * 100000n + BigInt(seed)).toString()
}

function buildFallbackMarkets() {
  const closeAt = getNextFourHourCloseTimestamp()

  return COINS.map((coin) => ({
    marketId: buildBinaryMarketId(coin.assetSymbol, closeAt),
    assetSymbol: coin.assetSymbol,
    imageUrl: '/logo.png',
    question: `${coin.assetSymbol} fechará acima do preço de referência em 4 horas?`,
    referencePriceUsd: coin.fallbackPrice,
    currentPriceUsd: coin.fallbackPrice,
    closeAt,
    probYesBps: 5000,
    probNoBps: 5000
  }))
}

export async function handler() {
  try {
    const apiKey = String(process.env.COINGECKO_DEMO_API_KEY || '').trim()
    const closeAt = getNextFourHourCloseTimestamp()

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
    url.searchParams.set('x_cg_demo_api_key', apiKey)

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        accept: 'application/json'
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
      const referencePriceUsd = currentPriceUsd

      return {
        marketId: buildBinaryMarketId(coin.assetSymbol, closeAt),
        assetSymbol: coin.assetSymbol,
        imageUrl: String(row?.image || '/logo.png'),
        question: `${coin.assetSymbol} fechará acima do preço de referência em 4 horas?`,
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