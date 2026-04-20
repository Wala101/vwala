import { Contract, JsonRpcProvider, Wallet } from 'ethers'

// sem cron: resolução sob demanda no clique do usuário

const DEFAULT_BETTING_ADDRESS = '0x486ea8E0E7C320b0b4940bce4e8Bf09905cf917f'

const MATCH_OPEN_STATUSES = new Set([
  'SCHEDULED',
  'TIMED',
  'POSTPONED',
  'SUSPENDED',
])

const MATCH_LIVE_STATUSES = new Set([
  'IN_PLAY',
  'PAUSED',
  'LIVE',
  'EXTRA_TIME',
  'PENALTY_SHOOTOUT',
])

const MATCH_FINISHED_STATUSES = new Set([
  'FINISHED',
])

const MARKET_STATUS = {
  OPEN: 0,
  CLOSED: 1,
  RESOLVED: 2,
}

const OUTCOME = {
  HOME: 0,
  DRAW: 1,
  AWAY: 2,
}

const BETTING_ABI = [
  'event MarketCreated(uint64 indexed fixtureId, string league, string teamA, string teamB, uint16 homeProbBps, uint16 drawProbBps, uint16 awayProbBps)',
  'function getMarketState(uint64 fixtureId) view returns (bool exists, address authority, uint64 storedFixtureId, uint8 status, bool hasWinner, uint8 winningOutcome, uint256 createdAt, uint256 resolvedAt)',
  'function closeMarket(uint64 fixtureId)',
  'function resolveMarket(uint64 fixtureId, uint8 winningOutcome)',
]

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
    },
  })
}

