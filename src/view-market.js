import { auth, db } from './firebase'
import { doc, getDoc } from 'firebase/firestore'
import { onAuthStateChanged, setPersistence, browserLocalPersistence } from 'firebase/auth'
import { JsonRpcProvider, Contract, Wallet } from 'ethers'

const POLYGON_CHAIN_ID = Number(import.meta.env.VITE_POLYGON_CHAIN_ID || 137)
const POLYGON_RPC_PRIMARY_URL = new URL('/api/rpc', window.location.origin).toString()

const CONTRACT_ADDRESS = '0x25F9007ef8E62796C1ed0259B6266d097577e133'

const USER_PREDICTIONS_ABI = [
  'function getMarket(uint256 marketId) view returns (tuple(bool exists,address creator,uint256 closeAt,uint16 feeBps,uint16 probA,uint16 probB,uint256 poolA,uint256 poolB,uint256 totalPool,bool resolved,uint8 winningOption,uint256 resolvedAt,string title,string optionA,string optionB))',
  'function bet(uint256 marketId, uint8 option) external payable'
]

let currentGoogleUser = null
let currentMarket = null
let state = { provider: null, signer: null, userAddress: '' }

// ==================== MODAIS ====================
window.showAlert = (title, message, type = 'success') => {
  let modal = document.getElementById('premium-modal')
  if (modal) modal.remove()

  modal = document.createElement('div')
  modal.id = 'premium-modal'
  modal.className = `modal-overlay ${type}`
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-icon">${type === 'success' ? '🎉' : '⚠️'}</div>
      <h2 class="modal-title">${title}</h2>
      <p class="modal-message">${message}</p>
      <button class="modal-btn" onclick="this.closest('.modal-overlay').remove()">FECHAR</button>
    </div>
  `
  document.body.appendChild(modal)
  modal.style.display = 'flex'
}

window.showLoadingModal = (title = 'Processando', message = 'Enviando...') => {
  let modal = document.getElementById('loading-modal')
  if (modal) return
  modal = document.createElement('div')
  modal.id = 'loading-modal'
  modal.className = 'modal-overlay loading'
  modal.innerHTML = `<div class="modal-content"><div class="premium-spinner"></div><h2>${title}</h2><p>${message}</p></div>`
  document.body.appendChild(modal)
  modal.style.display = 'flex'
}

window.hideLoadingModal = () => {
  const modal = document.getElementById('loading-modal')
  if (modal) modal.remove()
}

window.showPinModal = () => new Promise(resolve => {
  let modal = document.getElementById('pin-modal')
  if (modal) modal.remove()

  modal = document.createElement('div')
  modal.id = 'pin-modal'
  modal.className = 'modal-overlay'
  modal.innerHTML = `
    <div class="modal-content pin-modal">
      <div class="modal-icon">🔑</div>
      <h2>Confirmar PIN</h2>
      <p>Digite seu PIN para apostar</p>
      <input type="password" id="pin-input" class="input pin-input" maxlength="6" autofocus>
      <div class="pin-buttons">
        <button class="modal-btn cancel-btn" onclick="this.closest('.modal-overlay').remove(); resolve(null)">Cancelar</button>
        <button class="modal-btn confirm-btn" id="confirm-pin">Confirmar</button>
      </div>
    </div>
  `
  document.body.appendChild(modal)
  modal.style.display = 'flex'

  setTimeout(() => document.getElementById('pin-input').focus(), 150)

  document.getElementById('confirm-pin').onclick = () => {
    const pin = document.getElementById('pin-input').value.trim()
    modal.remove()
    resolve(pin)
  }
})

// ==================== WALLET ====================
async function syncWalletProfileFromFirebase() {
  if (!currentGoogleUser?.uid) return
  try {
    const snap = await getDoc(doc(db, 'users', currentGoogleUser.uid))
    if (!snap.exists()) return

    const data = snap.data()
    let addr = String(data.walletAddress || '').trim()

    if (!addr && data.walletKeystoreCloud) {
      const w = await Wallet.fromEncryptedJson(data.walletKeystoreCloud, `vwala_google_device_pin_v1:${currentGoogleUser.uid}`)
      addr = w.address
    }

    if (addr) {
      state.userAddress = addr
      localStorage.setItem('vwala_wallet_profile', JSON.stringify({ uid: currentGoogleUser.uid, walletAddress: addr }))
    }
  } catch (e) { console.error(e) }
}

async function getInternalWalletSigner() {
  if (state.signer) return state.signer

  const vault = JSON.parse(localStorage.getItem('vwala_device_wallet') || 'null')
  if (!vault?.walletKeystoreLocal) {
    showAlert('Carteira não configurada', 'Crie um PIN na página Swap', 'error')
    return null
  }

  if (state.userAddress.toLowerCase() !== String(vault.walletAddress || '').toLowerCase()) {
    showAlert('Carteira incompatível', 'Faça login novamente', 'error')
    return null
  }

  while (true) {
    const pin = await window.showPinModal()
    if (!pin) return null
    try {
      const wallet = await Wallet.fromEncryptedJson(vault.walletKeystoreLocal, pin)
      state.signer = wallet.connect(state.provider)
      return state.signer
    } catch {
      showAlert('PIN Inválido', 'Tente novamente', 'error')
    }
  }
}

// ==================== LOAD MARKET (com proteção total) ====================
async function loadMarket() {
  const marketIdEl = document.getElementById('marketId')
  const contentEl = document.getElementById('marketContent')

  if (!contentEl) {
    console.error("marketContent não encontrado no DOM")
    return
  }

  const marketId = marketIdEl ? marketIdEl.value.trim() : ''
  if (!marketId) {
    showAlert('ID obrigatório', 'Digite o ID da aposta', 'error')
    return
  }

  contentEl.style.display = 'none'
  contentEl.innerHTML = '<p class="loading-text">Carregando mercado...</p>'
  contentEl.style.display = 'block'

  try {
    const contract = new Contract(CONTRACT_ADDRESS, USER_PREDICTIONS_ABI, state.provider)
    const data = await contract.getMarket(marketId)

    if (!data.exists) throw new Error('Mercado inexistente')

    currentMarket = { id: marketId, ...data }

    const closeDate = new Date(Number(data.closeAt) * 1000)

    contentEl.innerHTML = `
      <div class="market-detail-card">
        <h2>${data.title || 'Mercado #' + marketId}</h2>
        <div class="market-status">
          ${data.resolved 
            ? `<span class="status resolved">🔴 Resolvido • Vencedor: ${data.winningOption === 0 ? 'A' : 'B'}</span>` 
            : `<span class="status active">🟢 Ativo • Fecha: ${closeDate.toLocaleDateString('pt-BR')}</span>`
          }
        </div>

        <div class="options-bet">
          <div class="option-card" data-option="0"><strong>A:</strong> ${data.optionA}<br><small>${(Number(data.probA)/100).toFixed(1)}%</small></div>
          <div class="option-card" data-option="1"><strong>B:</strong> ${data.optionB}<br><small>${(Number(data.probB)/100).toFixed(1)}%</small></div>
        </div>

        ${!data.resolved ? `
        <div class="bet-section">
          <input type="number" id="betAmount" class="input" placeholder="Quantidade vWALA" min="0.1" step="0.1"/>
          <div class="bet-buttons">
            <button id="betA" class="bet-btn a">APOSTAR EM A</button>
            <button id="betB" class="bet-btn b">APOSTAR EM B</button>
          </div>
        </div>` : ''}
      </div>
    `

    if (!data.resolved) {
      document.getElementById('betA').onclick = () => placeBet(0)
      document.getElementById('betB').onclick = () => placeBet(1)
    }

  } catch (err) {
    console.error(err)
    contentEl.innerHTML = `<p class="error-text">Não foi possível encontrar esta aposta.<br><small>${err.message}</small></p>`
  }
}

// ==================== PLACE BET ====================
async function placeBet(option) {
  const amountEl = document.getElementById('betAmount')
  const amount = parseFloat(amountEl?.value || 0)

  if (!amount || amount <= 0) {
    showAlert('Valor inválido', 'Digite uma quantidade válida', 'error')
    return
  }

  const signer = await getInternalWalletSigner()
  if (!signer) return

  try {
    showLoadingModal('Confirmando aposta...')
    const contract = new Contract(CONTRACT_ADDRESS, USER_PREDICTIONS_ABI, signer)
    const tx = await contract.bet(currentMarket.id, option)
    await tx.wait()

    hideLoadingModal()
    showAlert('✅ Aposta realizada!', `Você apostou ${amount} vWALA`, 'success')
    setTimeout(loadMarket, 2500)
  } catch (err) {
    hideLoadingModal()
    showAlert('Erro na transação', err.shortMessage || err.message, 'error')
  }
}

// ==================== RENDER ====================
function renderPage() {
  document.querySelector('#app').innerHTML = `
    <div class="page-shell">
      <div class="app-frame">
        <main class="app-content">
          <div class="market-page">
            <h1>🔍 Ver Mercado & Apostar</h1>
            <div class="input-group">
              <input type="text" id="marketId" class="input" placeholder="Digite o ID da aposta" />
              <button id="searchBtn" class="search-btn">Buscar</button>
            </div>
            <div id="marketContent"></div>
          </div>
        </main>
      </div>
    </div>
  `

  // Listeners só depois do HTML existir
  const searchBtn = document.getElementById('searchBtn')
  const marketIdInput = document.getElementById('marketId')

  if (searchBtn) searchBtn.addEventListener('click', loadMarket)
  if (marketIdInput) marketIdInput.addEventListener('keypress', e => {
    if (e.key === 'Enter') loadMarket()
  })
}

// ==================== BOOT ====================
async function boot() {
  await setPersistence(auth, browserLocalPersistence)

  await new Promise(r => {
    onAuthStateChanged(auth, async user => {
      currentGoogleUser = user
      if (user) await syncWalletProfileFromFirebase()
      r()
    })
  })

  state.provider = new JsonRpcProvider(POLYGON_RPC_PRIMARY_URL, POLYGON_CHAIN_ID)
  renderPage()
}

boot()

console.log("📄 Página Ver Mercado + Apostas v2.2 (Super Segura) ✅")