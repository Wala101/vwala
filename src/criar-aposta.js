import './style/style.css'
import { auth, db } from './firebase'
import {
  browserLocalPersistence,
  onAuthStateChanged,
  setPersistence
} from 'firebase/auth'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { JsonRpcProvider, Wallet, Contract, parseUnits } from 'ethers'

const POLYGON_CHAIN_ID = Number(import.meta.env.VITE_POLYGON_CHAIN_ID || 137)
const POLYGON_RPC_PRIMARY_URL = new URL('/api/rpc', window.location.origin).toString()

const CONTRACT_ADDRESS = '0x25F9007ef8E62796C1ed0259B6266d097577e133'
const VWALA_TOKEN = '0x7bD1f6f4F5CEf026b643758605737CB48b4B7D83'
const TOKEN_SYMBOL = 'vWALA'

const USER_PREDICTIONS_ABI = [
  'function createMarket(string title, string optionA, string optionB, uint256 closeAt, uint16 feeBps, uint16 probA, uint16 probB) external returns (uint256)',
  'function getMarket(uint256 marketId) external view returns (tuple(bool exists, address creator, uint256 closeAt, uint16 feeBps, uint16 probA, uint16 probB, uint256 poolA, uint256 poolB, uint256 totalPool, bool resolved, uint8 winningOption, uint256 resolvedAt))'
]

let currentGoogleUser = null

const state = {
  provider: null,
  signer: null,
  userAddress: '',
  token: null,
  decimals: 18
}

const showAlert = window.showAlert || ((t, m) => alert(t + '\n\n' + m))
const showLoadingModal = window.showLoadingModal || (() => {})
const hideLoadingModal = window.hideLoadingModal || (() => {})

// ==================== CARTEIRA INTERNA (igual ao futebol) ====================
async function syncWalletProfileFromFirebase() {
  if (!currentGoogleUser?.uid) {
    state.userAddress = ''
    return
  }

  const userRef = doc(db, 'users', currentGoogleUser.uid)
  const userSnap = await getDoc(userRef)

  if (!userSnap.exists()) {
    state.userAddress = ''
    localStorage.removeItem('vwala_wallet_profile')
    return
  }

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
      console.error('Erro ao descriptografar keystore cloud:', e)
    }
  }

  if (walletAddress) {
    localStorage.setItem('vwala_wallet_profile', JSON.stringify({
      uid: currentGoogleUser.uid,
      walletAddress,
      chainId: POLYGON_CHAIN_ID,
      network: 'polygon'
    }))
    state.userAddress = walletAddress
  }
}

async function initFirebaseSession() {
  try {
    await setPersistence(auth, browserLocalPersistence)

    await new Promise(resolve => {
      const unsubscribe = onAuthStateChanged(auth, async (user) => {
        currentGoogleUser = user
        if (user) await syncWalletProfileFromFirebase()
        unsubscribe()
        resolve()
      })
    })
  } catch (error) {
    console.error('Erro initFirebaseSession:', error)
  }
}

async function getInternalWalletSigner() {
  if (state.signer) return state.signer

  const deviceVault = JSON.parse(localStorage.getItem('vwala_device_wallet') || 'null')

  if (!deviceVault?.walletKeystoreLocal) {
    showAlert('Carteira não encontrada', 'Crie um PIN na página de Swap primeiro.')
    return null
  }

  const expectedAddress = state.userAddress.toLowerCase()
  const vaultAddress = String(deviceVault.walletAddress || '').toLowerCase()

  if (expectedAddress !== vaultAddress) {
    showAlert('Carteira incompatível', 'A carteira local não bate com a logada.')
    return null
  }

  while (true) {
    const pin = await new Promise(resolve => {
      // Se você tiver o modal de PIN global, use ele
      if (typeof window.showPinModal === 'function') {
        window.showPinModal('Confirmar PIN', 'Digite o PIN para criar a aposta').then(resolve)
      } else {
        const p = prompt('Digite o PIN da carteira:')
        resolve(p)
      }
    })

    if (!pin) return null

    try {
      const unlockedWallet = await Wallet.fromEncryptedJson(deviceVault.walletKeystoreLocal, pin.trim())
      const signer = unlockedWallet.connect(state.provider)

      state.signer = signer
      return signer
    } catch (error) {
      showAlert('PIN Inválido', 'PIN incorreto. Tente novamente.')
    }
  }
}

