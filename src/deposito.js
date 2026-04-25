import { auth } from './firebase.js'
import { onAuthStateChanged } from 'firebase/auth'

let currentWalletAddress = ''

function getWalletFromUrl() {
  const params = new URLSearchParams(window.location.search)
  return params.get('wallet')
}

function abrirOnramper() {
  if (!currentWalletAddress) {
    alert('❌ Endereço da carteira não encontrado.')
    return
  }

  const container = document.getElementById('onramper-widget-container')
  if (!container) return

  container.style.display = 'block'

  const apiKey = import.meta.env.VITE_ONRAMPER_PUBLIC_KEY

  if (!apiKey) {
    container.innerHTML = `
      <div class="deposit-alert error">
        <h3>Configuração incompleta</h3>
        <p>Chave pública do Onramper não encontrada.</p>
      </div>
    `
    return
  }

  const onramperUrl = new URL('https://buy.onramper.com')
  onramperUrl.searchParams.set('apiKey', apiKey)
  onramperUrl.searchParams.set('walletAddress', currentWalletAddress)
  onramperUrl.searchParams.set('defaultAddrs', JSON.stringify({ POL: currentWalletAddress }))
  onramperUrl.searchParams.set('network', 'polygon')
  onramperUrl.searchParams.set('crypto', 'POL')
  onramperUrl.searchParams.set('fiat', 'BRL')
  onramperUrl.searchParams.set('fiatAmount', '100')
  onramperUrl.searchParams.set('language', 'pt')
  onramperUrl.searchParams.set('mode', 'buy')

  container.innerHTML = `
    <div class="onramper-frame-wrapper">
      <iframe
        src="${onramperUrl.toString()}"
        class="onramper-frame"
        allow="accelerometer; autoplay; camera; gyroscope; payment; microphone"
        title="Comprar POL via PIX">
      </iframe>
    </div>
  `
}

function renderDepositoPage() {
  const app = document.querySelector('#app')

  app.innerHTML = `
    <div class="deposito-page">
      <div class="wallet-shell">
        <header class="wallet-topbar">
          <div class="wallet-brand">
            <div class="wallet-brand-badge">W</div>
            <div class="wallet-brand-text">
              <strong>vWALA</strong>
              <span>Depósito via PIX</span>
            </div>
          </div>
        </header>

        <main class="deposito-main">
          <h1>Adicionar saldo</h1>
          <p class="deposito-subtitle">Compre POL com PIX e receba direto na sua carteira</p>

          <div class="wallet-info-box">
            <span>Carteira de destino</span>
            <strong id="wallet-display" class="wallet-address"></strong>
          </div>

          <button id="deposit-btn" class="deposito-btn primary">
            💳 Comprar com PIX
          </button>

          <div id="onramper-widget-container" class="onramper-container"></div>

          <div class="info-text">
            <small>
              • Compra processada por parceiro externo<br>
              • Pagamento via PIX em reais (BRL)<br>
              • Recebimento automático na sua carteira Polygon
            </small>
          </div>

          <button id="back-btn" class="deposito-btn secondary">
            ← Voltar para Carteira
          </button>
        </main>
      </div>
    </div>
  `

  const walletEl = document.getElementById('wallet-display')
  if (walletEl) {
    walletEl.textContent = `${currentWalletAddress.slice(0, 6)}...${currentWalletAddress.slice(-4)}`
  }

  document.getElementById('deposit-btn')?.addEventListener('click', abrirOnramper)
  document.getElementById('back-btn')?.addEventListener('click', () => {
    window.location.href = `carteira.html?wallet=${currentWalletAddress}`
  })
}

onAuthStateChanged(auth, () => {
  currentWalletAddress = getWalletFromUrl()

  if (!currentWalletAddress) {
    alert('Endereço da carteira não informado.')
    window.location.href = 'carteira.html'
    return
  }

  renderDepositoPage()
})

window.abrirOnramper = abrirOnramper
