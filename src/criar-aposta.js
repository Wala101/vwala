import { auth, db } from './firebase'
import {
  browserLocalPersistence,
  onAuthStateChanged,
  setPersistence
} from 'firebase/auth'
import { 
  doc, 
  getDoc, 
  setDoc, 
  serverTimestamp,
  collection,
  query,
  getDocs,
  orderBy 
} from 'firebase/firestore'
import { JsonRpcProvider, Wallet, Contract } from 'ethers'

const POLYGON_CHAIN_ID = Number(import.meta.env.VITE_POLYGON_CHAIN_ID || 137)
const POLYGON_RPC_PRIMARY_URL = new URL('/api/rpc', window.location.origin).toString()

const CONTRACT_ADDRESS = '0x25F9007ef8E62796C1ed0259B6266d097577e133'
const VWALA_TOKEN = '0x7bD1f6f4F5CEf026b643758605737CB48b4B7D83'
const TOKEN_SYMBOL = 'vWALA'

const USER_PREDICTIONS_ABI = [
  'function createMarket(string title, string optionA, string optionB, uint256 closeAt, uint16 feeBps, uint16 probA, uint16 probB) external returns (uint256)'
]

let currentGoogleUser = null

const state = {
  provider: null,
  signer: null,
  userAddress: ''
}

