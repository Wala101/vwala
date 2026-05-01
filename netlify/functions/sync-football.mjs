// netlify/functions/sync-football.mjs
import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

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
  if (!response.ok) {
    console.error(`❌ API Error ${response.status} - ${url}`)
    throw new Error(`API Error ${response.status}`)
  }
  return response.json()
}

function sortByUtcDateAsc(list = []) {
  return [...list].sort((a, b) => new Date(a?.utcDate || 0).getTime() - new Date(b?.utcDate || 0).getTime())
}

// ==================== ÚLTIMOS 3 JOGOS ====================
async function getLast3Matches(teamId, token) {
  try {
    const data = await footballDataGetJson(
      `https://api.football-data.org/v4/teams/${teamId}/matches?status=FINISHED&limit=3`,
      token
    )
    return data.matches || []
  } catch (e) {
    console.warn(`⚠️ Erro últimos jogos ${teamId}:`, e.message)
    return []
  }
}

function calculateFormProb(lastMatches = []) {
  if (lastMatches.length === 0) return { wins: 33, draws: 34, losses: 33 }

  let wins = 0, draws = 0

  lastMatches.forEach(m => {
    if (!m.score?.fullTime) return
    const hg = m.score.fullTime.homeTeam ?? 0
    const ag = m.score.fullTime.awayTeam ?? 0

    if (hg > ag) wins++
    else if (hg === ag) draws++
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
    limitDate.setDate(limitDate.getDate() + 25)   // pega até 25 dias pra frente
    const dateTo = formatDateYMD(limitDate)

    console.log(`🔄 Sync Brasileirão Série A iniciado: ${dateFrom} → ${dateTo}`)

    let totalSaved = 0

    // === BUSCA APENAS BSA ===
    const data = await footballDataGetJson(
      `https://api.football-data.org/v4/competitions/BSA/matches?status=SCHEDULED,TIMED&dateFrom=${dateFrom}&dateTo=${dateTo}`,
      token
    )

    let matches = data?.matches || []
    console.log(`📊 Jogos brutos da API (BSA): ${matches.length}`)

    matches = sortByUtcDateAsc(matches).filter(m =>
      ['SCHEDULED', 'TIMED'].includes(m?.status) &&
      m?.homeTeam?.id && m?.awayTeam?.id &&
      m?.homeTeam?.name && m?.awayTeam?.name
    )

    console.log(`✅ Após filtro: ${matches.length} jogos válidos do Brasileirão`)

    for (const match of matches) {
      try {
        const [homeLast3, awayLast3] = await Promise.all([
          getLast3Matches(match.homeTeam.id, token),
          getLast3Matches(match.awayTeam.id, token)
        ])

        const homeForm = calculateFormProb(homeLast3)
        const awayForm = calculateFormProb(awayLast3)

        let homeProb = (homeForm.wins * 1.35) + (homeForm.draws * 0.65)
        let drawProb = (homeForm.draws * 0.75) + (awayForm.draws * 0.75)
        let awayProb = (awayForm.wins * 0.85) + (awayForm.draws * 0.45)

        const total = homeProb + drawProb + awayProb || 100

        let homeProbBps = Math.round((homeProb / total) * 10000)
        let drawProbBps = Math.round((drawProb / total) * 10000)
        let awayProbBps = 10000 - homeProbBps - drawProbBps

        // Limites razoáveis
        homeProbBps = Math.max(2600, Math.min(6800, homeProbBps))
        awayProbBps = Math.max(1800, Math.min(5200, awayProbBps))
        drawProbBps = 10000 - homeProbBps - awayProbBps

        const matchData = {
          fixtureId: Number(match.id),
          competitionCode: 'BSA',
          league: 'Campeonato Brasileiro Série A',
          teamA: match.homeTeam.name,
          teamB: match.awayTeam.name,
          utcDate: match.utcDate,
          time: new Date(match.utcDate).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }),
          status: match.status,
          matchday: match.matchday || null,
          homeProbBps,
          drawProbBps,
          awayProbBps,
          homeRecentForm: `${homeForm.wins}V-${homeForm.draws}E-${homeForm.losses}D`,
          awayRecentForm: `${awayForm.wins}V-${awayForm.draws}E-${awayForm.losses}D`,
          updatedAt: FieldValue.serverTimestamp()
        }

        await db.collection('football_matches')
          .doc(String(match.id))
          .set(matchData, { merge: true })

        totalSaved++
        console.log(`💾 Salvo: ${match.homeTeam.name} x ${match.awayTeam.name}`)

      } catch (err) {
        console.error(`❌ Erro no jogo ${match.id}:`, err.message)
      }
    }

    // Atualiza status
    await db.collection('football_metadata').doc('sync_status').set({
      lastSyncAt: FieldValue.serverTimestamp(),
      totalMatches: totalSaved,
      matchesFound: matches.length,
      competition: 'BSA',
      success: true,
      lastSyncType: 'only_brasileirao'
    }, { merge: true })

    console.log(`🎉 SYNC BRASILEIRÃO FINALIZADO → ${totalSaved} jogos salvos`)

    return new Response(JSON.stringify({ 
      success: true, 
      syncedMatches: totalSaved,
      foundMatches: matches.length 
    }), { status: 200 })

  } catch (error) {
    console.error('🚨 Erro no sync:', error)
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500 })
  }
}