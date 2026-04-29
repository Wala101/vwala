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
  'function createMarket(string title, string optionA, string optionB, uint256 closeAt, uint16 feeBps, uint16 probA, uint16 probB) external returns (uint256)',
  'function resolveMarket(uint256 marketId, uint8 winningOption) external',
  'function getMarket(uint256 marketId) view returns (tuple(bool exists,address creator,uint256 closeAt,uint16 feeBps,uint16 probA,uint16 probB,uint256 poolA,uint256 poolB,uint256 totalPool,bool resolved,uint8 winningOption,uint256 resolvedAt))',
  'function bet(uint256 marketId, uint8 option) external payable', // ← Adicionei (assumindo que existe)
  'event MarketCreated(uint256 indexed marketId, address indexed creator)',
  'event MarketResolved(uint256 indexed marketId, uint8 winningOption)'
]

let currentGoogleUser = null
let currentMarket = null

const state = {
  provider: null,
  signer: null,
  userAddress: ''
}

// ==================== MODAIS (mesmas do outro arquivo) ====================
window.showAlert = (title, message, type = 'success') => { /* ... mesmo código ... */ }
window.showLoadingModal = (title = 'Processando', message = 'Enviando transação...') => { /* ... */ }
window.hideLoadingModal = () => { /* ... */ }
window.showPinModal = (title = 'Confirmar PIN', message = 'Digite seu PIN para continuar') => { /* ... mesmo do outro */ }

// ==================== RESTAURAR WALLET (igual ao outro) ====================
async function syncWalletProfileFromFirebase() {
  if (!currentGoogleUser?.uid) return

  const userRef = doc(db, 'users', currentGoogleUser.uid)
  const userSnap = await getDoc(userRef)

  if (!userSnap.exists()) return

  const userData = userSnap.data()
  let walletAddress = String(userData.walletAddress || '').trim()

  if (!walletAddress && userData.walletKeystoreCloud) {
    try {
      const unlocked = await Wallet.fromEncryptedJson(
        userData.walletKeystoreCloud,
        `vwala_google_device_pin_v1:${currentGoogleUser.uid}`
      )
      walletAddress = unlocked.address
    } catch (e) {
      console.error(e)
    }
  }

  if (walletAddress) {
    state.userAddress = walletAddress
    localStorage.setItem('vwala_wallet_profile', JSON.stringify({
      uid: currentGoogleUser.uid,
      walletAddress,
      chainId: POLYGON_CHAIN_ID,
      network: 'polygon'
    }))
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
    showAlert('Carteira incompatível', 'A carteira não corresponde ao usuário logado.', 'error')
    return null
  }

  while (true) {
    const pin = await window.showPinModal('Confirmar PIN', 'Digite o PIN para apostar')
    if (!pin) return null

    try {
      const unlockedWallet = await Wallet.fromEncryptedJson(deviceVault.walletKeystoreLocal, pin.trim())
      const signer = unlockedWallet.connect(state.provider)
      state.signer = signer
      return signer
    } catch (error) {
      showAlert('PIN Inválido', 'PIN incorreto. Tente novamente.', 'error')
    }
  }
}

