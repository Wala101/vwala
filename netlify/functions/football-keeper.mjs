import { Contract, JsonRpcProvider, Wallet } from 'ethers'

export const config = {
  schedule: '*/5 * * * *',
}

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

function getDeployBlock() {
  const raw = String(process.env.WALA_BETTING_DEPLOY_BLOCK || '').trim()
  const num = Number(raw)

  if (!Number.isFinite(num) || num < 0) {
    throw new Error('WALA_BETTING_DEPLOY_BLOCK não configurado corretamente.')
  }

  return num
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

async function getTrackedFixtureIds(contract, fromBlock) {
  const events = await contract.queryFilter(
    contract.filters.MarketCreated(),
    fromBlock,
    'latest'
  )

  const unique = new Set()

  for (const event of events) {
    const fixtureId = normalizeFixtureId(event?.args?.fixtureId?.toString?.() || '')
    if (fixtureId) {
      unique.add(fixtureId)
    }
  }

  return [...unique]
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
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
      },
    })
  }

  try {
    const rpcUrl = getRpcUrl()
    const footballToken = getFootballToken()
    const deployerKey = getDeployerKey()
    const bettingAddress = getBettingAddress()
    const deployBlock = getDeployBlock()

    if (!rpcUrl) throw new Error('POLYGON_RPC_URL não configurado.')
    if (!footballToken) throw new Error('FOOTBALL_DATA_TOKEN não configurado.')
    if (!deployerKey) throw new Error('DEPLOYER_PRIVATE_KEY não configurado.')
    if (!bettingAddress) throw new Error('WALA_BETTING_ADDRESS não configurado.')

    const provider = new JsonRpcProvider(rpcUrl)
    const signer = new Wallet(deployerKey, provider)
    const betting = new Contract(bettingAddress, BETTING_ABI, signer)

    const url = new URL(request.url)
    const manualFixtureId = normalizeFixtureId(url.searchParams.get('fixtureId') || '')

    const fixtureIds = manualFixtureId
      ? [manualFixtureId]
      : await getTrackedFixtureIds(betting, deployBlock)

    const summary = {
      ok: true,
      keeper: 'polygon-football-keeper',
      operator: signer.address,
      bettingAddress,
      scanned: 0,
      skippedResolved: 0,
      waitingMatch: 0,
      closed: 0,
      resolved: 0,
      noWinnerInfo: 0,
      rateLimited: false,
      actions: [],
      errors: [],
    }

    for (const fixtureId of fixtureIds) {
      summary.scanned += 1

      try {
        const marketState = await betting.getMarketState(BigInt(fixtureId))
        const exists = Boolean(marketState[0])

        if (!exists) {
          continue
        }

        const marketStatus = Number(marketState[3])

        if (marketStatus === MARKET_STATUS.RESOLVED) {
          summary.skippedResolved += 1
          continue
        }

        let matchData

        try {
          matchData = await footballDataGetMatch(fixtureId, footballToken)
        } catch (error) {
          if (error?.code === 'RATE_LIMIT') {
            summary.rateLimited = true
            summary.errors.push(`fixture ${fixtureId}: rate limit do football-data`)
            break
          }

          summary.errors.push(`fixture ${fixtureId}: erro football-data - ${error?.message || error}`)
          continue
        }

        const matchStatus = String(matchData?.status || '').trim()

        if (MATCH_OPEN_STATUSES.has(matchStatus)) {
          summary.waitingMatch += 1
          continue
        }

        if (MATCH_LIVE_STATUSES.has(matchStatus)) {
          if (marketStatus === MARKET_STATUS.OPEN) {
            await maybeCloseMarket(betting, fixtureId, summary)
          }
          continue
        }

        if (MATCH_FINISHED_STATUSES.has(matchStatus)) {
          const winningOutcome = getWinningOutcomeFromMatch(matchData)

          if (winningOutcome === null) {
            summary.noWinnerInfo += 1
            summary.errors.push(`fixture ${fixtureId}: sem winner claro na resposta`)
            continue
          }

          await maybeResolveMarket(betting, fixtureId, winningOutcome, summary)
          continue
        }

        summary.waitingMatch += 1
      } catch (error) {
        summary.errors.push(`fixture ${fixtureId}: ${error?.message || error}`)
      }
    }

    return json(summary)
  } catch (error) {
    return json(
      {
        ok: false,
        error: error?.message || String(error),
      },
      500
    )
  }
}