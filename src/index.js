

import { auth } from './firebase'
import {
  browserLocalPersistence,
  onAuthStateChanged,
  setPersistence
} from 'firebase/auth'
import { Contract, JsonRpcProvider, formatUnits } from 'ethers'

const app = document.querySelector('#app')

if (!app) {
  throw new Error('Elemento #app não encontrado.')
}

const TOKEN_SYMBOL = 'vWALA'
const POLYGON_RPC_URL = new URL('/api/rpc', window.location.origin).toString()
const VWALA_TOKEN_ADDRESS = '0x7bD1f6f4F5CEf026b643758605737CB48b4B7D83'

let currentFirebaseUser = null

const ERC20_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)'
]

function getCurrentSessionUid() {
  const runtimeUid = String(currentFirebaseUser?.uid || '').trim()

  if (runtimeUid) {
    return runtimeUid
  }

  try {
    const rawUser = localStorage.getItem('vwala_user')
    if (!rawUser) return ''
    return String(JSON.parse(rawUser)?.uid || '').trim()
  } catch (error) {
    console.error('Erro ao ler sessão local:', error)
    return ''
  }
}

function readWalletProfile() {
  try {
    const currentUid = getCurrentSessionUid()

    const rawDeviceWallet = localStorage.getItem('vwala_device_wallet')
    if (rawDeviceWallet) {
      const parsedDeviceWallet = JSON.parse(rawDeviceWallet)
      const deviceUid = String(parsedDeviceWallet?.uid || '').trim()

      if (
        parsedDeviceWallet?.walletAddress &&
        (!currentUid || !deviceUid || deviceUid === currentUid)
      ) {
        return parsedDeviceWallet
      }
    }

    const rawProfile = localStorage.getItem('vwala_wallet_profile')
    if (rawProfile) {
      const parsedProfile = JSON.parse(rawProfile)
      const profileUid = String(parsedProfile?.uid || '').trim()

      if (
        parsedProfile?.walletAddress &&
        (!currentUid || !profileUid || profileUid === currentUid)
      ) {
        return parsedProfile
      }
    }

    return null
  } catch (error) {
    console.error('Erro ao ler carteira local:', error)
    return null
  }
}

function getCurrentWalletAddress() {
  const wallet = readWalletProfile()

  return String(
    wallet?.walletAddress ||
    wallet?.address ||
    wallet?.wallet_address ||
    ''
  ).trim()
}

function formatTokenBalance(value = 0) {
  const num = Number(value || 0)

  if (!Number.isFinite(num)) {
    return `0,00 ${TOKEN_SYMBOL}`
  }

  return `${num.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4
  })} ${TOKEN_SYMBOL}`
}

function setConnectButtonText(text) {
  const connectBtn = document.getElementById('connectBtn')
  if (connectBtn) connectBtn.textContent = text
}

async function loadUserTokenBalance() {
  try {
    const walletAddress = getCurrentWalletAddress()

    if (!walletAddress) {
      setConnectButtonText(`Sem carteira`)
      return
    }

    setConnectButtonText('Carregando saldo...')

    const provider = new JsonRpcProvider(POLYGON_RPC_URL)
    const tokenContract = new Contract(VWALA_TOKEN_ADDRESS, ERC20_ABI, provider)

    const [rawBalance, decimals] = await Promise.all([
      tokenContract.balanceOf(walletAddress),
      tokenContract.decimals()
    ])

    const formattedBalance = Number(formatUnits(rawBalance, decimals))

    setConnectButtonText(formatTokenBalance(formattedBalance))
    console.log(`Saldo ${TOKEN_SYMBOL} da carteira ${walletAddress}:`, formattedBalance)
  } catch (error) {
    console.error(`Erro ao carregar saldo ${TOKEN_SYMBOL}:`, error)
    setConnectButtonText(`0,00 ${TOKEN_SYMBOL}`)
  }
}