// ==================== CARREGAR MERCADO ====================
async function loadMarket() {
  const marketIdInput = document.getElementById('marketId')
  const marketId = marketIdInput.value.trim()
  if (!marketId) {
    showAlert('ID vazio', 'Digite o ID da aposta', 'error')
    return
  }

  const content = document.getElementById('marketContent')
  content.style.display = 'none'
  content.innerHTML = '<p class="loading-text">Carregando mercado...</p>'

  try {
    const contract = new Contract(CONTRACT_ADDRESS, USER_PREDICTIONS_ABI, state.provider)
    const marketData = await contract.getMarket(marketId)

    if (!marketData.exists) {
      throw new Error('Mercado não existe')
    }

    currentMarket = { id: marketId, ...marketData }

    const closeDate = new Date(Number(marketData.closeAt) * 1000)
    const isResolved = marketData.resolved
    const totalPool = marketData.totalPool.toString()

    content.innerHTML = `
      <div class="market-detail-card">
        <h2>${marketData.title || 'Mercado #' + marketId}</h2>
        
        <div class="market-status">
          ${isResolved ? 
            `<span class="status resolved">🔴 Resolvido • Vencedor: ${marketData.winningOption === 0 ? 'A' : 'B'}</span>` : 
            `<span class="status active">🟢 Ativo • Fecha em: ${closeDate.toLocaleDateString('pt-BR')}</span>`
          }
        </div>

        <div class="options-bet">
          <div class="option-card" data-option="0">
            <strong>A:</strong> ${marketData.optionA}<br>
            <small>${(Number(marketData.probA) / 100).toFixed(1)}% • Pool: ${marketData.poolA}</small>
          </div>
          <div class="option-card" data-option="1">
            <strong>B:</strong> ${marketData.optionB}<br>
            <small>${(Number(marketData.probB) / 100).toFixed(1)}% • Pool: ${marketData.poolB}</small>
          </div>
        </div>

        ${!isResolved ? `
        <div class="bet-section">
          <input type="number" id="betAmount" class="input" placeholder="Quantidade vWALA" min="1" step="0.1" />
          <button id="betA" class="bet-btn a">APOSTAR EM A</button>
          <button id="betB" class="bet-btn b">APOSTAR EM B</button>
        </div>` : ''}
      </div>
    `

    content.style.display = 'block'

    // Eventos de aposta
    if (!isResolved) {
      document.getElementById('betA').addEventListener('click', () => placeBet(0))
      document.getElementById('betB').addEventListener('click', () => placeBet(1))
    }

  } catch (error) {
    console.error(error)
    content.innerHTML = `<p class="error-text">Mercado não encontrado ou ID inválido.<br><small>${error.message}</small></p>`
    content.style.display = 'block'
  }
}

// ==================== APOSTAR ====================
async function placeBet(option) {
  const amountInput = document.getElementById('betAmount')
  const amount = parseFloat(amountInput.value)

  if (!amount || amount <= 0) {
    showAlert('Valor inválido', 'Digite uma quantidade válida de vWALA', 'error')
    return
  }

  const signer = await getInternalWalletSigner()
  if (!signer) return

  try {
    showLoadingModal('Confirmando Aposta', 'Enviando transação...')

    const contract = new Contract(CONTRACT_ADDRESS, USER_PREDICTIONS_ABI, signer)
    
    // Ajuste se o bet for payable ou usar approve + bet
    const tx = await contract.bet(currentMarket.id, option, {
      // value: ethers.parseUnits(amount.toString(), 18)  // se for payable
    })

    await tx.wait()

    hideLoadingModal()
    showAlert('✅ Aposta realizada!', `Você apostou ${amount} vWALA na opção ${option === 0 ? 'A' : 'B'}`, 'success')

    // Recarrega o mercado
    loadMarket()

  } catch (error) {
    hideLoadingModal()
    showAlert('Erro na aposta', error.shortMessage || error.message, 'error')
  }
}

// ==================== RENDER PAGE ====================
function renderPage() {
  document.querySelector('#app').innerHTML = `
    <div class="page-shell">
      <div class="app-frame">
        <main class="app-content">
          <div class="market-page">
            <div class="search-box">
              <h1>🔍 Ver Mercado</h1>
              <div class="input-group">
                <input type="text" id="marketId" class="input" placeholder="ID da Aposta (ex: 42)" />
                <button id="searchBtn" class="search-btn">Buscar</button>
              </div>
            </div>

            <div id="marketContent" class="market-content"></div>
          </div>
        </main>
      </div>
    </div>
  `

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

console.log("📄 Página Ver Mercado + Apostas v2 ✅")