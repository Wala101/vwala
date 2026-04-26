import { db } from './firebase.js'
import {
  collection,
  query,
  orderBy,
  limit,
  getDocs
} from 'firebase/firestore'

async function sincronizarSeNecessario() {
  const snapshot = await getDocs(
    query(collection(db, 'football_matches'), limit(1))
  )

  if (!snapshot.empty) return

  const response = await fetch('/api/sync-football')

  if (!response.ok) {
    throw new Error('Falha ao sincronizar jogos.')
  }
}

export async function carregarJogos(limitCount = 100) {
  await sincronizarSeNecessario()

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

window.carregarJogos = carregarJogos