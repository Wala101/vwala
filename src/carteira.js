import { auth, db, googleProvider } from './firebase'
import {
  browserLocalPersistence,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signInWithRedirect
} from 'firebase/auth'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { JsonRpcProvider, Wallet, formatEther } from 'ethers'

const app = document.querySelector('#app')

if (!app) {
  throw new Error('Elemento #app não encontrado.')
}

const walletState = {
  polBalance: '12.85',
  vwalaBalance: '0.00',
  userTokens: []
}

let currentGoogleUser = null
let currentWalletAddress = ''

const modalState = {
  resolve: null,
  mode: 'message'
}

const POLYGON_RPC_URL = import.meta.env.VITE_POLYGON_RPC_URL
const POLYGON_CHAIN_ID = Number(import.meta.env.VITE_POLYGON_CHAIN_ID || 137)

if (!POLYGON_RPC_URL) {
  throw new Error('VITE_POLYGON_RPC_URL não configurada.')
}

function formatAmount(value = '0', symbol = '') {
  const num = Number(value || 0)

  if (!Number.isFinite(num)) {
    return `0 ${symbol}`.trim()
  }

  return `${num.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6
  })} ${symbol}`.trim()
}

function formatWalletAddress(address = '') {
  if (!address) return 'Carteira ainda não criada'
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function updateWalletAddressUI(address = '') {
  const walletAddressText = document.getElementById('walletAddressText')
  if (walletAddressText) {
    walletAddressText.textContent = formatWalletAddress(address)
  }
}

function updatePolygonBalanceUI(value = '0') {
  walletState.polBalance = value

  const mainBalanceValue = document.querySelector('.wallet-balance-value')
  if (mainBalanceValue) {
    mainBalanceValue.innerHTML = `
      ${Number(value || 0).toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 6
      })}
      <span class="wallet-balance-symbol">POL</span>
    `
  }

  const polBalanceStrong = document.querySelector(
    '.wallet-token-list .wallet-token-card:first-child .wallet-token-balance strong'
  )

  if (polBalanceStrong) {
    polBalanceStrong.textContent = formatAmount(value, 'POL')
  }
}

async function loadPolygonBalance(walletAddress) {
  try {
    if (!walletAddress) return

    const provider = new JsonRpcProvider(POLYGON_RPC_URL)
    const balanceWei = await provider.getBalance(walletAddress)
    const balanceFormatted = formatEther(balanceWei)

    updatePolygonBalanceUI(balanceFormatted)
  } catch (error) {
    console.error('Erro ao carregar saldo POL:', error)
    updatePolygonBalanceUI('0')
  }
}

async function handleWalletAction(action) {
  if (action === 'enviar') {
    await showMessageModal(
      'Enviar',
      'A função Enviar será ligada à carteira interna.'
    )
    return
  }

  if (action === 'receber') {
    if (!currentWalletAddress) {
      await showMessageModal(
        'Carteira',
        'Carteira ainda não carregada.'
      )
      return
    }

    try {
      await navigator.clipboard.writeText(currentWalletAddress)

      await showMessageModal(
        'Endereço copiado',
        currentWalletAddress,
        'Fechar'
      )
    } catch (error) {
      console.error('Erro ao copiar endereço:', error)

      await showMessageModal(
        'Seu endereço',
        currentWalletAddress,
        'Fechar'
      )
    }

    return
  }

  if (action === 'swap') {
    await showMessageModal(
      'Swap',
      'O swap interno 1 POL = 1 vWALA será ligado ao sistema.'
    )
  }
}

function renderUserTokens() {
  if (!walletState.userTokens.length) {
    return `
      <div class="wallet-empty">
        Nenhum token criado pelo usuário ainda.
      </div>
    `
  }

  return walletState.userTokens
    .map((token) => {
      return `
        <div class="wallet-token-card">
          <div class="wallet-token-left">
            <div class="wallet-token-icon user">T</div>
            <div class="wallet-token-info">
              <div class="wallet-token-name">${token.name}</div>
              <div class="wallet-token-symbol">${token.symbol}</div>
            </div>
          </div>

          <div class="wallet-token-balance">
            <strong>${formatAmount(token.balance, token.symbol)}</strong>
            <small>Token do usuário</small>
          </div>
        </div>
      `
    })
    .join('')
}

app.innerHTML = `
  <div class="wallet-page">
    <div class="wallet-shell">
      <header class="wallet-topbar">
        <div class="wallet-brand">
          <div class="wallet-brand-badge">W</div>
          <div class="wallet-brand-text">
            <strong>vWALA</strong>
            <span>Carteira</span>
          </div>
        </div>

        <div class="wallet-vwala-chip">
          ${formatAmount(walletState.vwalaBalance, 'vWALA')}
        </div>
      </header>

      <section class="wallet-main-card">
        <div class="wallet-balance-label">Saldo em Polygon</div>
        <div class="wallet-balance-value">
          ${Number(walletState.polBalance).toLocaleString('pt-BR', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 6
          })}
          <span class="wallet-balance-symbol">POL</span>
        </div>
        <div class="wallet-network">Polygon Mainnet</div>
        <div class="wallet-network" id="walletAddressText">
          ${formatWalletAddress(currentWalletAddress)}
        </div>
      </section>

      <section class="wallet-actions">
  <button class="wallet-action" data-action="enviar" type="button">
    <span class="wallet-action-icon">↗</span>
    <span class="wallet-action-label">Enviar</span>
  </button>

  <button class="wallet-action" data-action="receber" type="button">
    <span class="wallet-action-icon">↙</span>
    <span class="wallet-action-label">Receber</span>
  </button>

  <button class="wallet-action" data-action="swap" type="button">
    <span class="wallet-action-icon">⇄</span>
    <span class="wallet-action-label">Swap</span>
  </button>
</section>

      <section class="wallet-tabs">
  <button class="wallet-tab active" type="button">Tokens</button>
</section>

      <section class="wallet-token-list">
  <div class="wallet-token-card">
    <div class="wallet-token-left">
      <div class="wallet-token-icon pol">
        <img src="/Polygon-MATIC.webp" alt="Polygon" />
      </div>
      <div class="wallet-token-info">
        <div class="wallet-token-name">Polygon</div>
        <div class="wallet-token-symbol">POL</div>
      </div>
    </div>

    <div class="wallet-token-balance">
      <strong>${formatAmount(walletState.polBalance, 'POL')}</strong>
      <small>Saldo principal</small>
    </div>
  </div>

  <div class="wallet-token-card">
    <div class="wallet-token-left">
      <div class="wallet-token-icon vwala">
        <img src="/logo.png" alt="vWALA" />
      </div>
      <div class="wallet-token-info">
        <div class="wallet-token-name">vWALA</div>
        <div class="wallet-token-symbol">vWALA</div>
      </div>
    </div>

    <div class="wallet-token-balance">
      <strong>${formatAmount(walletState.vwalaBalance, 'vWALA')}</strong>
      <small>Token da plataforma</small>
    </div>
  </div>

  ${renderUserTokens()}
</section>
    </div>
  </div>

  <div id="authGate" class="wallet-auth-gate hidden">
    <div class="wallet-auth-modal">
      <div class="wallet-auth-badge">W</div>
      <h2>Crie sua carteira com Google</h2>
      <p>
        Entre com sua conta Google para ativar sua carteira interna e manter seu acesso em todas as páginas.
      </p>

      <button id="googleLoginBtn" class="wallet-auth-google-btn" type="button">
        Continuar com Google
      </button>
    </div>
  </div>

  <div id="uiModal" class="wallet-auth-gate hidden">
    <div class="wallet-auth-modal wallet-ui-modal-box">
      <div class="wallet-auth-badge">W</div>
      <h2 id="uiModalTitle">Aviso</h2>
      <p id="uiModalText"></p>

      <input
        id="uiModalInput"
        class="wallet-modal-input hidden"
        type="password"
        placeholder=""
        autocomplete="off"
      />

      <div class="wallet-modal-actions">
        <button id="uiModalCancelBtn" class="wallet-modal-secondary-btn" type="button">
          Cancelar
        </button>

        <button id="uiModalConfirmBtn" class="wallet-auth-google-btn" type="button">
          OK
        </button>
      </div>
    </div>
  </div>
`

const authGate = document.getElementById('authGate')
const googleLoginBtn = document.getElementById('googleLoginBtn')

const uiModal = document.getElementById('uiModal')
const uiModalTitle = document.getElementById('uiModalTitle')
const uiModalText = document.getElementById('uiModalText')
const uiModalInput = document.getElementById('uiModalInput')
const uiModalCancelBtn = document.getElementById('uiModalCancelBtn')
const uiModalConfirmBtn = document.getElementById('uiModalConfirmBtn')

function openUiModal({
  title = 'Aviso',
  text = '',
  mode = 'message',
  confirmText = 'OK',
  cancelText = 'Cancelar',
  placeholder = '',
  password = false,
  initialValue = '',
  showCancel = false
} = {}) {
  return new Promise((resolve) => {
    modalState.resolve = resolve
    modalState.mode = mode

    uiModalTitle.textContent = title
    uiModalText.textContent = text
    uiModalConfirmBtn.textContent = confirmText
    uiModalCancelBtn.textContent = cancelText
    uiModalCancelBtn.style.display = showCancel ? 'inline-flex' : 'none'

    if (mode === 'prompt') {
      uiModalInput.classList.remove('hidden')
      uiModalInput.type = password ? 'password' : 'text'
      uiModalInput.placeholder = placeholder
      uiModalInput.value = initialValue
      setTimeout(() => uiModalInput.focus(), 0)
    } else {
      uiModalInput.classList.add('hidden')
      uiModalInput.value = ''
    }

    uiModal.classList.remove('hidden')
  })
}

function closeUiModal(result = null) {
  uiModal.classList.add('hidden')

  const resolve = modalState.resolve
  modalState.resolve = null

  if (resolve) {
    resolve(result)
  }
}

async function showMessageModal(title, text, confirmText = 'OK') {
  await openUiModal({
    title,
    text,
    confirmText,
    showCancel: false
  })
}

async function showPinModal(title, text, confirmText = 'Continuar') {
  return openUiModal({
    title,
    text,
    mode: 'prompt',
    confirmText,
    cancelText: 'Cancelar',
    placeholder: 'Digite seu PIN',
    password: true,
    showCancel: true
  })
}

uiModalConfirmBtn?.addEventListener('click', () => {
  if (modalState.mode === 'prompt') {
    closeUiModal(uiModalInput.value)
    return
  }

  closeUiModal(true)
})

uiModalCancelBtn?.addEventListener('click', () => {
  closeUiModal(null)
})

uiModal?.addEventListener('click', (event) => {
  if (event.target === uiModal) {
    closeUiModal(null)
  }
})

uiModalInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault()
    closeUiModal(uiModalInput.value)
    return
  }

  if (event.key === 'Escape') {
    event.preventDefault()
    closeUiModal(null)
  }
})

