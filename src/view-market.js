import { auth, db } from './firebase'
import { 
  doc, 
  getDoc 
} from 'firebase/firestore'
import { 
  onAuthStateChanged, 
  setPersistence, 
  browserLocalPersistence 
} from 'firebase/auth'
import { JsonRpcProvider, Contract, Wallet } from 'ethers'

const POLYGON_CHAIN_ID = Number(import.meta.env.VITE_POLYGON_CHAIN_ID || 137)
const POLYGON_RPC_PRIMARY_URL = new URL('/api/rpc', window.location.origin).toString()

const CONTRACT_ADDRESS = '0x25F9007ef8E62796C1ed0259B6266d097577e133'

const USER_PREDICTIONS_ABI = [
  'function getMarket(uint256 marketId) view returns (tuple(bool exists,address creator,uint256 closeAt,uint16 feeBps,uint16 probA,uint16 probB,uint256 poolA,uint256 poolB,uint256 totalPool,bool resolved,uint8 winningOption,uint256 resolvedAt,string title,string optionA,string optionB))',
  'function bet(uint256 marketId, uint8 option) external payable'   // ← ajuste se necessário
]

let currentGoogleUser = null
let currentMarket = null

const state = {
  provider: null,
  signer: null,
  userAddress: ''
}

// ==================== MODAIS (mesmas do criar mercado) ====================
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
      <p class="modal-message break-text">${message}</p>
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

window.showPinModal = (title = 'Confirmar PIN', message = 'Digite seu PIN para continuar') => {
  return new Promise((resolve) => {
    const existing = document.getElementById('pin-modal')
    if (existing) existing.remove()

    const modal = document.createElement('div')
    modal.id = 'pin-modal'
    modal.className = 'modal-overlay'

    modal.innerHTML = `
      <div class="modal-content pin-modal">
        <div class="modal-icon">🔑</div>
        <h2 class="modal-title">${title}</h2>
        <p class="modal-message">${message}</p>
        <input type="password" id="pin-input" class="input pin-input" placeholder="••••••" maxlength="6" autofocus>
        <div class="pin-buttons">
          <button class="modal-btn cancel-btn" onclick="this.closest('.modal-overlay').remove(); resolve(null)">Cancelar</button>
          <button class="modal-btn confirm-btn" id="confirm-pin-btn">Confirmar</button>
        </div>
      </div>
    `
    document.body.appendChild(modal)
    modal.style.display = 'flex'

    const pinInput = document.getElementById('pin-input')
    const confirmBtn = document.getElementById('confirm-pin-btn')

    setTimeout(() => pinInput.focus(), 100)

    confirmBtn.addEventListener('click', () => {
      const pin = pinInput.value.trim()
      modal.remove()
      resolve(pin)
    })
  })
}

// ==================== WALLET FIREBASE ====================
async function syncWalletProfileFromFirebase() {
  if (!currentGoogleUser?.uid) return

  try {
    const userRef = doc(db, 'users', currentGoogleUser.uid)
    const userSnap = await getDoc(userRef)
    if (!userSnap.exists()) return

    const userData = userSnap.data()
    let walletAddress = String(userData.walletAddress || '').trim()

    if (!walletAddress && userData.walletKeystoreCloud) {
      const unlocked = await Wallet.fromEncryptedJson(
        userData.walletKeystoreCloud,
        `vwala_google_device_pin_v1:${currentGoogleUser.uid}`
      )
      walletAddress = unlocked.address
    }

    if (walletAddress) {
      state.userAddress = walletAddress
      localStorage.setItem('vwala_wallet_profile', JSON.stringify({
        uid: currentGoogleUser.uid,
        walletAddress,
        chainId: POLYGON_CHAIN_ID
      }))
    }
  } catch (e) {
    console.error('Erro ao sincronizar wallet:', e)
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
      const unlockedWallet = await Wallet.fromEncryptedJson(deviceVault.walletKeystoreLocal, pin.trim())
      const signer = unlockedWallet.connect(state.provider)
      state.signer = signer
      return signer
    } catch (error) {
      showAlert('PIN Inválido', 'Tente novamente.', 'error')
    }
  }
}

