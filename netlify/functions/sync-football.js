import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

const COMPETITIONS = [
  { code: 'BSA', fallbackName: 'Campeonato Brasileiro Série A', maxMatches: 10 },
  { code: 'PL', fallbackName: 'Premier League', maxMatches: 10 },
  { code: 'CL', fallbackName: 'UEFA Champions League', maxMatches: 10 },
  { code: 'PD', fallbackName: 'La Liga', maxMatches: 10 },
  { code: 'SA', fallbackName: 'Serie A', maxMatches: 10 },
  { code: 'BL1', fallbackName: 'Bundesliga', maxMatches: 10 },
  { code: 'FL1', fallbackName: 'Ligue 1', maxMatches: 10 },
  { code: 'CLI', fallbackName: 'Copa Libertadores', maxMatches: 10 },
  { code: 'CSA', fallbackName: 'Copa Sul-Americana', maxMatches: 10 }
]

if (!getApps().length) {
  initializeApp({
    credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
  })
}

const db = getFirestore()

function formatDateYMD(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

async function footballDataGetJson(url, token) {
  const response = await fetch(url, {
    headers: {
      'X-Auth-Token': token
    }
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || `football-data ${response.status}`)
  }

  return response.json()
}

function sortByUtcDateAsc(list = []) {
  return [...list].sort(
    (a, b) => new Date(a?.utcDate || 0) - new Date(b?.utcDate || 0)
  )
}

function sortByUtcDateDesc(list = []) {
  return [...list].sort(
    (a, b) => new Date(b?.utcDate || 0) - new Date(a?.utcDate || 0)
  )
}

function getTeamGoalsFromMatch(match, teamId) {
  const homeId = Number(match?.homeTeam?.id || 0)
  const awayId = Number(match?.awayTeam?.id || 0)

  const homeGoals = Number(match?.score?.fullTime?.home ?? match?.score?.fullTime?.homeTeam ?? 0)
  const awayGoals = Number(match?.score?.fullTime?.away ?? match?.score?.fullTime?.awayTeam ?? 0)

  if (teamId === homeId) {
    return { goalsFor: homeGoals, goalsAgainst: awayGoals }
  }

  if (teamId === awayId) {
    return { goalsFor: awayGoals, goalsAgainst: homeGoals }
  }

  return { goalsFor: 0, goalsAgainst: 0 }
}

function getRecentFormScore(matches = [], teamId) {
  const recentMatches = sortByUtcDateDesc(matches).slice(0, 3)

  let points = 0
  let goalDiff = 0
  let goalsFor = 0

  for (const match of recentMatches) {
    const { goalsFor: gf, goalsAgainst: ga } = getTeamGoalsFromMatch(match, teamId)

    goalsFor += gf
    goalDiff += gf - ga

    if (gf > ga) points += 3
    else if (gf === ga) points += 1
  }

  return {
    matches: recentMatches.length,
    points,
    goalDiff,
    goalsFor,
    score: (points * 100) + (goalDiff * 10) + goalsFor
  }
}

function buildThreeWayProbabilities(homeForm, awayForm) {
  if (!homeForm?.matches || !awayForm?.matches) {
    return { homeProbBps: 4000, drawProbBps: 2000, awayProbBps: 4000 }
  }

  const diff = Number(homeForm.score || 0) - Number(awayForm.score || 0)
  const absDiff = Math.abs(diff)

  if (absDiff <= 40) {
    return { homeProbBps: 4000, drawProbBps: 2000, awayProbBps: 4000 }
  }

  let favoriteBps = 7500
  let drawBps = 1000
  let underdogBps = 1500

  if (absDiff >= 360) {
    favoriteBps = 8000
    drawBps = 800
    underdogBps = 1200
  } else if (absDiff >= 220) {
    favoriteBps = 7800
    drawBps = 900
    underdogBps = 1300
  }

  return diff > 0
    ? { homeProbBps: favoriteBps, drawProbBps: drawBps, awayProbBps: underdogBps }
    : { homeProbBps: underdogBps, drawProbBps: drawBps, awayProbBps: favoriteBps }
}

export default async function handler() {
  const headers = { 'Content-Type': 'application/json' }

  try {
    const token = process.env.FOOTBALL_DATA_TOKEN

    if (!token) {
      return new Response(JSON.stringify({ error: 'FOOTBALL_DATA_TOKEN não configurado.' }), {
        status: 500,
        headers
      })
    }

    const now = new Date()
    const dateFrom = formatDateYMD(now)

    const limitDate = new Date(now)
    limitDate.setDate(limitDate.getDate() + 5)
    const dateTo = formatDateYMD(limitDate)

    const teamRecentMatchesCache = new Map()
    const allMatches = []

    async function getTeamRecentMatches(teamId) {
      const cacheKey = String(teamId)

      if (teamRecentMatchesCache.has(cacheKey)) {
        return teamRecentMatchesCache.get(cacheKey)
      }

      const teamData = await footballDataGetJson(
        `https://api.football-data.org/v4/teams/${teamId}/matches?status=FINISHED&limit=3`,
        token
      )

      const recentMatches = Array.isArray(teamData?.matches)
        ? sortByUtcDateDesc(teamData.matches).slice(0, 3)
        : []

      teamRecentMatchesCache.set(cacheKey, recentMatches)
      return recentMatches
    }

    for (const competition of COMPETITIONS) {
      try {
        const data = await footballDataGetJson(
          `https://api.football-data.org/v4/competitions/${competition.code}/matches?status=SCHEDULED,TIMED&dateFrom=${dateFrom}&dateTo=${dateTo}`,
          token
        )

        const matches = Array.isArray(data?.matches)
          ? sortByUtcDateAsc(data.matches)
              .filter(match =>
                ['SCHEDULED', 'TIMED'].includes(match?.status) &&
                match?.homeTeam?.id &&
                match?.awayTeam?.id &&
                match?.utcDate
              )
              .slice(0, competition.maxMatches)
          : []

        for (const match of matches) {
          const homeTeamId = Number(match.homeTeam.id)
          const awayTeamId = Number(match.awayTeam.id)

          let probabilities = {
            homeProbBps: 4000,
            drawProbBps: 2000,
            awayProbBps: 4000
          }

          try {
            const [homeRecent, awayRecent] = await Promise.all([
              getTeamRecentMatches(homeTeamId),
              getTeamRecentMatches(awayTeamId)
            ])

            probabilities = buildThreeWayProbabilities(
              getRecentFormScore(homeRecent, homeTeamId),
              getRecentFormScore(awayRecent, awayTeamId)
            )
          } catch (error) {
            console.error(`Erro ao calcular probabilidades do jogo ${match.id}:`, error)
          }

          const matchDoc = {
            fixtureId: Number(match.id),
            competitionCode: competition.code,
            league: match.competition?.name || competition.fallbackName,
            teamA: match.homeTeam.name,
            teamB: match.awayTeam.name,
            homeTeamId,
            awayTeamId,
            utcDate: match.utcDate,
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
        console.error(`Erro na competição ${competition.code}:`, error)
      }
    }

    await db.collection('football_metadata').doc('sync_status').set({
      lastSyncAt: FieldValue.serverTimestamp(),
      totalMatches: allMatches.length,
      competitions: COMPETITIONS.length
    }, { merge: true })

    return new Response(JSON.stringify({
      success: true,
      syncedMatches: allMatches.length,
      competitions: COMPETITIONS.length
    }), {
      status: 200,
      headers
    })
  } catch (error) {
    return new Response(JSON.stringify({
      error: error.message || 'Erro interno.'
    }), {
      status: 500,
      headers
    })
  }
}