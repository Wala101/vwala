import { auth, db } from './firebase'
import { doc, getDoc } from 'firebase/firestore'
import { onAuthStateChanged, setPersistence, browserLocalPersistence } from 'firebase/auth'
import { JsonRpcProvider, Contract, Wallet } from 'ethers'

const POLYGON_CHAIN_ID = Number(import.meta.env.VITE_POLYGON_CHAIN_ID || 137)
const POLYGON_RPC_PRIMARY_URL = new URL('/api/rpc', window.location.origin).toString()

const CONTRACT_ADDRESS = '0x25F9007ef8E62796C1ed0259B6266d097577e133'

const USER_PREDICTIONS_ABI = [
  'function getMarket(uint256 marketId) view returns (tuple(bool exists,address creator,uint256 closeAt,uint16 feeBps,uint16 probA,uint16 probB,uint256 poolA,uint256 poolB,uint256 totalPool,bool resolved,uint8 winningOption,uint256 resolvedAt))',
  'function bet(uint256 marketId, uint8 option) external payable'
]

let currentGoogleUser = null
let currentMarket = null
let state = { provider: null, signer: null, userAddress: '' }

// ==================== MODAIS (igual ao criar) ====================
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

window.showLoadingModal = (title = 'Processando', message = 'Enviando transação...') => {
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
      <p>Digite seu PIN para apostar</p>
      <input type="password" id="pin-input" class="input pin-input" maxlength="6" autocomplete="off" autofocus>
      <div class="pin-buttons">
        <button class="modal-btn cancel-btn" onclick="this.closest('.modal-overlay').remove(); resolve(null)">Cancelar</button>
        <button class="modal-btn confirm-btn" id="confirm-pin-btn">Confirmar</button>
      </div>
    </div>
  `
  document.body.appendChild(modal)
  modal.style.display = 'flex'

  setTimeout(() => document.getElementById('pin-input').focus(), 150)

  document.getElementById('confirm-pin-btn').onclick = () => {
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
      const unlocked = await Wallet.fromEncryptedJson(data.walletKeystoreCloud, `vwala_google_device_pin_v1:${currentGoogleUser.uid}`)
      addr = unlocked.address
    }

    if (addr) state.userAddress = addr
  } catch (e) { console.error(e) }
}

async function getInternalWalletSigner() {
  if (state.signer) return state.signer

  const vault = JSON.parse(localStorage.getItem('vwala_device_wallet') || 'null')
  if (!vault?.walletKeystoreLocal) {
    showAlert('Carteira não encontrada', 'Crie um PIN na página de Swap primeiro.', 'error')
    return null
  }

  if (state.userAddress.toLowerCase() !== String(vault.walletAddress || '').toLowerCase()) {
    showAlert('Carteira incompatível', '', 'error')
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

// ==================== CARREGAR MERCADO ====================
async function loadMarket() {
  const marketId = document.getElementById('marketId').value.trim()
  const content = document.getElementById('marketContent')

  if (!marketId) {
    showAlert('ID obrigatório', 'Cole o ID ou Tx Hash da aposta', 'error')
    return
  }

  content.style.display = 'none'
  content.innerHTML = '<p class="loading-text">Carregando aposta...</p>'
  content.style.display = 'block'

  try {
    const contract = new Contract(CONTRACT_ADDRESS, USER_PREDICTIONS_ABI, state.provider)
    const data = await contract.getMarket(marketId)

    if (!data.exists) throw new Error('Mercado não encontrado')

    currentMarket = { id: marketId, ...data }

    const closeDate = new Date(Number(data.closeAt) * 1000)

    content.innerHTML = `
      <div class="market-detail-card">
        <h2>Mercado #${marketId}</h2>
        
        <div class="market-status">
          ${data.resolved 
            ? `<span class="status resolved">🔴 Resolvido • Vencedor: ${data.winningOption === 0 ? 'A' : 'B'}</span>` 
            : `<span class="status active">🟢 Ativo • Fecha: ${closeDate.toLocaleDateString('pt-BR')}</span>`
          }
        </div>

        <div class="options-bet">
          <div class="option-card">
            <strong>A:</strong> [Opção A]<br>
            <small>${(Number(data.probA)/100).toFixed(1)}% • Pool: ${data.poolA}</small>
          </div>
          <div class="option-card">
            <strong>B:</strong> [Opção B]<br>
            <small>${(Number(data.probB)/100).toFixed(1)}% • Pool: ${data.poolB}</small>
          </div>
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
    content.innerHTML = `<p class="error-text">Aposta não encontrada ou ID inválido.<br><small>${err.message}</small></p>`
  }
}

// ==================== APOSTAR ====================
async function placeBet(option) {
  const amount = parseFloat(document.getElementById('betAmount').value)
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
    setTimeout(loadMarket, 3000)
  } catch (err) {
    hideLoadingModal()
    showAlert('Erro na transação', err.shortMessage || err.message, 'error')
  }
}

// ==================== BOOT ====================
async function boot() {
  await setPersistence(auth, browserLocalPersistence)

  await new Promise(resolve => {
    onAuthStateChanged(auth, async (user) => {
      currentGoogleUser = user
      if (user) await syncWalletProfileFromFirebase()
      resolve()
    })
  })

  state.provider = new JsonRpcProvider(POLYGON_RPC_PRIMARY_URL, POLYGON_CHAIN_ID)

  // Listeners
  document.getElementById('searchBtn').addEventListener('click', loadMarket)
  document.getElementById('marketId').addEventListener('keypress', e => {
    if (e.key === 'Enter') loadMarket()
  })

  console.log("📄 Página Ver Aposta carregada com sucesso ✅")
}

boot()