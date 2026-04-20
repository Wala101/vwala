import { Contract, JsonRpcProvider, Wallet, Interface } from 'ethers'

const DEFAULT_BETTING_ADDRESS = '0x486ea8E0E7C320b0b4940bce4e8Bf09905cf917f'

const BETTING_ABI = [
  'function createMarket(uint64 fixtureId, string league, string teamA, string teamB, uint16 feeBps, uint16 homeProbBps, uint16 drawProbBps, uint16 awayProbBps) external',
  'function getMarketState(uint64 fixtureId) view returns (bool exists, address authority, uint64 storedFixtureId, uint8 status, bool hasWinner, uint8 winningOutcome, uint256 createdAt, uint256 resolvedAt)',
  'error Unauthorized()',
  'error InvalidProbabilityConfig()',
  'error FeeTooHigh()',
  'error MarketAlreadyExists()'
]

const BETTING_ERROR_INTERFACE = new Interface(BETTING_ABI)

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

function getBettingAddress() {
  return String(
    process.env.WALA_BETTING_ADDRESS ||
    process.env.VITE_WALA_BETTING_ADDRESS ||
    DEFAULT_BETTING_ADDRESS
  ).trim()
}

function getDeployerKey() {
  return String(process.env.DEPLOYER_PRIVATE_KEY || '').trim()
}

function parseErrorName(error) {
  const candidates = [
    error?.data,
    error?.error?.data,
    error?.info?.error?.data,
    error?.info?.data
  ]

  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !candidate.startsWith('0x')) continue

    try {
      const parsed = BETTING_ERROR_INTERFACE.parseError(candidate)
      if (parsed?.name) {
        return parsed.name
      }
    } catch {
      continue
    }
  }

  return ''
}

function normalizeInteger(value, fieldName, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const num = Number(value)

  if (!Number.isInteger(num) || num < min || num > max) {
    throw new Error(`${fieldName} inválido.`)
  }

  return num
}

function normalizeText(value, fieldName, maxLength = 120) {
  const text = String(value || '').trim()

  if (!text) {
    throw new Error(`${fieldName} obrigatório.`)
  }

  if (text.length > maxLength) {
    throw new Error(`${fieldName} muito grande.`)
  }

  return text
}

function validateProbabilities(homeProbBps, drawProbBps, awayProbBps) {
  const total = homeProbBps + drawProbBps + awayProbBps

  if (homeProbBps <= 0 || drawProbBps <= 0 || awayProbBps <= 0) {
    throw new Error('Probabilidades inválidas.')
  }

  if (total !== 10000) {
    throw new Error('A soma das probabilidades deve ser 10000 bps.')
  }
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
    const bettingAddress = getBettingAddress()

    if (!rpcUrl) throw new Error('POLYGON_RPC_URL não configurado.')
    if (!deployerKey) throw new Error('DEPLOYER_PRIVATE_KEY não configurado.')
    if (!bettingAddress) throw new Error('WALA_BETTING_ADDRESS não configurado.')

    let body = {}

    try {
      body = await request.json()
    } catch {
      throw new Error('Body JSON inválido.')
    }

    const fixtureId = normalizeInteger(body.fixtureId, 'fixtureId', {
      min: 1,
      max: 18446744073709551615
    })

    const league = normalizeText(body.league, 'league')
    const teamA = normalizeText(body.teamA, 'teamA')
    const teamB = normalizeText(body.teamB, 'teamB')

    const feeBps = normalizeInteger(body.feeBps ?? 0, 'feeBps', {
      min: 0,
      max: 10000
    })

    const homeProbBps = normalizeInteger(body.homeProbBps, 'homeProbBps', {
      min: 1,
      max: 10000
    })

    const drawProbBps = normalizeInteger(body.drawProbBps, 'drawProbBps', {
      min: 1,
      max: 10000
    })

    const awayProbBps = normalizeInteger(body.awayProbBps, 'awayProbBps', {
      min: 1,
      max: 10000
    })

    validateProbabilities(homeProbBps, drawProbBps, awayProbBps)

    const provider = new JsonRpcProvider(rpcUrl)
    const signer = new Wallet(deployerKey, provider)
    const betting = new Contract(bettingAddress, BETTING_ABI, signer)

    const currentState = await betting.getMarketState(BigInt(fixtureId))

    if (Boolean(currentState[0])) {
      return json({
        ok: true,
        alreadyExists: true,
        fixtureId: String(fixtureId),
        bettingAddress,
        operator: signer.address,
        authority: String(currentState[1] || ''),
        status: Number(currentState[3])
      })
    }

    let tx

    try {
      tx = await betting.createMarket(
        BigInt(fixtureId),
        league,
        teamA,
        teamB,
        feeBps,
        homeProbBps,
        drawProbBps,
        awayProbBps
      )
    } catch (error) {
      const errorName = parseErrorName(error)

      if (errorName === 'MarketAlreadyExists') {
        const stateAfterExists = await betting.getMarketState(BigInt(fixtureId)).catch(() => null)

        return json({
          ok: true,
          alreadyExists: true,
          fixtureId: String(fixtureId),
          bettingAddress,
          operator: signer.address,
          authority: stateAfterExists ? String(stateAfterExists[1] || '') : '',
          status: stateAfterExists ? Number(stateAfterExists[3]) : null
        })
      }

      return json({
        ok: false,
        stage: 'createMarket',
        fixtureId: String(fixtureId),
        bettingAddress,
        operator: signer.address,
        error: error?.message || String(error),
        shortMessage: error?.shortMessage || '',
        data: error?.data || error?.error?.data || error?.info?.error?.data || '',
        errorName
      }, 500)
    }

    const receipt = await tx.wait()
    const marketState = await betting.getMarketState(BigInt(fixtureId))

    return json({
      ok: true,
      fixtureId: String(fixtureId),
      bettingAddress,
      operator: signer.address,
      authority: String(marketState[1] || ''),
      status: Number(marketState[3]),
      txHash: String(tx.hash || ''),
      blockNumber: Number(receipt?.blockNumber || 0),
      created: true
    })
  } catch (error) {
    return json({
      ok: false,
      error: error?.message || String(error),
      shortMessage: error?.shortMessage || '',
      data: error?.data || error?.error?.data || error?.info?.error?.data || ''
    }, 500)
  }
}