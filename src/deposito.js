import { auth } from './firebase.js'
import { onAuthStateChanged } from 'firebase/auth'

let currentWalletAddress = ''

function getWalletFromUrl() {
  const params = new URLSearchParams(window.location.search)
  return params.get('wallet')
}

// ==================== ABRIR DEPOSITO ONRAMPER ====================
function abrirOnramper() {
  if (!currentWalletAddress) {
    alert("❌ Endereço da carteira não encontrado.")
    return
  }

  const apiKey = import.meta.env.VITE_ONRAMPER_PUBLIC_KEY

  // Monta a URL oficial do Onramper
  const url = `https://buy.onramper.com?apiKey=${apiKey}&walletAddress=${currentWalletAddress}&network=polygon&crypto=POL&fiat=BRL&fiatAmount=100&language=pt`

  // Abre em nova aba (mais confiável)
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
          <p class="deposito-subtitle">Pague com PIX e receba POL na Polygon automaticamente</p>

          <div class="wallet-info-box">
            <strong>Carteira de destino:</strong><br>
            <span id="wallet-display" class="wallet-address"></span>
          </div>

          <button onclick="abrirOnramper()" class="deposito-btn primary">
            💰 Fazer Depósito via PIX
          </button>

          <div class="info-text">
            <small>
              • Valor mínimo: R$ 20,00<br>
              • Confirmação em até 30 minutos<br>
              • Taxa inclusa no valor
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

window.abrirOnramper = abrirOnramper