// netlify/functions/sync-football.js
import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

const COMPETITIONS = [
  { code: 'BSA', fallbackName: 'Brasileirão Série A', maxMatches: 12 },
  { code: 'PL',  fallbackName: 'Premier League',        maxMatches: 10 },
  { code: 'PD',  fallbackName: 'La Liga',               maxMatches: 10 },
  { code: 'BL1', fallbackName: 'Bundesliga',            maxMatches: 10 },
  { code: 'SA',  fallbackName: 'Serie A',               maxMatches: 10 },
  { code: 'CL',  fallbackName: 'Champions League',      maxMatches: 8 }
]

if (!getApps().length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
  initializeApp({ credential: cert(serviceAccount) })
}

const db = getFirestore()

function formatDateYMD(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms))

async function footballDataGetJson(url, token) {
  const response = await fetch(url, {
    headers: { 'X-Auth-Token': token }
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || `football-data ${response.status}`)
  }

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

function getRecentFormScore(matches = [], teamId) {
  const recentMatches = matches.slice(0, 5)

  let points = 0, goalDiff = 0, goalsFor = 0

  for (const match of recentMatches) {
    const { goalsFor: gf, goalsAgainst: ga } = getTeamGoalsFromMatch(match, teamId)
    goalsFor += gf
    goalDiff += gf - ga
    if (gf > ga) points += 3
    else if (gf === ga) points += 1
  }

  return { score: (points * 100) + (goalDiff * 10) + goalsFor }
}

function buildThreeWayProbabilities(homeForm, awayForm) {
  const diff = (homeForm?.score || 0) - (awayForm?.score || 0)
  const absDiff = Math.abs(diff)

  if (absDiff <= 50) return { homeProbBps: 4000, drawProbBps: 2000, awayProbBps: 4000 }

  let favorite = 7500, draw = 1000, underdog = 1500
  if (absDiff >= 300) { favorite = 7900; draw = 900; underdog = 1200 }

  return diff > 0
    ? { homeProbBps: favorite, drawProbBps: draw, awayProbBps: underdog }
    : { homeProbBps: underdog, drawProbBps: draw, awayProbBps: favorite }
}

export default async function handler() {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
  }

  try {
    const token = process.env.FOOTBALL_DATA_TOKEN
    if (!token) throw new Error('FOOTBALL_DATA_TOKEN não configurado.')

    const now = new Date()
    const dateFrom = formatDateYMD(now)
    const limitDate = new Date(now)
    limitDate.setDate(limitDate.getDate() + 12)
    const dateTo = formatDateYMD(limitDate)

    const teamRecentMatchesCache = new Map()
    const allMatches = []

    console.log(`🔄 Iniciando sync: ${dateFrom} → ${dateTo}`)

    async function getTeamRecentMatches(teamId) {
      await delay(80) // bem mais rápido
      const cacheKey = String(teamId)
      if (teamRecentMatchesCache.has(cacheKey)) return teamRecentMatchesCache.get(cacheKey)

      try {
        const data = await footballDataGetJson(
          `https://api.football-data.org/v4/teams/${teamId}/matches?status=FINISHED&limit=5`,
          token
        )
        const recent = Array.isArray(data?.matches) ? data.matches : []
        teamRecentMatchesCache.set(cacheKey, recent)
        return recent
      } catch {
        return []
      }
    }

    for (const competition of COMPETITIONS) {
      await delay(250)

      try {
        const data = await footballDataGetJson(
          `https://api.football-data.org/v4/competitions/${competition.code}/matches?status=SCHEDULED,TIMED&dateFrom=${dateFrom}&dateTo=${dateTo}`,
          token
        )

        let matches = Array.isArray(data?.matches) ? data.matches : []

        matches = sortByUtcDateAsc(matches).filter(m =>
          ['SCHEDULED', 'TIMED'].includes(m?.status) &&
          m?.homeTeam?.id && m?.awayTeam?.id &&
          m?.homeTeam?.name && m?.awayTeam?.name &&
          m?.utcDate
        )

        console.log(`✅ ${competition.code} → ${matches.length} jogos encontrados`)

        const limited = matches.slice(0, competition.maxMatches)

        for (const match of limited) {
          const homeId = Number(match.homeTeam.id)
          const awayId = Number(match.awayTeam.id)

          let probabilities = { homeProbBps: 4000, drawProbBps: 2000, awayProbBps: 4000 }

          try {
            const [homeRecent, awayRecent] = await Promise.all([
              getTeamRecentMatches(homeId),
              getTeamRecentMatches(awayId)
            ])

            probabilities = buildThreeWayProbabilities(
              getRecentFormScore(homeRecent, homeId),
              getRecentFormScore(awayRecent, awayId)
            )
          } catch {}

          const matchDoc = {
            fixtureId: Number(match.id),
            competitionCode: competition.code,
            league: match.competition?.name || competition.fallbackName,
            teamA: match.homeTeam.name,
            teamB: match.awayTeam.name,
            homeTeamId: homeId,
            awayTeamId: awayId,
            utcDate: match.utcDate,
            kickoffAt: match.utcDate,
            time: new Date(match.utcDate).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }),
            status: match.status,
            homeProbBps: probabilities.homeProbBps,
            drawProbBps: probabilities.drawProbBps,
            awayProbBps: probabilities.awayProbBps,
            updatedAt: FieldValue.serverTimestamp()
          }

          await db.collection('football_matches').doc(String(match.id)).set(matchDoc, { merge: true })
          allMatches.push(matchDoc)
        }
      } catch (error) {
        console.error(`❌ ${competition.code}:`, error.message)
      }
    }

    await db.collection('football_metadata').doc('sync_status').set({
      lastSyncAt: FieldValue.serverTimestamp(),
      totalMatches: allMatches.length,
      dateFrom,
      dateTo
    }, { merge: true })

    console.log(`🎉 SYNC FINALIZADO → ${allMatches.length} jogos salvos`)

    return new Response(JSON.stringify({
      success: true,
      syncedMatches: allMatches.length,
      dateFrom,
      dateTo
    }), { status: 200, headers })

  } catch (error) {
    console.error('Erro geral:', error)
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers })
  }
}