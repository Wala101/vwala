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

  // Usa Transak direto (não precisa de chave para link simples)
  const url = `https://global.transak.com/?` + new URLSearchParams({
    network: "polygon",
    cryptoCurrency: "POL",
    fiatCurrency: "BRL",
    walletAddress: currentWalletAddress,
    redirectURL: window.location.origin + "/carteira.html",
    language: "pt"
  }).toString()

  window.open(url, '_blank')
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
              • Abre o site do provedor<br>
              • Sua carteira já vem preenchida<br>
              • Você paga com PIX e recebe POL
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

window.abrirDeposito = abrirDeposito