// ==================== MODAIS PREMIUM ====================
window.showAlert = (title, message, type = 'success') => {
  const existing = document.getElementById('premium-modal')
  if (existing) existing.remove()

  const modal = document.createElement('div')
  modal.id = 'premium-modal'
  modal.className = `modal-overlay ${type}`

  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-icon">
        ${type === 'success' ? '🎉' : '⚠️'}
      </div>
      <h2 class="modal-title">${title}</h2>
      <p class="modal-message">${message}</p>
      <button class="modal-btn" onclick="this.closest('.modal-overlay').remove()">FECHAR</button>
    </div>
  `
  document.body.appendChild(modal)
  modal.style.display = 'flex'
}

window.showLoadingModal = (title = 'Processando', message = 'Enviando transação...') => {
  const existing = document.getElementById('loading-modal')
  if (existing) return

  const modal = document.createElement('div')
  modal.id = 'loading-modal'
  modal.className = 'modal-overlay loading'

  modal.innerHTML = `
    <div class="modal-content">
      <div class="premium-spinner"></div>
      <h2 class="modal-title">${title}</h2>
      <p class="modal-message">${message}</p>
    </div>
  `
  document.body.appendChild(modal)
  modal.style.display = 'flex'
}

window.hideLoadingModal = () => {
  const modal = document.getElementById('loading-modal')
  if (modal) modal.remove()
}

// ==================== CARREGAR MINHAS APOSTAS ====================
async function loadMyMarkets() {
  if (!currentGoogleUser?.uid) return

  const container = document.getElementById('myMarketsList')
  if (!container) return

  container.innerHTML = '<p class="loading-text">Carregando suas apostas...</p>'

  try {
    const marketsRef = collection(db, 'users', currentGoogleUser.uid, 'myMarkets')
    const q = query(marketsRef, orderBy('createdAt', 'desc'))
    const snapshot = await getDocs(q)

    if (snapshot.empty) {
      container.innerHTML = `<p class="empty-state">Você ainda não criou nenhuma aposta.</p>`
      return
    }

    let html = ''
    snapshot.forEach((docSnap) => {
      const m = docSnap.data()
      const date = m.closeAtDate 
        ? new Date(m.closeAtDate.seconds * 1000).toLocaleDateString('pt-BR') 
        : '—'

      html += `
        <div class="market-item">
          <div class="market-title">${m.title}</div>
          <div class="market-options">
            <span>A: ${m.optionA} (${m.probA}%)</span>
            <span>B: ${m.optionB} (${m.probB}%)</span>
          </div>
          <div class="market-info">
            <span>Fecha: ${date}</span>
            <span class="status ${m.status || 'active'}">
              ${m.status === 'active' ? 'Ativa' : 'Finalizada'}
            </span>
          </div>
        </div>
      `
    })

    container.innerHTML = html
  } catch (error) {
    console.error(error)
    container.innerHTML = `<p class="error-text">Erro ao carregar apostas.</p>`
  }
}

// ==================== CRIAR MERCADO ====================
async function createMarket() {
  const title = document.getElementById('title').value.trim()
  const optionA = document.getElementById('optionA').value.trim()
  const optionB = document.getElementById('optionB').value.trim()
  const closeAtStr = document.getElementById('closeAt').value
  const probA = parseInt(document.getElementById('probA').value)
  const probB = parseInt(document.getElementById('probB').value)

  if (!title || !optionA || !optionB || !closeAtStr) {
    showAlert('Campos incompletos', 'Preencha todos os campos obrigatórios.', 'error')
    return
  }
  if (probA + probB !== 100) {
    showAlert('Probabilidades inválidas', 'As probabilidades devem somar exatamente 100%.', 'error')
    return
  }

  const closeAt = Math.floor(new Date(closeAtStr).getTime() / 1000)
  const btn = document.getElementById('createBtn')
  btn.disabled = true
  btn.textContent = "Criando Mercado..."

  try {
    const internalSigner = await getInternalWalletSigner()
    if (!internalSigner) return

    const contract = new Contract(CONTRACT_ADDRESS, USER_PREDICTIONS_ABI, internalSigner)

    showLoadingModal('Criando Mercado', 'Confirmando transação na Polygon...')

    const tx = await contract.createMarket(
      title, optionA, optionB, closeAt, 300, probA * 100, probB * 100
    )

    const receipt = await tx.wait()

    hideLoadingModal()

    // ==================== SALVAR NO FIREBASE ====================
    if (currentGoogleUser?.uid) {
      const marketData = {
        marketId: receipt.transactionHash,
        title: title,
        optionA: optionA,
        optionB: optionB,
        closeAt: closeAt,
        closeAtDate: new Date(closeAt * 1000),
        probA: probA,
        probB: probB,
        feeBps: 300,
        creator: state.userAddress,
        txHash: receipt.transactionHash,
        createdAt: serverTimestamp(),
        status: 'active',
        resolved: false,
        winningOption: null
      }

      const marketRef = doc(db, 'users', currentGoogleUser.uid, 'myMarkets', receipt.transactionHash)
      await setDoc(marketRef, marketData)
    }

    showAlert(
      'Mercado Criado com Sucesso!', 
      `Transação confirmada!<br>Hash: <small>${receipt.transactionHash}</small>`,
      'success'
    )

    // Limpar formulário
    document.getElementById('title').value = ''
    document.getElementById('optionA').value = ''
    document.getElementById('optionB').value = ''
    document.getElementById('probA').value = '50'
    document.getElementById('probB').value = '50'

    // Atualiza a lista de "Minhas Apostas"
    await loadMyMarkets()

  } catch (error) {
    hideLoadingModal()
    console.error(error)
    showAlert('Falha na Transação', error.shortMessage || error.message, 'error')
  } finally {
    btn.disabled = false
    btn.textContent = "🚀 Criar Mercado"
  }
}

// ==================== RENDER PAGE ====================
function renderPage() {
  document.querySelector('#app').innerHTML = `
    <div class="page-shell">
      <div class="app-frame">
        <header class="topbar" style="display: none !important;">
          <div class="brand-wrap">
            <div class="brand-badge premium">W</div>
            <div class="brand-text">
              <strong>Wala</strong>
              <span>Predictions</span>
            </div>
          </div>
          <button id="connectBtn" class="connect-btn">Carregando...</button>
        </header>

        <main class="app-content">
          <div class="create-page">

            <!-- Criar Mercado -->
            <div class="create-header">
              <h1>🚀 Criar Mercado</h1>
              <p>Crie sua própria aposta • Apenas você pode resolver</p>
            </div>

            <div class="form-card">
              <input type="text" id="title" class="input" placeholder="Título da Aposta" maxlength="120" />
              <div class="options-grid">
                <input type="text" id="optionA" class="input" placeholder="Opção A (Ex: Sim)" />
                <input type="text" id="optionB" class="input" placeholder="Opção B (Ex: Não)" />
              </div>
              <input type="datetime-local" id="closeAt" class="input" />
              <div class="prob-row">
                <div>
                  <label>Probabilidade A (%)</label>
                  <input type="number" id="probA" value="50" min="1" max="99" class="input" />
                </div>
                <div>
                  <label>Probabilidade B (%)</label>
                  <input type="number" id="probB" value="50" min="1" max="99" class="input" />
                </div>
              </div>
              <button id="createBtn" class="launch-btn">🚀 Criar Mercado</button>
            </div>

            <!-- MINHAS APOSTAS -->
            <div class="my-markets-section">
              <h2>📋 Minhas Apostas</h2>
              <div id="myMarketsList" class="markets-list"></div>
            </div>

          </div>
        </main>
      </div>
    </div>
  `

  document.getElementById('createBtn').addEventListener('click', createMarket)
  document.getElementById('connectBtn').addEventListener('click', loadUserTokenBalance)
}

// ==================== BOOT ====================
async function boot() {
  await initFirebaseSession()

  state.provider = new JsonRpcProvider(POLYGON_RPC_PRIMARY_URL, POLYGON_CHAIN_ID)

  renderPage()

  const balance = await loadUserTokenBalance()
  document.getElementById('connectBtn').textContent = `${balance} ${TOKEN_SYMBOL}`

  // Carrega as apostas do usuário
  await loadMyMarkets()
}

boot()

console.log("📄 Página Criar Aposta v2 - Premium + Minhas Apostas")