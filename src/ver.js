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

window.carregarJogos = carregarJogos