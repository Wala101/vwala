import { db } from './firebase'
import { doc, getDoc } from 'firebase/firestore'

const marketContent = document.getElementById('marketContent')
const searchBtn = document.getElementById('searchBtn')
const marketIdInput = document.getElementById('marketId')

searchBtn.addEventListener('click', loadMarket)
marketIdInput.addEventListener('keypress', e => {
  if (e.key === 'Enter') loadMarket()
})

async function loadMarket() {
  const marketId = marketIdInput.value.trim()
  if (!marketId) {
    alert('Digite o ID da aposta!')
    return
  }

  marketContent.style.display = 'none'
  marketContent.innerHTML = '<p class="loading-text">Buscando aposta...</p>'

  try {
    // Tenta buscar em todos os usuários (pode ser otimizado depois)
    // Por enquanto vamos assumir que o ID é único (usamos o txHash)
    // Idealmente você deve ter uma coleção global /markets no futuro

    // Exemplo: busca direta pelo txHash (se você salvar em uma coleção pública)
    // const marketRef = doc(db, 'markets', marketId)
    // const snap = await getDoc(marketRef)

    // Por enquanto vamos deixar assim (busca no usuário atual se ele for o criador)
    // Mas como é página pública, vamos precisar ajustar as regras depois.

    // Versão temporária - você pode melhorar depois
    console.log("Buscando aposta:", marketId)

    // Simulação por enquanto (substitua quando tiver coleção pública)
    marketContent.innerHTML = `
      <div class="market-detail-card">
        <h2>${marketId}</h2>
        <p><strong>Status:</strong> Ativa</p>
        <p><strong>Fecha em:</strong> [Data]</p>
        <div class="options">
          <div class="option">A - [Opção A] <span>XX%</span></div>
          <div class="option">B - [Opção B] <span>XX%</span></div>
        </div>
      </div>
    `
    marketContent.style.display = 'block'

  } catch (error) {
    console.error(error)
    marketContent.innerHTML = `<p class="error-text">Aposta não encontrada ou ID inválido.</p>`
    marketContent.style.display = 'block'
  }
}