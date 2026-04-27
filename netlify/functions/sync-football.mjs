// netlify/functions/sync-football.mjs
import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

const COMPETITIONS = [
  { code: 'BSA', fallbackName: 'Campeonato Brasileiro Série A', maxMatches: 15 },
  { code: 'PL',  fallbackName: 'Premier League', maxMatches: 12 },
  { code: 'CL',  fallbackName: 'UEFA Champions League', maxMatches: 10 },
  { code: 'PD',  fallbackName: 'La Liga', maxMatches: 12 },
  { code: 'SA',  fallbackName: 'Serie A', maxMatches: 12 },
  { code: 'BL1', fallbackName: 'Bundesliga', maxMatches: 10 },
  { code: 'FL1', fallbackName: 'Ligue 1', maxMatches: 10 }
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

function sortByUtcDateDesc(list = []) {
  return [...list].sort((a, b) => new Date(b?.utcDate || 0).getTime() - new Date(a?.utcDate || 0).getTime())
}

// Funções originais mantidas
function getTeamGoalsFromMatch(match, teamId) { /* ... sua função original */ }
function getRecentFormScore(matches = [], teamId) { /* ... sua função original */ }
function buildThreeWayProbabilities(homeForm, awayForm) { /* ... sua função original */ }

export default async () => {
  const jsonHeaders = {
    'content-type': 'application/json',
    'cache-control': 'public, max-age=180, s-maxage=180'
  }

  try {
    const token = process.env.FOOTBALL_DATA_TOKEN
    if (!token) {
      return new Response(JSON.stringify({ error: 'FOOTBALL_DATA_TOKEN não configurado.' }), { status: 500, headers: jsonHeaders })
    }

    const now = new Date()
    const dateFrom = formatDateYMD(now)
    const limitDate = new Date(now)
    limitDate.setDate(limitDate.getDate() + 10)   // Aumentado para ter mais jogos
    const dateTo = formatDateYMD(limitDate)

    const teamRecentMatchesCache = new Map()
    const matches = []

    console.log(`🔄 Sync iniciado: ${dateFrom} até ${dateTo}`)

    for (const competition of COMPETITIONS) {
      let competitionData

      try {
        competitionData = await footballDataGetJson(
          `https://api.football-data.org/v4/competitions/${competition.code}/matches?status=SCHEDULED,TIMED&dateFrom=${dateFrom}&dateTo=${dateTo}`,
          token
        )
      } catch (error) {
        console.error(`Erro ao buscar ${competition.code}:`, error)
        continue
      }

      const scheduledMatches = Array.isArray(competitionData?.matches)
        ? sortByUtcDateAsc(competitionData.matches)
            .filter((match) =>
              ['SCHEDULED', 'TIMED'].includes(match?.status) &&
              match?.homeTeam?.id &&
              match?.awayTeam?.id &&
              match?.homeTeam?.name &&
              match?.awayTeam?.name &&
              match?.utcDate
            )
            .slice(0, competition.maxMatches)
        : []

      console.log(`✅ ${competition.code} → ${scheduledMatches.length} jogos encontrados`)

      for (const match of scheduledMatches) {
        const homeTeamId = Number(match.homeTeam.id)
        const awayTeamId = Number(match.awayTeam.id)

        let probabilities = { homeProbBps: 4000, drawProbBps: 2000, awayProbBps: 4000 }

        try {
          const [homeRecentMatches, awayRecentMatches] = await Promise.all([
            getTeamRecentMatches(homeTeamId),
            getTeamRecentMatches(awayTeamId)
          ])

          const homeForm = getRecentFormScore(homeRecentMatches, homeTeamId)
          const awayForm = getRecentFormScore(awayRecentMatches, awayTeamId)

          probabilities = buildThreeWayProbabilities(homeForm, awayForm)
        } catch (error) {
          console.error(`Erro ao calcular favorito do jogo ${match.id}:`, error)
        }

        const matchData = {
          fixtureId: Number(match.id),
          league: match.competition?.name || competition.fallbackName,
          teamA: match.homeTeam?.name || 'Time A',
          teamB: match.awayTeam?.name || 'Time B',
          time: new Date(match.utcDate).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }),
          utcDate: match.utcDate,
          status: match.status,
          homeProbBps: probabilities.homeProbBps,
          drawProbBps: probabilities.drawProbBps,
          awayProbBps: probabilities.awayProbBps
        }

        // 🔥 SALVA NO FIREBASE
        await db.collection('football_matches')
          .doc(String(match.id))
          .set({
            ...matchData,
            competitionCode: competition.code,
            updatedAt: FieldValue.serverTimestamp()
          }, { merge: true })

        matches.push(matchData)
      }
    }

    console.log(`✅ ${matches.length} jogos salvos no Firebase`)

    return new Response(
      JSON.stringify({ matches }),
      { status: 200, headers: jsonHeaders }
    )
  } catch (error) {
    console.error('Erro geral:', error)
    return new Response(
      JSON.stringify({ error: error.message || 'Erro interno.' }),
      { status: 500, headers: jsonHeaders }
    )
  }
}

// Função auxiliar (mantida)
async function getTeamRecentMatches(teamId) {
  // ... (sua função original)
}