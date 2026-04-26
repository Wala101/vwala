import { auth } from './firebase.js'
import { onAuthStateChanged } from 'firebase/auth'

let currentWalletAddress = ''

function getWalletFromUrl() {
  const params = new URLSearchParams(window.location.search)
  return params.get('wallet')
}

// ==================== ABRIR CHANGELLY ====================
function abrirChangelly() {
  if (!currentWalletAddress) {
    alert("❌ Endereço da carteira não encontrado.")
    return
  }

  const container = document.getElementById('changelly-container')
  container.style.display = 'block'

  // URL do Changelly para comprar POL (Polygon)
  const changellyUrl = `https://changelly.com/pt/buy/pol?` + new URLSearchParams({
    from: "BRL",
    to: "POL",
    address: currentWalletAddress,      // carteira pré-preenchida
    amount: "100"
  }).toString()

  container.innerHTML = `
    <iframe 
      src="${changellyUrl}"
      style="width:100%; height:680px; border:none; border-radius:12px; background:#1a1a1a;"
      allow="accelerometer; autoplay; camera; gyroscope; payment; microphone"
      title="Changelly - Comprar POL">
    </iframe>
  `
}

// ==================== RENDER PAGE ====================
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
              <span>Depósito PIX</span>
            </div>
          </div>
        </header>

        <section class="deposito-main">
          <h1>Depósito via PIX</h1>
          <p class="deposito-subtitle">Compre POL com Changelly</p>

          <div class="wallet-info-box">
            <strong>Carteira de destino:</strong><br>
            <span id="wallet-display" class="wallet-address"></span>
          </div>

          <button onclick="abrirChangelly()" class="deposito-btn primary">
            💰 Comprar POL com PIX
          </button>

          <div id="changelly-container" style="display:none; margin-top:25px; min-height:700px;"></div>

          <div class="info-text">
            <small>
              • Aceita PIX, cartão e transferência<br>
              • Carteira já preenchida automaticamente<br>
              • Tudo dentro da página
            </small>
          </div>

          <button onclick="window.history.back()" class="deposito-btn secondary">
            ← Voltar para Carteira
          </button>
        </section>
      </div>
    </div>
  `

  const walletEl = document.getElementById('wallet-display')
  if (walletEl && currentWalletAddress) {
    walletEl.textContent = `${currentWalletAddress.slice(0,6)}...${currentWalletAddress.slice(-4)}`
  }
}

// ==================== INIT ====================
onAuthStateChanged(auth, () => {
  currentWalletAddress = getWalletFromUrl()

  if (!currentWalletAddress) {
    alert("Endereço da carteira não informado.")
    window.location.href = "carteira.html"
    return
  }

  renderDepositoPage()
})

window.abrirChangelly = abrirChangelly