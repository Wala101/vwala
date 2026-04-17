import { BrowserProvider, formatEther } from 'ethers'

const app = document.querySelector('#app')

if (!app) {
  throw new Error('Elemento #app não encontrado.')
}

const POLYGON_CHAIN_ID_HEX = '0x89'
const POLYGON_CHAIN_ID_DEC = 137

let walletConnected = false
let connectedAddress = ''
let currentProvider = null
let currentSigner = null

function getEthereumProvider() {
  if (typeof window !== 'undefined' && window.ethereum) {
    return window.ethereum
  }
  return null
}

function shortAddress(address = '') {
  if (!address) return 'Conectar Wallet'
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function formatPolBalance(value = '0') {
  const num = Number(value || 0)
  if (!Number.isFinite(num)) return '0 POL'

  return `${num.toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  })} POL`
}

function setConnectButtonText(text) {
  const button = document.getElementById('connectBtn')
  if (button) button.textContent = text
}

function setWalletAddressText(text) {
  const el = document.getElementById('walletAddress')
  if (el) el.textContent = text
}

function setWalletNetworkText(text) {
  const el = document.getElementById('walletNetwork')
  if (el) el.textContent = text
}

function setWalletBalanceText(text) {
  const el = document.getElementById('walletBalance')
  if (el) el.textContent = text
}

function setWalletStatusText(text) {
  const el = document.getElementById('walletStatus')
  if (el) el.textContent = text
}

function setConnectedUI() {
  walletConnected = true
  const disconnectAction = document.getElementById('disconnectAction')
  if (disconnectAction) disconnectAction.style.display = 'block'
}

function setDisconnectedUI() {
  walletConnected = false
  connectedAddress = ''
  currentProvider = null
  currentSigner = null

  const disconnectAction = document.getElementById('disconnectAction')
  if (disconnectAction) disconnectAction.style.display = 'none'

  setConnectButtonText('Conectar Wallet')
  setWalletAddressText('Não conectada')
  setWalletNetworkText('Polygon Mainnet')
  setWalletBalanceText('0 POL')
  setWalletStatusText('Aguardando conexão')
}

async function ensurePolygonMainnet() {
  const ethereum = getEthereumProvider()

  if (!ethereum) {
    alert('Nenhuma wallet EVM encontrada no navegador.')
    return false
  }

  const currentChainId = await ethereum.request({ method: 'eth_chainId' })

  if (currentChainId === POLYGON_CHAIN_ID_HEX) {
    return true
  }

  try {
    await ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: POLYGON_CHAIN_ID_HEX }],
    })

    return true
  } catch (error) {
    console.error('Erro ao trocar para Polygon Mainnet:', error)
    alert('Troque sua wallet para Polygon Mainnet antes de continuar.')
    return false
  }
}

async function loadWalletData() {
  if (!currentProvider || !connectedAddress) return

  const balanceWei = await currentProvider.getBalance(connectedAddress)
  const balancePol = formatEther(balanceWei)

  setWalletAddressText(connectedAddress)
  setWalletBalanceText(formatPolBalance(balancePol))
  setWalletNetworkText('Polygon Mainnet')
  setWalletStatusText('Wallet conectada')
  setConnectButtonText(shortAddress(connectedAddress))
}

async function connectWallet() {
  try {
    const ethereum = getEthereumProvider()

    if (!ethereum) {
      alert('MetaMask ou outra wallet EVM não encontrada.')
      return
    }

    setConnectButtonText('Conectando...')

    const ok = await ensurePolygonMainnet()
    if (!ok) {
      setDisconnectedUI()
      return
    }

    currentProvider = new BrowserProvider(ethereum)
    await currentProvider.send('eth_requestAccounts', [])
    currentSigner = await currentProvider.getSigner()
    connectedAddress = await currentSigner.getAddress()

    setConnectedUI()
    await loadWalletData()
    closeWalletMenu()
  } catch (error) {
    console.error('Erro ao conectar wallet:', error)
    alert('Não foi possível conectar a wallet.')
    setDisconnectedUI()
  }
}

async function restoreWalletSession() {
  try {
    const ethereum = getEthereumProvider()
    if (!ethereum) {
      setDisconnectedUI()
      return
    }

    const accounts = await ethereum.request({ method: 'eth_accounts' })
    if (!accounts || !accounts.length) {
      setDisconnectedUI()
      return
    }

    const ok = await ensurePolygonMainnet()
    if (!ok) {
      setDisconnectedUI()
      return
    }

    currentProvider = new BrowserProvider(ethereum)
    currentSigner = await currentProvider.getSigner()
    connectedAddress = accounts[0]

    setConnectedUI()
    await loadWalletData()
  } catch (error) {
    console.warn('Sessão não restaurada:', error)
    setDisconnectedUI()
  }
}

function disconnectWallet() {
  setDisconnectedUI()
  closeWalletMenu()
}

function goTo(path) {
  if (!path) return
  window.location.href = path
}

function openSidebar() {
  const sidebar = document.getElementById('sidebar')
  const overlay = document.getElementById('sidebarOverlay')
  if (sidebar) sidebar.style.right = '0'
  if (overlay) overlay.classList.add('active')
}

function closeSidebar() {
  const sidebar = document.getElementById('sidebar')
  const overlay = document.getElementById('sidebarOverlay')
  if (sidebar) sidebar.style.right = '-280px'
  if (overlay) overlay.classList.remove('active')
}

