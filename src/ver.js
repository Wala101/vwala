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

export async function renderizarJogos(containerId = 'jogos-lista') {
  const container = document.getElementById(containerId)
  if (!container) return

  try {
    container.innerHTML = '<p>Carregando jogos...</p>'

    const jogos = await carregarJogos()

    if (!jogos.length) {
      container.innerHTML = '<p>Nenhum jogo disponível.</p>'
      return
    }

    container.innerHTML = jogos.map(jogo => `
      <div class="jogo-card">
        <h3>${jogo.teamA} × ${jogo.teamB}</h3>
        <p>${jogo.league}</p>
        <p>${jogo.time}</p>
      </div>
    `).join('')
  } catch (error) {
    console.error(error)
    container.innerHTML = `<p>Erro: ${error.message}</p>`
  }
}

window.carregarJogos = carregarJogos
window.renderizarJogos = renderizarJogos