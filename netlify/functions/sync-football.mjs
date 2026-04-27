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

export default async () => {
  try {
    const token = process.env.FOOTBALL_DATA_TOKEN
    if (!token) throw new Error('Token não configurado')

    const now = new Date()
    const dateFrom = formatDateYMD(now)
    const limitDate = new Date(now)
    limitDate.setDate(limitDate.getDate() + 20) // +20 dias para pegar mais jogos
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
          homeProbBps: 4000,
          drawProbBps: 2000,
          awayProbBps: 4000,
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

    return new Response(JSON.stringify({ success: true, syncedMatches: totalSaved }), { status: 200 })

  } catch (error) {
    console.error('Erro sync:', error)
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500 })
  }
}