function getFootballToken() {
  return String(process.env.FOOTBALL_DATA_TOKEN || '').trim()
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

function getRequestedFixtureId(request) {
  const url = new URL(request.url)
  const fixtureIdFromQuery = normalizeFixtureId(url.searchParams.get('fixtureId') || '')

  if (fixtureIdFromQuery) {
    return fixtureIdFromQuery
  }

  return ''
}

function normalizeFixtureId(value) {
  const text = String(value || '').trim()

  if (!/^\d+$/.test(text)) {
    return ''
  }

  return text
}

function getWinningOutcomeFromMatch(matchData) {
  const winner = String(matchData?.score?.winner || '').trim()

  if (winner === 'HOME_TEAM') return OUTCOME.HOME
  if (winner === 'AWAY_TEAM') return OUTCOME.AWAY
  if (winner === 'DRAW') return OUTCOME.DRAW

  const homeGoals = Number(matchData?.score?.fullTime?.home)
  const awayGoals = Number(matchData?.score?.fullTime?.away)

  if (Number.isFinite(homeGoals) && Number.isFinite(awayGoals)) {
    if (homeGoals > awayGoals) return OUTCOME.HOME
    if (awayGoals > homeGoals) return OUTCOME.AWAY
    return OUTCOME.DRAW
  }

  return null
}

async function footballDataGetMatch(fixtureId, footballToken) {
  const response = await fetch(`https://api.football-data.org/v4/matches/${fixtureId}`, {
    method: 'GET',
    headers: {
      'X-Auth-Token': footballToken,
      Accept: 'application/json',
    },
  })

  const rawText = await response.text()

  if (response.status === 429) {
    const error = new Error(`football-data 429 - ${rawText}`)
    error.code = 'RATE_LIMIT'
    throw error
  }

  if (!response.ok) {
    throw new Error(`football-data ${response.status} - ${rawText}`)
  }

  return JSON.parse(rawText)
}

async function syncSingleFixture(contract, fixtureId, footballToken) {
  const marketState = await contract.getMarketState(BigInt(fixtureId))
  const exists = Boolean(marketState[0])

  if (!exists) {
    return {
      ok: false,
      fixtureId,
      error: 'Mercado não existe no contrato.'
    }
  }

  const marketStatus = Number(marketState[3])

  if (marketStatus === MARKET_STATUS.RESOLVED) {
    return {
      ok: true,
      fixtureId,
      alreadyResolved: true,
      action: 'none'
    }
  }

  const matchData = await footballDataGetMatch(fixtureId, footballToken)
  const matchStatus = String(matchData?.status || '').trim()

  if (MATCH_OPEN_STATUSES.has(matchStatus)) {
    return {
      ok: true,
      fixtureId,
      matchStatus,
      action: 'waiting'
    }
  }

  if (MATCH_LIVE_STATUSES.has(matchStatus)) {
    if (marketStatus === MARKET_STATUS.OPEN) {
      const tx = await contract.closeMarket(BigInt(fixtureId))
      await tx.wait()

      return {
        ok: true,
        fixtureId,
        matchStatus,
        action: 'closed',
        hash: tx.hash
      }
    }

    return {
      ok: true,
      fixtureId,
      matchStatus,
      action: 'waiting'
    }
  }

  if (!MATCH_FINISHED_STATUSES.has(matchStatus)) {
  return {
    ok: true,
    fixtureId,
    matchStatus,
    action: 'waiting'
  }
}

const winningOutcome = getWinningOutcomeFromMatch(matchData)

if (winningOutcome === null) {
  return {
    ok: false,
    fixtureId,
    error: 'Não foi possível determinar o vencedor na football-data.'
  }
}

const actions = []

if (marketStatus === MARKET_STATUS.OPEN) {
  const closeTx = await contract.closeMarket(BigInt(fixtureId))
  await closeTx.wait()

  actions.push({
    action: 'closed_before_resolve',
    hash: closeTx.hash
  })
}

const resolveTx = await contract.resolveMarket(BigInt(fixtureId), winningOutcome)
await resolveTx.wait()

actions.push({
  action: 'resolved',
  hash: resolveTx.hash
})

return {
  ok: true,
  fixtureId,
  matchStatus,
  action: 'resolved',
  winningOutcome,
  actions
}
}

async function maybeCloseMarket(contract, fixtureId, summary) {
  const tx = await contract.closeMarket(BigInt(fixtureId))
  await tx.wait()
  summary.closed += 1
  summary.actions.push({
    fixtureId,
    action: 'closeMarket',
    hash: tx.hash,
  })
}

async function maybeResolveMarket(contract, fixtureId, winningOutcome, summary) {
  const tx = await contract.resolveMarket(BigInt(fixtureId), winningOutcome)
  await tx.wait()
  summary.resolved += 1
  summary.actions.push({
    fixtureId,
    action: 'resolveMarket',
    winningOutcome,
    hash: tx.hash,
  })
}

export default async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, OPTIONS',
        'access-control-allow-headers': 'content-type',
      },
    })
  }

  if (request.method !== 'GET') {
    return json({ ok: false, error: 'Método não permitido.' }, 405)
  }

  try {
    const rpcUrl = getRpcUrl()
    const footballToken = getFootballToken()
    const deployerKey = getDeployerKey()
    const bettingAddress = getBettingAddress()
    const fixtureId = getRequestedFixtureId(request)

    if (!rpcUrl) throw new Error('POLYGON_RPC_URL não configurado.')
    if (!footballToken) throw new Error('FOOTBALL_DATA_TOKEN não configurado.')
    if (!deployerKey) throw new Error('DEPLOYER_PRIVATE_KEY não configurado.')
    if (!bettingAddress) throw new Error('WALA_BETTING_ADDRESS não configurado.')
    if (!fixtureId) throw new Error('fixtureId não informado.')

    const provider = new JsonRpcProvider(rpcUrl)
    const signer = new Wallet(deployerKey, provider)
    const betting = new Contract(bettingAddress, BETTING_ABI, signer)

    const result = await syncSingleFixture(betting, fixtureId, footballToken)

    return json({
      keeper: 'polygon-football-keeper',
      operator: signer.address,
      bettingAddress,
      ...result
    })
  } catch (error) {
    return json(
      {
        ok: false,
        error: error?.message || String(error),
        shortMessage: error?.shortMessage || '',
        data: error?.data || error?.error?.data || error?.info?.error?.data || '',
      },
      500
    )
  }
}