app.innerHTML = `
  <div id="sidebarOverlay" class="overlay"></div>


  <div class="page-shell">
    <div class="app-frame">
      <header class="topbar">
        <button class="menu-btn" id="menuBtn" type="button" aria-label="Abrir menu">
          <span></span>
          <span></span>
          <span></span>
        </button>

        <div class="brand-wrap">
          <div class="brand-badge">W</div>
          <div class="brand-text">
            <strong>Wala-v2</strong>
            <span>Mercado</span>
          </div>
        </div>

        <div id="connectBtn" class="connect" aria-live="polite">
  Carregando saldo...
</div>
      </header>



      <aside id="sidebar" class="side-menu">
       <a href="/carteira">Carteira</a>
        <a href="/token">Criar Token</a>
        <a href="/apostas">Futebol</a>
        <a href="/predicoes.html">Predições</a>
        <a href="/posicoes">H/Futebol</a>
        <a href="/historico">H/Futures</a>
      </aside>

      <main class="app-content">
        <section class="hero-card">
          <div class="hero-copy">
            <p class="eyebrow">VWALA · POLYGON</p>
            <h1>vWALA Platform</h1>
            <p class="hero-text">
              Plataforma de previsões, swap interno, stake e liquidez em Polygon.
            </p>
          </div>

          <div class="hero-stats">
            <div class="stat-box">
              <span>Mercado</span>
              <strong>Futebol e Predições</strong>
            </div>

            <div class="stat-box">
              <span>Status</span>
              <strong>Em construção</strong>
            </div>

            <div class="stat-box">
              <span>Rede</span>
              <strong>Polygon</strong>
            </div>
          </div>
        </section>

        <section class="section-head">
          <div>
            <p class="section-kicker">DESTAQUES</p>
            <h2>Acessos principais</h2>
          </div>
        </section>

        <section class="cards-list">
          <article
            class="feature-card clickable-card"
            data-href="/apostas.html"
            role="button"
            tabindex="0"
            aria-label="Abrir página Futebol"
          >
            <div class="feature-card-top">
              <span class="feature-badge">⚽</span>
              <span class="feature-chip">Em destaque</span>
            </div>

            <h3>Futebol</h3>
            <p>
              Jogos, probabilidades e abertura de posições no mercado esportivo.
            </p>

            <div class="feature-card-footer">
              <span>Abrir</span>
              <strong style="display: none;">futebol</strong>
            </div>
          </article>

          <article
            class="feature-card clickable-card"
            data-href="/predicoes.html"
            role="button"
            tabindex="0"
            aria-label="Abrir página Predições"
          >
            <div class="feature-card-top">
              <span class="feature-badge">📈</span>
              <span class="feature-chip">Novo</span>
            </div>

            <h3>Predições</h3>
            <p>
              Área de mercado binário para cripto com posições de sim ou não.
            </p>

            <div class="feature-card-footer">
              <span>Abrir</span>
              <strong style="display: none;">predicoes.html</strong>
            </div>
          </article>

          <article
            class="feature-card clickable-card"
            data-href="/token.html"
            role="button"
            tabindex="0"
            aria-label="Abrir página Criar Token"
          >
            <div class="feature-card-top">
              <span class="feature-badge">🧾</span>
              <span class="feature-chip">Token</span>
            </div>

            <h3>Criar Token</h3>
            <p>
              Crie seu token com imagem, nome, símbolo e metadata ligada ao ecossistema WALA.
            </p>

            <div class="feature-card-footer">
              <span>Abrir</span>
              <strong style="display: none;">token.html</strong>
            </div>
          </article>
        </section>

        <section class="section-head">
          <div>
            <p class="section-kicker">ATALHOS</p>
            <h2>Outras páginas</h2>
          </div>
        </section>

        <section class="shortcut-grid">
          <a class="shortcut-card" href="/apostas.html">
            <span class="shortcut-icon">⚽</span>
            <strong>Futebol</strong>
            <small>Mercado esportivo</small>
          </a>

          <a class="shortcut-card" href="/predicoes.html">
            <span class="shortcut-icon">📈</span>
            <strong>Predições</strong>
            <small>Mercado binário cripto</small>
          </a>

         <a class="shortcut-card" href="/token.html">
          <span class="shortcut-icon">🧾</span>
          <strong>Criar Token</strong>
          <small>Crie seu token</small>
        </a>



          <a class="shortcut-card" href="/carteira.html">
            <span class="shortcut-icon">👛</span>
            <strong>Carteira</strong>
            <small>Saldo e ações internas</small>
          </a>
        </section>
      </main>
    </div>
  </div>
`

const sidebar = document.getElementById('sidebar')

const sidebarOverlay = document.getElementById('sidebarOverlay')

const menuBtn = document.getElementById('menuBtn')
const connectBtn = document.getElementById('connectBtn')

const clickableCards = document.querySelectorAll('.clickable-card')

function goTo(path) {
  if (!path) return
  window.location.href = path
}

function openSidebar() {
  sidebar.style.right = '0'
  sidebarOverlay.classList.add('active')
}

function closeSidebar() {
  sidebar.style.right = '-280px'
  sidebarOverlay.classList.remove('active')
}



async function initFirebaseSession() {
  try {
    await setPersistence(auth, browserLocalPersistence)

    await new Promise((resolve) => {
      let finished = false

      const unsubscribe = onAuthStateChanged(auth, (user) => {
        currentFirebaseUser = user || null

        if (user) {
          localStorage.setItem(
            'vwala_user',
            JSON.stringify({
              uid: user.uid,
              name: user.displayName || '',
              email: user.email || '',
              photo: user.photoURL || ''
            })
          )
        } else {
          localStorage.removeItem('vwala_user')
        }

        if (!finished) {
          finished = true
          unsubscribe()
          resolve()
        }
      })
    })
  } catch (error) {
    console.error('Erro ao iniciar sessão Firebase:', error)
  }
}



menuBtn?.addEventListener('click', openSidebar)
sidebarOverlay?.addEventListener('click', closeSidebar)


// saldo somente leitura



clickableCards.forEach((card) => {
  const target = card.getAttribute('data-href')

  card.addEventListener('click', () => {
    goTo(target)
  })

  card.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      goTo(target)
    }
  })
})

document.querySelectorAll('#sidebar a').forEach((link) => {
  link.addEventListener('click', () => {
    closeSidebar()
  })
})



async function initApp() {

  await initFirebaseSession()
  await loadUserTokenBalance()
}

initApp()