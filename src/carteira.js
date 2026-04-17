import { auth, db, googleProvider } from './firebase'
import {
  browserLocalPersistence,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signInWithRedirect
} from 'firebase/auth'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { Wallet } from 'ethers'

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

function handleWalletAction(action) {
  if (action === 'enviar') {
    alert('A função Enviar será ligada à carteira interna.')
    return
  }

  if (action === 'receber') {
    alert('A função Receber mostrará o endereço interno da carteira.')
    return
  }

  if (action === 'swap') {
    alert('O swap interno 1 POL = 1 vWALA será ligado ao sistema.')
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
        <img src="/polygon-MATIC.webp" alt="Polygon" />
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
`

const authGate = document.getElementById('authGate')
const googleLoginBtn = document.getElementById('googleLoginBtn')

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
    alert('Não foi possível entrar com Google.')
  } finally {
    googleLoginBtn.disabled = false
    googleLoginBtn.textContent = originalText
  }
}

async function initFirebaseAuthGate() {
  try {
    await setPersistence(auth, browserLocalPersistence)

    onAuthStateChanged(auth, (user) => {
      currentGoogleUser = user || null
      saveFirebaseUser(user)

      if (user) {
        closeAuthGate()
        return
      }

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

  button.addEventListener('click', () => {
    if (!currentGoogleUser) {
      openAuthGate()
      return
    }

    handleWalletAction(action)
  })
})

initFirebaseAuthGate()