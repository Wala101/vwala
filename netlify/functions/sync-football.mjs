// netlify/functions/sync-football.mjs
import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

const COMPETITIONS = [
  { code: 'BSA', fallbackName: 'Campeonato Brasileiro Série A', maxMatches: 12 },
  { code: 'PL',  fallbackName: 'Premier League', maxMatches: 10 },
  { code: 'CL',  fallbackName: 'UEFA Champions League', maxMatches: 10 },
  { code: 'PD',  fallbackName: 'La Liga', maxMatches: 10 },
  { code: 'SA',  fallbackName: 'Serie A', maxMatches: 10 }
]

if (!getApps().length) {
  initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) })
}

const db = getFirestore()

function formatDateYMD(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

async function footballDataGetJson(url, token) {
  const response = await fetch(url, { headers: { 'X-Auth-Token': token } })
  if (!response.ok) throw new Error(`API Error ${response.status}`)
  return response.json()
}

function sortByUtcDateAsc(list = []) {
  return [...list].sort((a, b) => new Date(a?.utcDate || 0).getTime() - new Date(b?.utcDate || 0).getTime())
}

function getTeamGoalsFromMatch(match, teamId) {
  const homeId = Number(match?.homeTeam?.id || 0)
  const awayId = Number(match?.awayTeam?.id || 0)

  const homeGoals = Number(match?.score?.fullTime?.home ?? match?.score?.fullTime?.homeTeam ?? 0)
  const awayGoals = Number(match?.score?.fullTime?.away ?? match?.score?.fullTime?.awayTeam ?? 0)

  if (teamId === homeId) return { goalsFor: homeGoals, goalsAgainst: awayGoals }
  if (teamId === awayId) return { goalsFor: awayGoals, goalsAgainst: homeGoals }
  return { goalsFor: 0, goalsAgainst: 0 }
}

// ====================== MELHORIA AQUI ======================
function getRecentFormScore(matches = [], teamId) {
  const recent = matches.slice(0, 5) // últimos 5 jogos
  let points = 0
  let goalDiff = 0
  let goalsFor = 0
  let wins = 0

  for (const match of recent) {
    const { goalsFor: gf, goalsAgainst: ga } = getTeamGoalsFromMatch(match, teamId)
    goalsFor += gf
    goalDiff += gf - ga

    if (gf > ga) {
      points += 3
      wins += 1
    } else if (gf === ga) {
      points += 1
    }
  }

  return {
    points,
    goalDiff,
    goalsFor,
    wins,
    score: points * 110 + goalDiff * 18 + wins * 80   // pontuação mais equilibrada
  }
}

// ====================== MELHORIA AQUI ======================
function buildThreeWayProbabilities(homeForm, awayForm) {
  const homeScore = homeForm?.score || 3800
  const awayScore = awayForm?.score || 3800

  let diff = homeScore - awayScore

  // Vantagem de mandante (importante no futebol)
  diff += 220

  const absDiff = Math.abs(diff)

  let homeProb = 4000
  let drawProb = 2400
  let awayProb = 3600

  if (absDiff >= 650) {
    // Jogo muito desequilibrado
    homeProb = diff > 0 ? 7200 : 1600
    awayProb = diff > 0 ? 1600 : 7200
    drawProb = 1200
  } 
  else if (absDiff >= 350) {
    // Favorito claro
    homeProb = diff > 0 ? 6200 : 2200
    awayProb = diff > 0 ? 2200 : 6200
    drawProb = 1600
  } 
  else if (absDiff >= 120) {
    // Leve favorito
    homeProb = diff > 0 ? 5200 : 3000
    awayProb = diff > 0 ? 3000 : 5200
    drawProb = 1800
  } 
  else {
    // Jogo equilibrado
    homeProb = 4600
    awayProb = 3200
    drawProb = 2200
  }

  // Normaliza para exatamente 10000
  const total = homeProb + drawProb + awayProb
  const factor = 10000 / total

  homeProb = Math.round(homeProb * factor)
  drawProb = Math.round(drawProb * factor)
  awayProb = 10000 - homeProb - drawProb

  return {
    homeProbBps: homeProb,
    drawProbBps: drawProb,
    awayProbBps: awayProb
  }
}

export default async () => {
  try {
    const token = process.env.FOOTBALL_DATA_TOKEN
    if (!token) throw new Error('Token não configurado')

    const now = new Date()
    const dateFrom = formatDateYMD(now)
    const dateTo = new Date(now.getTime() + 12*86400000).toISOString().split('T')[0]

    console.log(`🔄 Sync iniciado: ${dateFrom} → ${dateTo}`)

    let totalSaved = 0
    const teamCache = new Map()

    for (const comp of COMPETITIONS) {
      try {
        const data = await footballDataGetJson(
          `https://api.football-data.org/v4/competitions/${comp.code}/matches?status=SCHEDULED,TIMED&dateFrom=${dateFrom}&dateTo=${dateTo}`,
          token
        )

        const matches = sortByUtcDateAsc(data?.matches || []).filter(m =>
          ['SCHEDULED', 'TIMED'].includes(m?.status) && m.homeTeam?.id && m.awayTeam?.id
        )

        console.log(`✅ ${comp.code} → ${matches.length} jogos`)

        for (const match of matches.slice(0, comp.maxMatches)) {
          const homeId = Number(match.homeTeam.id)
          const awayId = Number(match.awayTeam.id)

          let probabilities = { homeProbBps: 4000, drawProbBps: 2000, awayProbBps: 4000 }

          try {
            const [homeRecent, awayRecent] = await Promise.all([
              getRecentForm(homeId),
              getRecentForm(awayId)
            ])
            probabilities = buildThreeWayProbabilities(homeRecent, awayRecent)
          } catch {}

          const matchData = {
            fixtureId: Number(match.id),
            competitionCode: comp.code,
            league: match.competition?.name || comp.fallbackName,
            teamA: match.homeTeam.name,
            teamB: match.awayTeam.name,
            utcDate: match.utcDate,
            time: new Date(match.utcDate).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }),
            status: match.status,
            homeProbBps: probabilities.homeProbBps,
            drawProbBps: probabilities.drawProbBps,
            awayProbBps: probabilities.awayProbBps,
            updatedAt: FieldValue.serverTimestamp()
          }

          await db.collection('football_matches').doc(String(match.id)).set(matchData, { merge: true })
          totalSaved++
        }
      } catch (e) {
        console.error(`❌ ${comp.code}:`, e.message)
      }
    }

    await db.collection('football_metadata').doc('sync_status').set({
      lastSyncAt: FieldValue.serverTimestamp(),
      totalMatches: totalSaved
    }, { merge: true })

    console.log(`🎉 SYNC FINALIZADO → ${totalSaved} jogos salvos`)

    return new Response(JSON.stringify({ success: true, syncedMatches: totalSaved }), { status: 200 })

  } catch (error) {
    console.error('Erro sync:', error)
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500 })
  }

  async function getRecentForm(teamId) {
    const key = String(teamId)
    if (teamCache.has(key)) return teamCache.get(key)

    try {
      const data = await footballDataGetJson(
        `https://api.football-data.org/v4/teams/${teamId}/matches?status=FINISHED&limit=5`,
        process.env.FOOTBALL_DATA_TOKEN
      )
      const form = getRecentFormScore(data?.matches || [], teamId)
      teamCache.set(key, form)
      return form
    } catch {
      return { score: 3800 }
    }
  }
}