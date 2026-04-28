// netlify/functions/football-keeper.mjs
import { Contract, JsonRpcProvider, Wallet } from 'ethers'

const DEFAULT_BETTING_ADDRESS = '0x486ea8E0E7C320b0b4940bce4e8Bf09905cf917f'

const MATCH_FINISHED_STATUSES = new Set(['FINISHED'])
const MARKET_STATUS = { OPEN: 0, CLOSED: 1, RESOLVED: 2 }
const OUTCOME = { HOME: 0, DRAW: 1, AWAY: 2 }

const BETTING_ABI = [
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
  return String(process.env.POLYGON_RPC_URL || '').trim()
}

function getBettingAddress() {
  return String(process.env.WALA_BETTING_ADDRESS || DEFAULT_BETTING_ADDRESS).trim()
}

function getDeployerKey() {
  return String(process.env.DEPLOYER_PRIVATE_KEY || '').trim()
}

async function footballDataGetMatch(fixtureId, token) {
  const res = await fetch(`https://api.football-data.org/v4/matches/${fixtureId}`, {
    headers: { 'X-Auth-Token': token }
  })

  if (res.status === 429) throw new Error('Rate limit da Football-Data')
  if (!res.ok) throw new Error(`Football-Data Error ${res.status}`)

  return res.json()
}

function getWinningOutcome(match) {
  if (!match?.score?.fullTime) return null

  const home = Number(match.score.fullTime.homeTeam)
  const away = Number(match.score.fullTime.awayTeam)

  if (home > away) return OUTCOME.HOME
  if (away > home) return OUTCOME.AWAY
  return OUTCOME.DRAW
}

export default async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*' } })
  if (request.method !== 'GET') return json({ ok: false, error: 'Método não permitido' }, 405)

  try {
    const fixtureId = new URL(request.url).searchParams.get('fixtureId')?.trim()

    if (!fixtureId || !/^\d+$/.test(fixtureId)) {
      return json({ ok: false, error: 'fixtureId inválido ou não informado' }, 400)
    }

    const rpcUrl = getRpcUrl()
    const footballToken = getFootballToken()
    const deployerKey = getDeployerKey()
    const bettingAddress = getBettingAddress()

    if (!rpcUrl) throw new Error('POLYGON_RPC_URL não configurado')
    if (!footballToken) throw new Error('FOOTBALL_DATA_TOKEN não configurado')
    if (!deployerKey) throw new Error('DEPLOYER_PRIVATE_KEY não configurado')

    const provider = new JsonRpcProvider(rpcUrl)
    const signer = new Wallet(deployerKey, provider)
    const betting = new Contract(bettingAddress, BETTING_ABI, signer)

    console.log(`[KEEPER] Processando fixture ${fixtureId} | Operator: ${signer.address}`)

    // Busca status do mercado
    const marketState = await betting.getMarketState(BigInt(fixtureId))
    const exists = Boolean(marketState[0])
    const currentStatus = Number(marketState[3])

    if (!exists) {
      return json({ ok: false, error: 'Mercado não existe no contrato' })
    }

    if (currentStatus === MARKET_STATUS.RESOLVED) {
      return json({
        ok: true,
        fixtureId,
        alreadyResolved: true,
        winningOutcome: Number(marketState[5])
      })
    }

    // Busca resultado na API
    const matchData = await footballDataGetMatch(fixtureId, footballToken)
    const matchStatus = String(matchData.status || '')

    if (!MATCH_FINISHED_STATUSES.has(matchStatus)) {
      return json({
        ok: true,
        fixtureId,
        matchStatus,
        action: 'waiting',
        message: 'Jogo ainda não finalizado'
      })
    }

    const winningOutcome = getWinningOutcome(matchData)
    if (winningOutcome === null) {
      return json({ ok: false, error: 'Não foi possível determinar o vencedor' })
    }

    // Fecha o mercado se ainda estiver aberto
    if (currentStatus === MARKET_STATUS.OPEN) {
      console.log(`[KEEPER] Fechando mercado ${fixtureId}`)
      const closeTx = await betting.closeMarket(BigInt(fixtureId))
      await closeTx.wait()
    }

    // Resolve o mercado
    console.log(`[KEEPER] Resolvendo mercado ${fixtureId} → Outcome ${winningOutcome}`)
    const resolveTx = await betting.resolveMarket(BigInt(fixtureId), winningOutcome)
    await resolveTx.wait()

    console.log(`✅ [KEEPER] Sucesso! Fixture ${fixtureId} resolvido.`)

    return json({
      ok: true,
      fixtureId,
      action: 'resolved',
      winningOutcome,
      matchStatus,
      txHash: resolveTx.hash
    })

  } catch (error) {
    console.error('[KEEPER ERROR]', error.message)
    return json({
      ok: false,
      error: error.message || 'Erro interno no keeper'
    }, 500)
  }
}