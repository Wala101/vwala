const app = document.querySelector('#app')

if (!app) {
  throw new Error('Elemento #app não encontrado.')
}

const walletState = {
  polBalance: '0.000000',
  vwalaBalance: '0.000000',
  userTokens: [],
}

function formatAmount(value = '0.000000', symbol = '') {
  const num = Number(value || 0)

  if (!Number.isFinite(num)) {
    return `0 ${symbol}`.trim()
  }

  return `${num.toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  })} ${symbol}`.trim()
}

function goTo(path) {
  if (!path) return
  window.location.href = path
}

function openSidebar() {
  const sidebar = document.getElementById('sidebar')
  const sidebarOverlay = document.getElementById('sidebarOverlay')
  if (sidebar) sidebar.style.right = '0'
  if (sidebarOverlay) sidebarOverlay.classList.add('active')
}

function closeSidebar() {
  const sidebar = document.getElementById('sidebar')
  const sidebarOverlay = document.getElementById('sidebarOverlay')
  if (sidebar) sidebar.style.right = '-280px'
  if (sidebarOverlay) sidebarOverlay.classList.remove('active')
}

function openWalletMenu() {
  const walletMenu = document.getElementById('walletMenu')
  const walletOverlay = document.getElementById('walletOverlay')
  if (walletMenu) walletMenu.style.right = '0'
  if (walletOverlay) walletOverlay.classList.add('active')
}

function closeWalletMenu() {
  const walletMenu = document.getElementById('walletMenu')
  const walletOverlay = document.getElementById('walletOverlay')
  if (walletMenu) walletMenu.style.right = '-280px'
  if (walletOverlay) walletOverlay.classList.remove('active')
}

function renderUserTokens() {
  const container = document.getElementById('userTokensList')
  if (!container) return

  if (!walletState.userTokens.length) {
    container.innerHTML = `
      <article class="feature-card">
        <div class="feature-card-top">
          <span class="feature-badge">🧾</span>
          <span class="feature-chip">Vazio</span>
        </div>

        <h3>Nenhum token criado ainda</h3>
        <p>
          Quando o usuário criar tokens dentro da plataforma, eles aparecerão aqui
          abaixo do POL e do vWALA.
        </p>

        <div class="feature-card-footer">
          <span>Status</span>
          <strong>Aguardando criação</strong>
        </div>
      </article>
    `
    return
  }

  container.innerHTML = walletState.userTokens
    .map((token) => {
      return `
        <article class="feature-card">
          <div class="feature-card-top">
            <span class="feature-badge">🪙</span>
            <span class="feature-chip">Token do usuário</span>
          </div>

          <h3>${token.name}</h3>
          <p>${formatAmount(token.balance, token.symbol)}</p>

          <div class="feature-card-footer">
            <span>Símbolo</span>
            <strong>${token.symbol}</strong>
          </div>
        </article>
      `
    })
    .join('')
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
            <span>Carteira interna</span>
          </div>
        </div>

        <button id="connectBtn" class="connect" type="button">
          Carteira do app
        </button>
      </header>

      <div id="walletMenu" class="wallet-menu">
        <a href="./carteira.html">Minha Carteira</a>
        <a href="javascript:void(0)">Comprar vWALA</a>
        <a href="javascript:void(0)">Swap interno</a>
      </div>

      <aside id="sidebar" class="side-menu">
        <a href="./index.html">Início</a>
        <a href="./carteira.html">Carteira</a>
        <a href="javascript:void(0)">Futebol</a>
        <a href="javascript:void(0)">Futures</a>
        <a href="javascript:void(0)">Posições</a>
      </aside>

      <main class="app-content">
        <section class="hero-card">
          <div class="hero-copy">
            <p class="eyebrow">VWALA · WALLET INTERNA</p>
            <h1>Carteira própria do ecossistema</h1>
            <p class="hero-text">
              Estrutura interna da plataforma, com POL no topo, vWALA abaixo e,
              depois, os tokens criados pelo usuário dentro do app.
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
            <p class="section-kicker">SALDOS PRINCIPAIS</p>
            <h2>Ordem da carteira</h2>
          </div>
        </section>

        <section class="cards-list">
          <article class="feature-card">
            <div class="feature-card-top">
              <span class="feature-badge">⛽</span>
              <span class="feature-chip">Topo</span>
            </div>

            <h3>POL</h3>
            <p>${formatAmount(walletState.polBalance, 'POL')}</p>

            <div class="feature-card-footer">
              <span>Função</span>
              <strong>Saldo base</strong>
            </div>
          </article>

          <article class="feature-card">
            <div class="feature-card-top">
              <span class="feature-badge">🟢</span>
              <span class="feature-chip">Token do app</span>
            </div>

            <h3>vWALA</h3>
            <p>${formatAmount(walletState.vwalaBalance, 'vWALA')}</p>

            <div class="feature-card-footer">
              <span>Status</span>
              <strong>Em criação</strong>
            </div>
          </article>
        </section>

        <section class="section-head">
          <div>
            <p class="section-kicker">TOKENS DO USUÁRIO</p>
            <h2>Criados dentro da plataforma</h2>
          </div>
        </section>

        <section id="userTokensList" class="cards-list"></section>

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
            <small>Fluxo interno do sistema</small>
          </a>

          <a class="shortcut-card shortcut-card-disabled" href="javascript:void(0)">
            <span class="shortcut-icon">🔁</span>
            <strong>Swap interno</strong>
            <small>Sem pool pública no início</small>
          </a>

          <a class="shortcut-card shortcut-card-disabled" href="javascript:void(0)">
            <span class="shortcut-icon">🪙</span>
            <strong>Criar token</strong>
            <small>Token próprio do usuário</small>
          </a>

          <a class="shortcut-card" href="./index.html">
            <span class="shortcut-icon">🏠</span>
            <strong>Voltar</strong>
            <small>Página inicial</small>
          </a>
        </section>
      </main>
    </div>
  </div>
`

renderUserTokens()

const menuBtn = document.getElementById('menuBtn')
const connectBtn = document.getElementById('connectBtn')
const sidebarOverlay = document.getElementById('sidebarOverlay')
const walletOverlay = document.getElementById('walletOverlay')

menuBtn?.addEventListener('click', openSidebar)
sidebarOverlay?.addEventListener('click', closeSidebar)
walletOverlay?.addEventListener('click', closeWalletMenu)

connectBtn?.addEventListener('click', () => {
  openWalletMenu()
})

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