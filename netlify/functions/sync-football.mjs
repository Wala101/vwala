// netlify/functions/sync-football.mjs
import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

const COMPETITIONS = [
  { code: 'BSA', fallbackName: 'Campeonato Brasileiro Série A', maxMatches: 20 }
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

// ==================== NOVAS FUNÇÕES ====================
async function getLast3Matches(teamId, token) {
  try {
    const data = await footballDataGetJson(
      `https://api.football-data.org/v4/teams/${teamId}/matches?status=FINISHED&limit=3`,
      token
    )
    return data.matches || []
  } catch (e) {
    console.warn(`⚠️ Erro ao buscar últimos jogos do time ${teamId}:`, e.message)
    return []
  }
}

function calculateFormProb(lastMatches = []) {
  if (lastMatches.length === 0) {
    return { wins: 33, draws: 34, losses: 33 }
  }

  let wins = 0, draws = 0

  lastMatches.forEach(m => {
    if (!m.score?.fullTime) return

    const homeG = m.score.fullTime.homeTeam ?? 0
    const awayG = m.score.fullTime.awayTeam ?? 0

    // Verifica se o time em questão ganhou ou empatou
    if (homeG > awayG) {
      if (m.homeTeam.id === m.homeTeam.id) wins++ // time da casa
      else if (m.awayTeam.id === m.homeTeam.id) draws++ // time visitante (empate)
    } else if (homeG === awayG) {
      draws++
    }
    // perda não precisa contar (fica no losses)
  })

  const played = lastMatches.length
  const winPct = Math.round((wins / played) * 100)
  const drawPct = Math.round((draws / played) * 100)

  return {
    wins: winPct,
    draws: drawPct,
    losses: 100 - winPct - drawPct
  }
}
// =======================================================

export default async () => {
  try {
    const token = process.env.FOOTBALL_DATA_TOKEN
    if (!token) throw new Error('Token não configurado')

    const now = new Date()
    const dateFrom = formatDateYMD(now)
    const limitDate = new Date(now)
    limitDate.setDate(limitDate.getDate() + 20)
    const dateTo = formatDateYMD(limitDate)

    console.log(`🔄 Sync Brasileirão iniciado: ${dateFrom} → ${dateTo}`)

    let totalSaved = 0
    const comp = COMPETITIONS[0]

    try {
      const data = await footballDataGetJson(
        `https://api.football-data.org/v4/competitions/${comp.code}/matches?status=SCHEDULED,TIMED&dateFrom=${dateFrom}&dateTo=${dateTo}`,
        token
      )

      const matches = sortByUtcDateAsc(data?.matches || []).filter(m =>
        ['SCHEDULED', 'TIMED'].includes(m?.status) && 
        m?.homeTeam?.id && 
        m?.awayTeam?.id &&
        m?.homeTeam?.name && 
        m?.awayTeam?.name
      )

      console.log(`✅ ${comp.code} → ${matches.length} jogos encontrados na API`)

      for (const match of matches) {
        // === CÁLCULO DAS PROBABILIDADES BASEADO NOS ÚLTIMOS 3 JOGOS ===
        const [homeLast3, awayLast3] = await Promise.all([
          getLast3Matches(match.homeTeam.id, token),
          getLast3Matches(match.awayTeam.id, token)
        ])

        const homeForm = calculateFormProb(homeLast3)
        const awayForm = calculateFormProb(awayLast3)

        // Combinação: forma recente + vantagem de casa
        let homeProb = (homeForm.wins * 1.35) + (homeForm.draws * 0.65)
        let drawProb = (homeForm.draws * 0.75) + (awayForm.draws * 0.75)
        let awayProb = (awayForm.wins * 0.85) + (awayForm.draws * 0.45)

        const total = homeProb + drawProb + awayProb || 100

        let homeProbBps = Math.round((homeProb / total) * 10000)
        let drawProbBps = Math.round((drawProb / total) * 10000)
        let awayProbBps = 10000 - homeProbBps - drawProbBps

        // Limites mínimos para evitar extremos absurdos
        homeProbBps = Math.max(2600, Math.min(6800, homeProbBps))
        awayProbBps = Math.max(1800, Math.min(5200, awayProbBps))
        drawProbBps = 10000 - homeProbBps - awayProbBps

        const matchData = {
          fixtureId: Number(match.id),
          competitionCode: comp.code,
          league: match.competition?.name || comp.fallbackName,
          teamA: match.homeTeam.name,
          teamB: match.awayTeam.name,
          utcDate: match.utcDate,
          time: new Date(match.utcDate).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }),
          status: match.status,
          matchday: match.matchday || null,
          
          homeProbBps,
          drawProbBps,
          awayProbBps,
          
          // Informações extras úteis
          homeRecentForm: `${homeForm.wins}V-${homeForm.draws}E-${homeForm.losses}D`,
          awayRecentForm: `${awayForm.wins}V-${awayForm.draws}E-${awayForm.losses}D`,
          
          updatedAt: FieldValue.serverTimestamp()
        }

        await db.collection('football_matches')
          .doc(String(match.id))
          .set(matchData, { merge: true })

        totalSaved++
      }
    } catch (e) {
      console.error(`❌ BSA:`, e.message)
    }

    await db.collection('football_metadata').doc('sync_status').set({
      lastSyncAt: FieldValue.serverTimestamp(),
      totalMatches: totalSaved,
      competition: 'BSA'
    }, { merge: true })

    console.log(`🎉 SYNC FINALIZADO → ${totalSaved} jogos salvos`)

    return new Response(JSON.stringify({ 
      success: true, 
      syncedMatches: totalSaved 
    }), { status: 200 })

  } catch (error) {
    console.error('Erro sync:', error)
    return new Response(JSON.stringify({ 
      success: false, 
      error: error.message 
    }), { status: 500 })
  }
}