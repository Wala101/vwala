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

const CONTRACT_ADDRESS = '0xb6b57B6146e535d2D850B0Ea086D29EdBacB5A0C'
const VWALA_TOKEN = '0x7bD1f6f4F5CEf026b643758605737CB48b4B7D83'
const TOKEN_SYMBOL = 'vWALA'

const USER_PREDICTIONS_ABI = [
  'function createMarket(string title, string optionA, string optionB, uint256 closeAt, uint16 feeBps, uint16 probA, uint16 probB) external returns (uint256)',
  'function resolveMarket(uint256 marketId, uint8 winningOption) external',
  'function getMarket(uint256 marketId) view returns (tuple(bool exists,address creator,uint256 closeAt,uint16 feeBps,uint16 probA,uint16 probB,uint256 poolA,uint256 poolB,uint256 totalPool,bool resolved,uint8 winningOption,uint256 resolvedAt))',
  'event MarketCreated(uint256 indexed marketId, address indexed creator)',
  'event MarketResolved(uint256 indexed marketId, uint8 winningOption)'
]

let currentGoogleUser = null
const state = { provider: null, signer: null, userAddress: '' }

// ==================== MODAIS (SEGURAS) ====================
window.showAlert = (title, message, type = 'success') => {
  const existing = document.getElementById('premium-modal')
  if (existing) existing.remove()

  const modal = document.createElement('div')
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

window.showLoadingModal = (title = 'Processando', message = '') => {
  const existing = document.getElementById('loading-modal')
  if (existing) return
  const modal = document.createElement('div')
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
  const existing = document.getElementById('pin-modal')
  if (existing) existing.remove()

  const modal = document.createElement('div')
  modal.id = 'pin-modal'
  modal.className = 'modal-overlay'
  modal.innerHTML = `
    <div class="modal-content pin-modal">
      <div class="modal-icon">🔑</div>
      <h2>Confirmar PIN</h2>
      <input type="password" id="pin-input" class="input" maxlength="6" placeholder="Digite seu PIN">
      <div class="pin-buttons">
        <button class="modal-btn cancel-btn" id="cancel-pin">Cancelar</button>
        <button class="modal-btn confirm-btn" id="confirm-pin">Confirmar</button>
      </div>
    </div>
  `
  document.body.appendChild(modal)
  modal.style.display = 'flex'

  setTimeout(() => document.getElementById('pin-input').focus(), 100)

  document.getElementById('cancel-pin').onclick = () => { modal.remove(); resolve(null) }
  document.getElementById('confirm-pin').onclick = () => {
    const pin = document.getElementById('pin-input').value.trim()
    modal.remove()
    resolve(pin)
  }
})

// ==================== CARTEIRA ====================
async function syncWalletProfileFromFirebase() {
  if (!currentGoogleUser?.uid) return
  try {
    const snap = await getDoc(doc(db, 'users', currentGoogleUser.uid))
    if (!snap.exists()) return
    const data = snap.data()
    let addr = String(data.walletAddress || '').trim()
    if (!addr && data.walletKeystoreCloud) {
      const unlocked = await Wallet.fromEncryptedJson(data.walletKeystoreCloud, `vwala_google_device_pin_v1:${currentGoogleUser.uid}`)
      addr = unlocked.address
    }
    if (addr) state.userAddress = addr
  } catch (error) {
    console.error(error)
  }
}

async function initFirebaseSession() {
  try {
    await setPersistence(auth, browserLocalPersistence)
    await new Promise(resolve => {
      onAuthStateChanged(auth, async (user) => {
        currentGoogleUser = user
        if (user) await syncWalletProfileFromFirebase()
        resolve()
      })
    })
  } catch (error) {
    console.error(error)
  }
}

async function getInternalWalletSigner() {
  if (state.signer) return state.signer

  const deviceVault = JSON.parse(localStorage.getItem('vwala_device_wallet') || 'null')
  if (!deviceVault?.walletKeystoreLocal) {
    showAlert('Carteira não encontrada', 'Crie um PIN na página de Swap primeiro.', 'error')
    return null
  }

  if (state.userAddress.toLowerCase() !== String(deviceVault.walletAddress || '').toLowerCase()) {
    showAlert('Carteira incompatível', '', 'error')
    return null
  }

  while (true) {
    const pin = await window.showPinModal()
    if (!pin) return null
    try {
      const wallet = await Wallet.fromEncryptedJson(deviceVault.walletKeystoreLocal, pin)
      state.signer = wallet.connect(state.provider)
      return state.signer
    } catch {
      showAlert('PIN inválido', 'Tente novamente.', 'error')
    }
  }
}