// ==================== CARREGAR MERCADO ====================
async function loadMarket() {
  const marketIdInput = document.getElementById('marketId')
  const marketContent = document.getElementById('marketContent')
  
  const marketId = marketIdInput.value.trim()
  if (!marketId) {
    showAlert('ID vazio', 'Digite o ID da aposta', 'error')
    return
  }

  marketContent.style.display = 'none'
  marketContent.innerHTML = '<p class="loading-text">Carregando mercado...</p>'
  marketContent.style.display = 'block'

  try {
    const contract = new Contract(CONTRACT_ADDRESS, USER_PREDICTIONS_ABI, state.provider)
    const marketData = await contract.getMarket(marketId)

    if (!marketData.exists) throw new Error('Mercado não encontrado')

    currentMarket = { id: marketId, ...marketData }

    const closeDate = new Date(Number(marketData.closeAt) * 1000)

    marketContent.innerHTML = `
      <div class="market-detail-card">
        <h2>${marketData.title || 'Mercado #' + marketId}</h2>
        
        <div class="market-status">
          ${marketData.resolved 
            ? `<span class="status resolved">🔴 Resolvido • Vencedor: ${marketData.winningOption === 0 ? 'A' : 'B'}</span>` 
            : `<span class="status active">🟢 Ativo • Fecha: ${closeDate.toLocaleDateString('pt-BR')}</span>`
          }
        </div>

        <div class="options-bet">
          <div class="option-card" data-option="0">
            <strong>A:</strong> ${marketData.optionA}<br>
            <small>${(Number(marketData.probA)/100).toFixed(1)}% • Pool: ${marketData.poolA}</small>
          </div>
          <div class="option-card" data-option="1">
            <strong>B:</strong> ${marketData.optionB}<br>
            <small>${(Number(marketData.probB)/100).toFixed(1)}% • Pool: ${marketData.poolB}</small>
          </div>
        </div>

        ${!marketData.resolved ? `
        <div class="bet-section">
          <input type="number" id="betAmount" class="input" placeholder="Quantidade vWALA" min="0.1" step="0.1" />
          <div class="bet-buttons">
            <button id="betA" class="bet-btn a">APOSTAR EM A</button>
            <button id="betB" class="bet-btn b">APOSTAR EM B</button>
          </div>
        </div>` : ''}
      </div>
    `

    // Adiciona eventos
    if (!marketData.resolved) {
      document.getElementById('betA').addEventListener('click', () => placeBet(0))
      document.getElementById('betB').addEventListener('click', () => placeBet(1))
    }

  } catch (error) {
    console.error(error)
    marketContent.innerHTML = `<p class="error-text">Mercado não encontrado.<br><small>${error.message}</small></p>`
  }
}

// ==================== APOSTAR ====================
async function placeBet(option) {
  const amountStr = document.getElementById('betAmount').value
  const amount = parseFloat(amountStr)

  if (!amount || amount <= 0) {
    showAlert('Valor inválido', 'Digite uma quantidade maior que zero.', 'error')
    return
  }

  const signer = await getInternalWalletSigner()
  if (!signer) return

  try {
    showLoadingModal('Apostando...', 'Confirmando na Polygon')

    const contract = new Contract(CONTRACT_ADDRESS, USER_PREDICTIONS_ABI, signer)
    const tx = await contract.bet(currentMarket.id, option)   // ajuste se precisar de value ou approve

    await tx.wait()

    hideLoadingModal()
    showAlert('✅ Aposta Confirmada!', `Você apostou ${amount} vWALA na opção ${option === 0 ? 'A' : 'B'}`, 'success')

    setTimeout(loadMarket, 3000) // recarrega

  } catch (error) {
    hideLoadingModal()
    showAlert('Erro ao apostar', error.shortMessage || error.message, 'error')
  }
}

// ==================== RENDER ====================
function renderPage() {
  document.querySelector('#app').innerHTML = `
    <div class="page-shell">
      <div class="app-frame">
        <main class="app-content">
          <div class="market-page">
            <div class="search-box">
              <h1>🔍 Ver Mercado & Apostar</h1>
              <div class="input-group">
                <input type="text" id="marketId" class="input" placeholder="Digite o ID da aposta" />
                <button id="searchBtn" class="search-btn">Buscar</button>
              </div>
            </div>
            <div id="marketContent"></div>
          </div>
        </main>
      </div>
    </div>
  `

  // Agora os listeners são adicionados depois do HTML estar no DOM
  document.getElementById('searchBtn').addEventListener('click', loadMarket)
  document.getElementById('marketId').addEventListener('keypress', e => {
    if (e.key === 'Enter') loadMarket()
  })
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
  renderPage()
}

boot()

console.log("📄 Página Ver Mercado + Apostas v2.1 (corrigida) ✅")