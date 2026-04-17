

const app = document.querySelector('#app')

if (!app) {
  throw new Error('Elemento #app não encontrado.')
}

const TOKEN_SYMBOL = 'vWALA'

let walletConnected = false
let connectedAddress = ''

function getEthereumProvider() {
  if (window.ethereum) return window.ethereum
  return null
}

function formatWalletAddress(address = '') {
  if (!address) return 'Conectar Wallet'
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function setConnectButtonText(text) {
  const connectBtn = document.getElementById('connectBtn')
  if (connectBtn) connectBtn.textContent = text
}

async function detectVwalaTokenProgram() {
  const mintInfo = await connection.getAccountInfo(VWALA_MINT)

  if (!mintInfo) {
    throw new Error('Mint vWala não encontrada na rede.')
  }

  vwalaTokenProgramId = mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)
    ? TOKEN_2022_PROGRAM_ID
    : TOKEN_PROGRAM_ID

  return vwalaTokenProgramId
}

async function loadWalletTokenBalance() {
  try {
    if (!connectedPublicKey) return

    const tokenProgram = await detectVwalaTokenProgram()

    const userAta = await getAssociatedTokenAddress(
      VWALA_MINT,
      connectedPublicKey,
      false,
      tokenProgram
    )

    const ataInfo = await connection.getAccountInfo(userAta)

    if (!ataInfo) {
      setConnectButtonText(formatTokenBalance(0))
      return
    }

    const balance = await connection.getTokenAccountBalance(userAta)
    const uiAmount = Number(balance?.value?.uiAmount || 0)

    setConnectButtonText(formatTokenBalance(uiAmount))
    console.log(`Saldo token ${TOKEN_SYMBOL}:`, uiAmount)
  } catch (error) {
    console.error(`Erro ao carregar saldo ${TOKEN_SYMBOL}:`, error)
    setConnectButtonText(formatTokenBalance(0))
  }
}

app.innerHTML = `
  <div id="sidebarOverlay" class="overlay"></div>
  <div id="walletOverlay" class="overlay"></div>

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

        <button id="connectBtn" class="connect" type="button">
          Conectar Wallet
        </button>
      </header>

      <div id="walletMenu" class="wallet-menu">
        <a href="/claim" id="claimAction">Claim vWALA</a>
        <a href="javascript:void(0)" id="disconnectAction" style="display:none;">Desconectar Wallet</a>
      </div>

      <aside id="sidebar" class="side-menu">
       <a href="/carteira.html">Carteira</a>
        <a href="/futebol">Futebol</a>
<a href="/futuros">Futures</a>
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
              <strong>Futebol e Futuros</strong>
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
            data-href="/futebol"
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
              <strong style="display: none;">futebol.html</strong>
            </div>
          </article>

          <article
            class="feature-card clickable-card"
            data-href="/futuros"
            role="button"
            tabindex="0"
            aria-label="Abrir página Futures"
          >
            <div class="feature-card-top">
              <span class="feature-badge">📈</span>
              <span class="feature-chip">Novo</span>
            </div>

            <h3>Futures</h3>
            <p>
              Área de previsões futuras com acesso dedicado em uma página separada.
            </p>

            <div class="feature-card-footer">
              <span>Abrir</span>
              <strong style="display: none;">futuros.html</strong>
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
          <a class="shortcut-card" href="/futebol">
            <span class="shortcut-icon">⚽</span>
            <strong>Futebol</strong>
            <small>Mercado esportivo</small>
          </a>

          <a class="shortcut-card" href="/futuros">
            <span class="shortcut-icon">📈</span>
            <strong>Futures</strong>
            <small>Previsões futuras</small>
          </a>

          <a class="shortcut-card" href="/carteira.html">
  <span class="shortcut-icon">👛</span>
  <strong>Carteira</strong>
  <small>Saldo e ações internas</small>
</a>

          <a class="shortcut-card shortcut-card-disabled" href="javascript:void(0)" aria-disabled="true" tabindex="-1">
  <span class="shortcut-icon">🧾</span>
  <strong>Posições</strong>
  <small>Histórico do usuário</small>
</a>
        </section>
      </main>
    </div>
  </div>
`

const sidebar = document.getElementById('sidebar')
const walletMenu = document.getElementById('walletMenu')
const sidebarOverlay = document.getElementById('sidebarOverlay')
const walletOverlay = document.getElementById('walletOverlay')
const menuBtn = document.getElementById('menuBtn')
const connectBtn = document.getElementById('connectBtn')
const disconnectAction = document.getElementById('disconnectAction')
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

function openWalletMenu() {
  walletMenu.style.right = '0'
  walletOverlay.classList.add('active')
}

function closeWalletMenu() {
  walletMenu.style.right = '-280px'
  walletOverlay.classList.remove('active')
}

function setConnectedUI() {
  disconnectAction.style.display = 'block'
}

function setDisconnectedUI() {
  disconnectAction.style.display = 'none'
  setConnectButtonText('Conectar Wallet')
}

async function connectWallet() {
  try {
    const provider = getPhantomProvider()

    if (!provider) {
      alert('Phantom não encontrada.')
      return
    }

    setConnectButtonText('Conectando...')

    const resp = await provider.connect()
    connectedAddress = resp.publicKey.toString()
    connectedPublicKey = resp.publicKey
    walletConnected = true

    setConnectedUI()
    await loadWalletTokenBalance()
    closeWalletMenu()
  } catch (error) {
    console.error('Erro ao conectar Phantom:', error)
    walletConnected = false
    connectedAddress = ''
    connectedPublicKey = null
    setDisconnectedUI()
  }
}

async function restoreWalletSession() {
  try {
    const provider = getPhantomProvider()
    if (!provider) return

    const resp = await provider.connect({ onlyIfTrusted: true })
    connectedAddress = resp.publicKey.toString()
    connectedPublicKey = resp.publicKey
    walletConnected = true

    setConnectedUI()
    await loadWalletTokenBalance()
  } catch {
    setDisconnectedUI()
  }
}

async function disconnectWallet() {
  try {
    const provider = getPhantomProvider()
    if (provider?.disconnect) {
      await provider.disconnect()
    }
  } catch (error) {
    console.warn('Aviso ao desconectar Phantom:', error)
  }

  walletConnected = false
  connectedAddress = ''
  connectedPublicKey = null
  setDisconnectedUI()
  closeWalletMenu()
}

menuBtn?.addEventListener('click', openSidebar)
sidebarOverlay?.addEventListener('click', closeSidebar)
walletOverlay?.addEventListener('click', closeWalletMenu)

connectBtn?.addEventListener('click', () => {
  if (walletConnected) {
    openWalletMenu()
    return
  }

  connectWallet()
})

disconnectAction?.addEventListener('click', disconnectWallet)

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

document.querySelectorAll('#walletMenu a').forEach((link) => {
  link.addEventListener('click', () => {
    const href = link.getAttribute('href') || ''
    if (href && href !== 'javascript:void(0)') {
      closeWalletMenu()
    }
  })
})

async function initApp() {
  setDisconnectedUI()
  await restoreWalletSession()
}

initApp()