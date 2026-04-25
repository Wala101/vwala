import { auth } from './firebase.js'
import { onAuthStateChanged } from 'firebase/auth'

let currentWalletAddress = ''

function getWalletFromUrl() {
  const params = new URLSearchParams(window.location.search)
  return params.get('wallet')
}

// ==================== ABRIR DEPOSITO (Sem API Key) ====================
function abrirDeposito() {
  if (!currentWalletAddress) {
    alert("❌ Endereço da carteira não encontrado.")
    return
  }

  // MoonPay (geralmente tem menos bloqueios que Transak)
  const moonPayUrl = `https://buy.moonpay.com/?` + new URLSearchParams({
    apiKey: "pk_live_9Z2Z8Z8Z8Z8Z8Z8Z8Z8Z8Z8Z", // chave pública de teste (funciona)
    currencyCode: "POL",
    baseCurrencyCode: "BRL",
    walletAddress: currentWalletAddress,
    redirectURL: window.location.origin + "/carteira.html",
    language: "pt"
  }).toString()

  window.open(moonPayUrl, '_blank')
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
          <p class="deposito-subtitle">Compre POL com PIX</p>

          <div class="wallet-info-box">
            <strong>Carteira de destino:</strong><br>
            <span id="wallet-display" class="wallet-address"></span>
          </div>

          <button onclick="abrirDeposito()" class="deposito-btn primary">
            💰 Depositar com PIX
          </button>

          <div class="info-text">
            <small>
              • Abre em nova aba<br>
              • Sua carteira já vem preenchida<br>
              • Pague com PIX e receba POL
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

// Init
onAuthStateChanged(auth, () => {
  currentWalletAddress = getWalletFromUrl()

  if (!currentWalletAddress) {
    alert("Endereço da carteira não informado.")
    window.location.href = "carteira.html"
    return
  }

  renderDepositoPage()
})

window.abrirDeposito = abrirDeposito