// ==================== CRIAR MERCADO (CORRIGIDO) ====================
async function createMarket() {
  const deviceVault = JSON.parse(localStorage.getItem('vwala_device_wallet') || 'null')
  if (!deviceVault?.walletKeystoreLocal) {
    showAlert('Carteira não configurada', 'Crie um PIN na página de Swap primeiro.', 'error')
    return
  }

  const title = document.getElementById('title').value.trim()
  const optionA = document.getElementById('optionA').value.trim()
  const optionB = document.getElementById('optionB').value.trim()
  const closeAtStr = document.getElementById('closeAt').value
  const probA = parseInt(document.getElementById('probA').value)
  const probB = parseInt(document.getElementById('probB').value)

  if (!title || !optionA || !optionB || !closeAtStr) {
    showAlert('Campos incompletos', 'Preencha todos os campos.', 'error')
    return
  }
  if (probA + probB !== 100) {
    showAlert('Probabilidades inválidas', 'A + B deve ser 100%.', 'error')
    return
  }

  const closeAt = Math.floor(new Date(closeAtStr).getTime() / 1000)
  if (closeAt <= Math.floor(Date.now() / 1000)) {
    showAlert('Data inválida', 'Escolha uma data no futuro.', 'error')
    return
  }

  const btn = document.getElementById('createBtn')
  btn.disabled = true
  btn.textContent = "Criando..."

  try {
    const signer = await getInternalWalletSigner()
    if (!signer) return

    const contract = new Contract(CONTRACT_ADDRESS, USER_PREDICTIONS_ABI, signer)

    showLoadingModal('Criando Mercado', 'Enviando transação...')

    const tx = await contract.createMarket(title, optionA, optionB, closeAt, 300, probA * 100, probB * 100)
    console.log("📤 Create tx enviada:", tx.hash)

    // Timeout para não travar
    const receipt = await Promise.race([
      tx.wait(1),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 60000))
    ])

    hideLoadingModal()

    const marketCreatedLog = receipt.logs.find(log => {
      try {
        return contract.interface.parseLog(log).name === 'MarketCreated'
      } catch { return false }
    })

    const marketId = marketCreatedLog ? contract.interface.parseLog(marketCreatedLog).args.marketId.toString() : 'N/A'

    showAlert('✅ Mercado Criado!', `Market ID: <strong>${marketId}</strong>`, 'success')

    // Limpar formulário
    document.getElementById('title').value = ''
    document.getElementById('optionA').value = ''
    document.getElementById('optionB').value = ''
    document.getElementById('probA').value = '50'
    document.getElementById('probB').value = '50'

  } catch (error) {
    hideLoadingModal()
    console.error(error)
    showAlert('Erro na transação', error.shortMessage || error.message, 'error')
  } finally {
    btn.disabled = false
    btn.textContent = "🎲 Criar Mercado"
  }
}

// ==================== RENDER + BOOT ====================
function renderPage() {
  document.querySelector('#app').innerHTML = `
    <div class="page-shell">
      <div class="app-frame">
        <main class="app-content">
          <div class="create-page">
            <div class="create-header">
              <h1>🎲 Criar Mercado</h1>
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
                <div><label>Probabilidade A (%)</label><input type="number" id="probA" value="50" min="1" max="99" class="input" /></div>
                <div><label>Probabilidade B (%)</label><input type="number" id="probB" value="50" min="1" max="99" class="input" /></div>
              </div>
              <button id="createBtn" class="launch-btn">🎲 Criar Mercado</button>
            </div>

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
}

async function boot() {
  await initFirebaseSession()
  state.provider = new JsonRpcProvider(POLYGON_RPC_PRIMARY_URL, POLYGON_CHAIN_ID)
  renderPage()
  console.log("📄 Página Criar Aposta v2.3 - Limpa e sem conflito ✅")
}

boot()