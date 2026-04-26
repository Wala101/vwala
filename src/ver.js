import { db } from './firebase.js'
import {
  collection,
  query,
  orderBy,
  limit,
  getDocs
} from 'firebase/firestore'

export async function carregarJogos(limitCount = 100) {
  const q = query(
    collection(db, 'football_matches'),
    orderBy('utcDate', 'asc'),
    limit(limitCount)
  )

  const snapshot = await getDocs(q)

  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }))
}

export async function carregarJogosPorLiga(leagueCode, limitCount = 20) {
  const jogos = await carregarJogos(200)

  return jogos
    .filter(jogo => jogo.competitionCode === leagueCode)
    .slice(0, limitCount)
}

export function formatarProbabilidade(bps) {
  return ((Number(bps || 0) / 100).toFixed(1)) + '%'
}