function openAuthGate() {
  authGate?.classList.remove('hidden')
}

function closeAuthGate() {
  authGate?.classList.add('hidden')
}

function saveFirebaseUser(user) {
  if (!user) {
    localStorage.removeItem('vwala_user')
    return
  }

  localStorage.setItem(
    'vwala_user',
    JSON.stringify({
      uid: user.uid,
      name: user.displayName || '',
      email: user.email || '',
      photo: user.photoURL || ''
    })
  )
}

async function ensureUserWalletProfile(user) {
  if (!user?.uid) {
    throw new Error('Usuário inválido para criar carteira.')
  }

  const userRef = doc(db, 'users', user.uid)
  const userSnap = await getDoc(userRef)

  if (userSnap.exists()) {
    const userData = userSnap.data()

    currentWalletAddress = userData.walletAddress || ''
    updateWalletAddressUI(currentWalletAddress)

    localStorage.setItem(
      'vwala_wallet_profile',
      JSON.stringify({
        uid: user.uid,
        walletAddress: currentWalletAddress,
        chainId: userData.chainId || POLYGON_CHAIN_ID,
        network: userData.network || 'polygon'
      })
    )

    return userData
  }

  const pin = await showPinModal(
    'Criar PIN',
    'Crie um PIN da carteira com pelo menos 6 caracteres.',
    'Continuar'
  )

  if (pin === null) {
    return null
  }

  if (!pin || pin.trim().length < 6) {
    await showMessageModal(
      'PIN inválido',
      'Use pelo menos 6 caracteres.'
    )
    return null
  }

  const confirmPin = await showPinModal(
    'Confirmar PIN',
    'Confirme o PIN da carteira.',
    'Confirmar'
  )

  if (confirmPin === null) {
    return null
  }

  if (pin !== confirmPin) {
    await showMessageModal(
      'PIN diferente',
      'Os PINs não coincidem.'
    )
    return null
  }

  const wallet = Wallet.createRandom()
  const walletKeystore = await wallet.encrypt(pin.trim())

  const payload = {
    uid: user.uid,
    email: user.email || '',
    name: user.displayName || '',
    photo: user.photoURL || '',
    walletAddress: wallet.address,
    walletKeystore,
    chainId: POLYGON_CHAIN_ID,
    network: 'polygon',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }

  await setDoc(userRef, payload)

  currentWalletAddress = wallet.address
  updateWalletAddressUI(currentWalletAddress)

  localStorage.setItem(
    'vwala_wallet_profile',
    JSON.stringify({
      uid: user.uid,
      walletAddress: wallet.address,
      chainId: POLYGON_CHAIN_ID,
      network: 'polygon'
    })
  )

  await showMessageModal(
    'Carteira criada',
    'Carteira criada com sucesso.'
  )

  return payload
}

