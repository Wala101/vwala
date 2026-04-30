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

const POLYGON_CHAIN_ID = 137
// ✅ RPCs Públicos e Estáveis (sem API key)
const RPC_URLS = [
  "https://polygon-rpc.com",
  "https://1rpc.io/matic",
  "https://poly.api.pocket.network",
  "https://polygon-bor.publicnode.com"
]

const CONTRACT_ADDRESS = '0xb6b57B6146e535d2D850B0Ea086D29EdBacB5A0C'

const USER_PREDICTIONS_ABI = [
  'function createMarket(string title, string optionA, string optionB, uint256 closeAt, uint16 feeBps, uint16 probA, uint16 probB) external returns (uint256)',
  'function resolveMarket(uint256 marketId, uint8 winningOption) external',
  'function getMarket(uint256 marketId) view returns (tuple(bool exists,address creator,uint256 closeAt,uint16 feeBps,uint16 probA,uint16 probB,uint256 poolA,uint256 poolB,uint256 totalPool,bool resolved,uint8 winningOption,uint256 resolvedAt))',
  'event MarketCreated(uint256 indexed marketId, address indexed creator)',
  'event MarketResolved(uint256 indexed marketId, uint8 winningOption)'
]

let currentGoogleUser = null
const state = { provider: null, signer: null, userAddress: '' }

// ==================== MODAIS (mesmo de antes) ====================
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
      <div class="modal-message">${message}</div>
      <button class="modal-btn" onclick="this.closest('.modal-overlay').remove()">FECHAR</button>
    </div>
  `
  document.body.appendChild(modal)
  modal.style.display = 'flex'
}

window.showLoadingModal = (title = 'Processando', message = '') => {
  const existing = document.getElementById('loading-modal')
  if (existing) {
    existing.querySelector('h2').textContent = title
    existing.querySelector('p').innerHTML = message
    return
  }
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

// ==================== CARTEIRA (sem mudanças) ====================
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
    console.error("Erro syncWallet:", error)
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
    console.error("Erro Firebase Session:", error)
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

// ==================== ESPERA INTELIGENTE ====================
async function waitForTransaction(tx, timeoutMs = 180000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const receipt = await tx.provider.getTransactionReceipt(tx.hash)
      if (receipt) {
        if (receipt.status === 1) return receipt
        else throw new Error("Transação revertida")
      }
    } catch (e) {}
    await new Promise(r => setTimeout(r, 3500))
  }
  throw new Error("timeout")
}

// ==================== CRIAR MERCADO ====================
async function createMarket() {
  const btn = document.getElementById('createBtn')
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

  btn.disabled = true
  btn.textContent = "Assinando..."

  let txHash = null

  try {
    const signer = await getInternalWalletSigner()
    if (!signer) {
      btn.disabled = false
      btn.textContent = "🎲 Criar Mercado"
      return
    }

    const contract = new Contract(CONTRACT_ADDRESS, USER_PREDICTIONS_ABI, signer)

    showLoadingModal('Assinando...', 'Confirme na sua carteira')

    const tx = await contract.createMarket(title, optionA, optionB, closeAt, 300, probA * 100, probB * 100)
    txHash = tx.hash

    showLoadingModal('Aguardando Confirmação', 
      `Transação enviada!<br>
       <small><a href="https://polygonscan.com/tx/${txHash}" target="_blank">${txHash.slice(0,16)}...</a></small>`)

    const receipt = await waitForTransaction(tx)

    hideLoadingModal()

    let marketId = 'N/A'
    for (const log of receipt.logs) {
      try {
        const parsed = contract.interface.parseLog(log)
        if (parsed.name === 'MarketCreated') {
          marketId = parsed.args.marketId.toString()
          break
        }
      } catch (e) {}
    }

    showAlert('✅ Mercado Criado!', 
      `ID: <strong>${marketId}</strong><br>
       <a href="https://polygonscan.com/tx/${txHash}" target="_blank">Ver no Polygonscan →</a>`, 
      'success')

    // Limpar
    document.getElementById('title').value = ''
    document.getElementById('optionA').value = ''
    document.getElementById('optionB').value = ''
    document.getElementById('closeAt').value = ''

  } catch (error) {
    hideLoadingModal()
    console.error(error)

    let msg = error.message || 'Erro desconhecido'
    if (msg.includes("timeout")) msg = "Transação enviada, mas a rede está lenta. Verifique no Polygonscan."
    if (msg.includes("user rejected")) msg = "Você cancelou a transação."

    showAlert('Erro ao criar mercado', msg + (txHash ? `<br><small>Hash: ${txHash}</small>` : ''), 'error')
  } finally {
    btn.disabled = false
    btn.textContent = "🎲 Criar Mercado"
  }
}

// ==================== RENDER + BOOT ====================
function renderPage() {
  document.querySelector('#app').innerHTML = `...` // (mantenha igual ao seu)
  document.getElementById('createBtn').addEventListener('click', createMarket)
}

async function boot() {
  await initFirebaseSession()

  // Tenta os RPCs na ordem até um funcionar
  for (const url of RPC_URLS) {
    try {
      state.provider = new JsonRpcProvider(url)
      // Testa conexão
      await state.provider.getNetwork()
      console.log(`✅ RPC conectado: ${url}`)
      break
    } catch (e) {
      console.warn(`RPC falhou: ${url}`)
    }
  }

  if (!state.provider) {
    showAlert('Erro de Conexão', 'Nenhum RPC disponível no momento. Tente recarregar.', 'error')
    return
  }

  renderPage()
  console.log("📄 Página Criar Aposta v2.6 - Múltiplos RPCs ✅")
}

boot()