function openWalletMenu() {
  const menu = document.getElementById('walletMenu')
  const overlay = document.getElementById('walletOverlay')
  if (menu) menu.style.right = '0'
  if (overlay) overlay.classList.add('active')
}

function closeWalletMenu() {
  const menu = document.getElementById('walletMenu')
  const overlay = document.getElementById('walletOverlay')
  if (menu) menu.style.right = '-280px'
  if (overlay) overlay.classList.remove('active')
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
            <strong>vWALA</strong>
            <span>Carteira</span>
          </div>
        </div>

        <button id="connectBtn" class="connect" type="button">
          Conectar Wallet
        </button>
      </header>

      <div id="walletMenu" class="wallet-menu">
        <a href="/carteira.html">Minha Carteira</a>
        <a href="javascript:void(0)" id="disconnectAction" style="display:none;">Desconectar Wallet</a>
      </div>

      <aside id="sidebar" class="side-menu">
        <a href="/index.html">Início</a>
        <a href="/carteira.html">Carteira</a>
        <a href="javascript:void(0)">Comprar vWALA</a>
        <a href="javascript:void(0)">Swap interno</a>
        <a href="javascript:void(0)">Stake</a>
      </aside>

      <main class="app-content">
        <section class="hero-card">
          <div class="hero-copy">
            <p class="eyebrow">VWALA · POLYGON MAINNET</p>
            <h1>Carteira do ecossistema</h1>
            <p class="hero-text">
              Base da carteira conectada à Polygon Mainnet, preparada para fluxo interno
              de compra, swap e stake sem pool pública no lançamento.
            </p>
          </div>

          <div class="hero-stats">
            <div class="stat-box">
              <span>Modelo</span>
              <strong>Interno</strong>
            </div>

            <div class="stat-box">
              <span>Preço base</span>
              <strong>1 POL = 1 vWALA</strong>
            </div>

            <div class="stat-box">
              <span>Rede</span>
              <strong>Polygon</strong>
            </div>
          </div>
        </section>

        <section class="section-head">
          <div>
            <p class="section-kicker">WALLET</p>
            <h2>Resumo da carteira</h2>
          </div>
        </section>

        <section class="cards-list">
          <article class="feature-card">
            <div class="feature-card-top">
              <span class="feature-badge">👛</span>
              <span class="feature-chip">Conta</span>
            </div>
            <h3>Endereço</h3>
            <p id="walletAddress">Não conectada</p>
            <div class="feature-card-footer">
              <span>Status</span>
              <strong id="walletStatus">Aguardando conexão</strong>
            </div>
          </article>

          <article class="feature-card">
            <div class="feature-card-top">
              <span class="feature-badge">⛓️</span>
              <span class="feature-chip">Rede</span>
            </div>
            <h3>Network</h3>
            <p id="walletNetwork">Polygon Mainnet</p>
            <div class="feature-card-footer">
              <span>Chain</span>
              <strong>${POLYGON_CHAIN_ID_DEC}</strong>
            </div>
          </article>

          <article class="feature-card">
            <div class="feature-card-top">
              <span class="feature-badge">🪙</span>
              <span class="feature-chip">Saldo</span>
            </div>
            <h3>POL disponível</h3>
            <p id="walletBalance">0 POL</p>
            <div class="feature-card-footer">
              <span>Uso</span>
              <strong>Gas + compra interna</strong>
            </div>
          </article>
        </section>

        <section class="section-head">
          <div>
            <p class="section-kicker">AÇÕES</p>
            <h2>Módulos internos</h2>
          </div>
        </section>

        <section class="shortcut-grid">
          <a class="shortcut-card shortcut-card-disabled" href="javascript:void(0)">
            <span class="shortcut-icon">💱</span>
            <strong>Comprar vWALA</strong>
            <small>Entrará via contrato interno</small>
          </a>

          <a class="shortcut-card shortcut-card-disabled" href="javascript:void(0)">
            <span class="shortcut-icon">🔁</span>
            <strong>Swap interno</strong>
            <small>Sem pool pública no início</small>
          </a>

          <a class="shortcut-card shortcut-card-disabled" href="javascript:void(0)">
            <span class="shortcut-icon">🔒</span>
            <strong>Stake</strong>
            <small>Integrado à liquidez interna</small>
          </a>

          <a class="shortcut-card" href="/index.html">
            <span class="shortcut-icon">🏠</span>
            <strong>Voltar</strong>
            <small>Página inicial</small>
          </a>
        </section>
      </main>
    </div>
  </div>
`

const menuBtn = document.getElementById('menuBtn')
const connectBtn = document.getElementById('connectBtn')
const disconnectAction = document.getElementById('disconnectAction')
const sidebarOverlay = document.getElementById('sidebarOverlay')
const walletOverlay = document.getElementById('walletOverlay')

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

document.querySelectorAll('#sidebar a').forEach((link) => {
  link.addEventListener('click', () => closeSidebar())
})

document.querySelectorAll('#walletMenu a').forEach((link) => {
  link.addEventListener('click', () => {
    const href = link.getAttribute('href') || ''
    if (href && href !== 'javascript:void(0)') {
      closeWalletMenu()
    }
  })
})

const ethereum = getEthereumProvider()

if (ethereum) {
  ethereum.on?.('accountsChanged', async (accounts) => {
    if (!accounts.length) {
      setDisconnectedUI()
      return
    }

    connectedAddress = accounts[0]
    await loadWalletData()
  })

  ethereum.on?.('chainChanged', () => {
    window.location.reload()
  })
}

async function initApp() {
  setDisconnectedUI()
  await restoreWalletSession()
}

initApp()