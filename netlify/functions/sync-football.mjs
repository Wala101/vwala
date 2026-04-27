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

function getRecentFormScore(matches = [], teamId) {
  const recent = matches.slice(0, 4)
  let points = 0, goalDiff = 0

  for (const match of recent) {
    const { goalsFor: gf, goalsAgainst: ga } = getTeamGoalsFromMatch(match, teamId)
    goalDiff += gf - ga
    if (gf > ga) points += 3
    else if (gf === ga) points += 1
  }
  return { score: points * 100 + goalDiff * 10 }
}

function buildThreeWayProbabilities(homeForm, awayForm) {
  const diff = (homeForm?.score || 0) - (awayForm?.score || 0)
  const absDiff = Math.abs(diff)

  if (absDiff <= 50) return { homeProbBps: 4000, drawProbBps: 2200, awayProbBps: 3800 }

  let favorite = diff > 0 ? 7200 : 2800
  return {
    homeProbBps: diff > 0 ? favorite : 10000 - favorite - 1800,
    drawProbBps: 1800,
    awayProbBps: diff > 0 ? 10000 - favorite - 1800 : favorite
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
        `https://api.football-data.org/v4/teams/${teamId}/matches?status=FINISHED&limit=4`,
        process.env.FOOTBALL_DATA_TOKEN
      )
      const form = getRecentFormScore(data?.matches || [], teamId)
      teamCache.set(key, form)
      return form
    } catch {
      return { score: 0 }
    }
  }
}