async function loginWithGoogle() {
  if (!googleLoginBtn) return

  const originalText = googleLoginBtn.textContent

  try {
    googleLoginBtn.disabled = true
    googleLoginBtn.textContent = 'Entrando...'

    await setPersistence(auth, browserLocalPersistence)

    try {
      await signInWithPopup(auth, googleProvider)
    } catch (error) {
      if (
        error?.code === 'auth/popup-blocked' ||
        error?.code === 'auth/operation-not-supported-in-this-environment'
      ) {
        await signInWithRedirect(auth, googleProvider)
        return
      }

      throw error
    }
  } catch (error) {
    console.error('Erro ao entrar com Google:', error)

    await showMessageModal(
      'Erro de login',
      'Não foi possível entrar com Google.'
    )
  } finally {
    googleLoginBtn.disabled = false
    googleLoginBtn.textContent = originalText
  }
}

async function initFirebaseAuthGate() {
  try {
    await setPersistence(auth, browserLocalPersistence)

    onAuthStateChanged(auth, async (user) => {
      currentGoogleUser = user || null
      saveFirebaseUser(user)

      if (user) {
        closeAuthGate()

        try {
          const walletProfile = await ensureUserWalletProfile(user)

          if (walletProfile?.walletAddress) {
            await loadPolygonBalance(walletProfile.walletAddress)
          }
        } catch (error) {
          console.error('Erro ao preparar carteira do usuário:', error)

          await showMessageModal(
            'Erro da carteira',
            error?.message || 'Não foi possível preparar sua carteira.'
          )
        }
        return
      }

      currentWalletAddress = ''
      localStorage.removeItem('vwala_wallet_profile')
      openAuthGate()
    })
  } catch (error) {
    console.error('Erro ao iniciar autenticação Firebase:', error)
    openAuthGate()
  }
}

googleLoginBtn?.addEventListener('click', loginWithGoogle)

document.querySelectorAll('.wallet-action').forEach((button) => {
  const action = button.getAttribute('data-action')

  button.addEventListener('click', async () => {
    if (!currentGoogleUser) {
      openAuthGate()
      return
    }

    await handleWalletAction(action)
  })
})

initFirebaseAuthGate()