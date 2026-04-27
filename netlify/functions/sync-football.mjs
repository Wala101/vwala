// netlify/functions/sync-football.mjs
import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

const COMPETITIONS = [
  { code: 'BSA', fallbackName: 'Campeonato Brasileiro Série A', maxMatches: 12 },
  { code: 'PL',  fallbackName: 'Premier League', maxMatches: 10 },
  { code: 'CL',  fallbackName: 'UEFA Champions League', maxMatches: 10 },
  { code: 'PD',  fallbackName: 'La Liga', maxMatches: 10 },
  { code: 'SA',  fallbackName: 'Serie A', maxMatches: 10 },
  { code: 'BL1', fallbackName: 'Bundesliga', maxMatches: 10 },
  { code: 'FL1', fallbackName: 'Ligue 1', maxMatches: 10 },
  { code: 'CLI', fallbackName: 'Copa Libertadores', maxMatches: 10 },
  { code: 'CSA', fallbackName: 'Copa Sul-Americana', maxMatches: 8 }
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
  const recentMatches = sortByUtcDateDesc(matches).slice(0, 3)
  // ... (mantive sua função original)
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
  // mantive sua função original
  if (!homeForm?.matches || !awayForm?.matches) {
    return { homeProbBps: 4000, drawProbBps: 2000, awayProbBps: 4000 }
  }

  const diff = Number(homeForm.score || 0) - Number(awayForm.score || 0)
  const absDiff = Math.abs(diff)

  if (absDiff <= 40) return { homeProbBps: 4000, drawProbBps: 2000, awayProbBps: 4000 }

  let favoriteBps = 7500, drawBps = 1000, underdogBps = 1500

  if (absDiff >= 360) { favoriteBps = 8000; drawBps = 800; underdogBps = 1200 }
  else if (absDiff >= 220) { favoriteBps = 7800; drawBps = 900; underdogBps = 1300 }

  return diff > 0
    ? { homeProbBps: favoriteBps, drawProbBps: drawBps, awayProbBps: underdogBps }
    : { homeProbBps: underdogBps, drawProbBps: drawBps, awayProbBps: favoriteBps }
}

export default async function handler() {
  try {
    const token = process.env.FOOTBALL_DATA_TOKEN
    if (!token) throw new Error('FOOTBALL_DATA_TOKEN não configurado')

    const now = new Date()
    const dateFrom = formatDateYMD(now)
    const limitDate = new Date(now)
    limitDate.setDate(limitDate.getDate() + 8) // +8 dias pra não demorar muito
    const dateTo = formatDateYMD(limitDate)

    const teamRecentMatchesCache = new Map()
    let totalSaved = 0

    console.log(`🔄 Iniciando sync: ${dateFrom} → ${dateTo}`)

    for (const competition of COMPETITIONS) {
      await delay(200)

      try {
        const competitionData = await footballDataGetJson(
          `https://api.football-data.org/v4/competitions/${competition.code}/matches?status=SCHEDULED,TIMED&dateFrom=${dateFrom}&dateTo=${dateTo}`,
          token
        )

        const scheduledMatches = sortByUtcDateAsc(competitionData?.matches || [])
          .filter(match =>
            ['SCHEDULED', 'TIMED'].includes(match?.status) &&
            match?.homeTeam?.id && match?.awayTeam?.id &&
            match?.homeTeam?.name && match?.awayTeam?.name &&
            match?.utcDate
          )
          .slice(0, competition.maxMatches)

        console.log(`✅ ${competition.code} → ${scheduledMatches.length} jogos`)

        for (const match of scheduledMatches) {
          const homeTeamId = Number(match.homeTeam.id)
          const awayTeamId = Number(match.awayTeam.id)

          let probabilities = { homeProbBps: 4000, drawProbBps: 2000, awayProbBps: 4000 }

          try {
            const [homeRecent, awayRecent] = await Promise.all([
              getTeamRecentMatches(homeTeamId),
              getTeamRecentMatches(awayTeamId)
            ])

            const homeForm = getRecentFormScore(homeRecent, homeTeamId)
            const awayForm = getRecentFormScore(awayRecent, awayTeamId)

            probabilities = buildThreeWayProbabilities(homeForm, awayForm)
          } catch (e) {
            console.warn(`Probabilidades falharam para ${match.id}`)
          }

          const matchDoc = {
            fixtureId: Number(match.id),
            competitionCode: competition.code,
            league: match.competition?.name || competition.fallbackName,
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

          await db.collection('football_matches')
            .doc(String(match.id))
            .set(matchDoc, { merge: true })

          totalSaved++
        }
      } catch (error) {
        console.error(`Erro na competição ${competition.code}:`, error.message)
      }
    }

    await db.collection('football_metadata').doc('sync_status').set({
      lastSyncAt: FieldValue.serverTimestamp(),
      totalMatches: totalSaved
    }, { merge: true })

    console.log(`🎉 SYNC FINALIZADO → ${totalSaved} jogos salvos no Firebase`)

    return new Response(JSON.stringify({
      success: true,
      syncedMatches: totalSaved
    }), { status: 200 })

  } catch (error) {
    console.error('Erro geral:', error)
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500 })
  }

  // Função auxiliar
  async function getTeamRecentMatches(teamId) {
    const cacheKey = String(teamId)
    if (teamRecentMatchesCache.has(cacheKey)) return teamRecentMatchesCache.get(cacheKey)

    await delay(100)
    try {
      const data = await footballDataGetJson(
        `https://api.football-data.org/v4/teams/${teamId}/matches?status=FINISHED&limit=3`,
        process.env.FOOTBALL_DATA_TOKEN
      )
      const recent = Array.isArray(data?.matches) ? data.matches : []
      teamRecentMatchesCache.set(cacheKey, recent)
      return recent
    } catch {
      return []
    }
  }
}