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
  { code: 'FL1', fallbackName: 'Ligue 1', maxMatches: 8 }
]

if (!getApps().length) {
  initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) })
}

const db = getFirestore()

const delay = (ms) => new Promise(r => setTimeout(r, ms))

async function footballDataGetJson(url, token) {
  const res = await fetch(url, { headers: { 'X-Auth-Token': token } })
  if (!res.ok) throw new Error(`API Error ${res.status}`)
  return res.json()
}

function sortByUtcDateAsc(list = []) {
  return [...list].sort((a, b) => new Date(a?.utcDate || 0).getTime() - new Date(b?.utcDate || 0).getTime())
}

export default async function handler() {
  try {
    const token = process.env.FOOTBALL_DATA_TOKEN
    if (!token) throw new Error('Token não configurado')

    const now = new Date()
    const dateFrom = now.toISOString().split('T')[0]
    const dateTo = new Date(now.getTime() + 12*24*60*60*1000).toISOString().split('T')[0]

    console.log(`🔄 Sync iniciado: ${dateFrom} → ${dateTo}`)

    let totalSaved = 0

    for (const comp of COMPETITIONS) {
      await delay(150)

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
          const docData = {
            fixtureId: Number(match.id),
            league: match.competition?.name || comp.fallbackName,
            teamA: match.homeTeam.name,
            teamB: match.awayTeam.name,
            utcDate: match.utcDate,
            time: new Date(match.utcDate).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }),
            status: match.status,
            homeProbBps: 4000,
            drawProbBps: 2000,
            awayProbBps: 4000,
            updatedAt: FieldValue.serverTimestamp()
          }

          await db.collection('football_matches').doc(String(match.id)).set(docData, { merge: true })
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

    console.log(`🎉 FINALIZADO → ${totalSaved} jogos salvos`)

    return new Response(JSON.stringify({ success: true, syncedMatches: totalSaved }), { status: 200 })

  } catch (error) {
    console.error('Erro sync:', error)
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500 })
  }
}