// ==================== SALDO (igual ao futebol) ====================
async function loadUserTokenBalance() {
  if (!currentGoogleUser?.uid || !state.userAddress) return '0'

  try {
    const balanceRef = doc(db, 'users', currentGoogleUser.uid, 'swap_balances', 'vwala')
    const snap = await getDoc(balanceRef)

    if (snap.exists()) {
      const data = snap.data()
      return String(data.balanceFormatted || data.balance || '0')
    }

    // Fallback on-chain (opcional)
    const provider = new JsonRpcProvider(POLYGON_RPC_PRIMARY_URL)
    const token = new Contract(VWALA_TOKEN, ['function balanceOf(address) view returns (uint256)'], provider)
    const raw = await token.balanceOf(state.userAddress)
    return parseUnits(raw, 18).toFixed(2) // simplificado
  } catch (e) {
    console.error(e)
    return '0'
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
    showAlert('Erro', 'Preencha todos os campos!')
    return
  }
  if (probA + probB !== 100) {
    showAlert('Erro', 'As probabilidades devem somar 100%')
    return
  }

  const closeAt = Math.floor(new Date(closeAtStr).getTime() / 1000)
  const btn = document.getElementById('createBtn')
  btn.disabled = true
  btn.textContent = "Criando..."

  try {
    const internalSigner = await getInternalWalletSigner()
    if (!internalSigner) return

    const contract = new Contract(CONTRACT_ADDRESS, USER_PREDICTIONS_ABI, internalSigner)

    showLoadingModal('Criando Aposta', 'Enviando transação para a Polygon...')

    const tx = await contract.createMarket(
      title,
      optionA,
      optionB,
      closeAt,
      300,           // 3% fee
      probA * 100,
      probB * 100
    )

    await tx.wait()

    hideLoadingModal()
    showAlert('Sucesso!', `Aposta criada com sucesso!\n\nTx: ${tx.hash}`)

    // Limpar formulário
    document.getElementById('title').value = ''
    document.getElementById('optionA').value = ''
    document.getElementById('optionB').value = ''
    document.getElementById('probA').value = '50'
    document.getElementById('probB').value = '50'

  } catch (error) {
    hideLoadingModal()
    console.error(error)
    showAlert('Erro', error.shortMessage || error.message || 'Falha ao criar aposta')
  } finally {
    btn.disabled = false
    btn.textContent = "Criar Aposta"
  }
}

// ==================== RENDER (com topbar igual ao futebol) ====================
function renderPage() {
  document.querySelector('#app').innerHTML = `
    <div class="page-shell">
      <div class="app-frame">
        <header class="topbar">
          <button class="menu-btn" id="menuBtn" type="button" aria-label="Abrir menu">
            <span></span><span></span><span></span>
          </button>

          <div class="brand-wrap">
            <div class="brand-badge">W</div>
            <div class="brand-text">
              <strong>Wala-v2</strong>
              <span>Criar Aposta</span>
            </div>
          </div>

          <button id="connectBtn" class="connect" type="button">
            Carregando saldo...
          </button>
        </header>

        <main class="app-content">
          <div class="create-page">
            <div class="create-header">
              <h1>🎲 Criar Nova Aposta</h1>
              <p>Crie seu próprio mercado • Apenas você pode resolver</p>
            </div>

            <div class="form-card">
              <input type="text" id="title" class="input" placeholder="Título da Aposta" />

              <div class="options-grid">
                <input type="text" id="optionA" class="input" placeholder="Opção A" />
                <input type="text" id="optionB" class="input" placeholder="Opção B" />
              </div>

              <input type="datetime-local" id="closeAt" class="input" />

              <div class="prob-row">
                <div>
                  <label>Prob. A (%)</label>
                  <input type="number" id="probA" value="50" min="1" max="99" class="input" />
                </div>
                <div>
                  <label>Prob. B (%)</label>
                  <input type="number" id="probB" value="50" min="1" max="99" class="input" />
                </div>
              </div>

              <button id="createBtn" class="launch-btn">Criar Aposta</button>
            </div>
          </div>
        </main>
      </div>
    </div>
  `

  document.getElementById('createBtn').addEventListener('click', createMarket)
  document.getElementById('connectBtn').addEventListener('click', () => loadUserTokenBalance())
}

// ==================== BOOT ====================
async function boot() {
  await initFirebaseSession()

  // Inicializa provider
  state.provider = new JsonRpcProvider(POLYGON_RPC_PRIMARY_URL, POLYGON_CHAIN_ID)

  renderPage()

  // Carrega saldo
  const balance = await loadUserTokenBalance()
  const connectBtn = document.getElementById('connectBtn')
  if (connectBtn) connectBtn.textContent = `${balance} ${TOKEN_SYMBOL}`
}

boot()

console.log("📄 Página Criar Aposta v2 carregada com carteira interna padronizada")