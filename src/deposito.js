import { auth } from './firebase.js'
import { onAuthStateChanged } from 'firebase/auth'

let currentWalletAddress = ''

function getWalletFromUrl() {
  const params = new URLSearchParams(window.location.search)
  return params.get('wallet')
}

// ==================== ABRIR ONRAMPER (Iframe) ====================
function abrirOnramper() {
  if (!currentWalletAddress) {
    alert("❌ Endereço da carteira não encontrado.")
    return
  }

  const container = document.getElementById('onramper-widget-container')
  container.style.display = 'block'

  const apiKey = import.meta.env.VITE_ONRAMPER_PUBLIC_KEY

  const onramperUrl = `https://buy.onramper.com?apiKey=${apiKey}&walletAddress=${currentWalletAddress}&network=polygon&crypto=POL&fiat=BRL&fiatAmount=100&language=pt&mode=buy`

  container.innerHTML = `
    <iframe 
      src="${onramperUrl}"
      style="width:100%; height:620px; border:none; border-radius:12px;"
      allow="accelerometer; autoplay; camera; gyroscope; payment; microphone"
      title="Onramper Deposit">
    </iframe>
  `
}

function showSuccessMessage() {
  const container = document.getElementById('onramper-widget-container')
  container.innerHTML = `
    <div style="text-align:center; padding:60px 20px; color:#22ff88;">
      <h2>✅ Depósito em Processamento!</h2>
      <p>O PIX foi detectado. O POL chegará em sua carteira em breve.</p>
      <br>
      <button onclick="window.location.href='carteira.html'" 
              style="padding:14px 32px; background:#22ff88; color:#000; border:none; border-radius:8px; font-weight:bold;">
        ← Voltar para Carteira
      </button>
    </div>
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
          <p class="deposito-subtitle">Pague com PIX • Receba POL automaticamente</p>

          <div class="wallet-info-box">
            <strong>Carteira de destino:</strong><br>
            <span id="wallet-display" class="wallet-address"></span>
          </div>

          <button onclick="abrirOnramper()" class="deposito-btn primary">
            💰 Fazer Depósito via PIX
          </button>

          <div id="onramper-widget-container" style="display:none; margin-top:25px;"></div>

          <div class="info-text">
            <small>
              • Valor mínimo: R$ 20,00<br>
              • Confirmação em até 30 minutos<br>
              • Tudo acontece dentro desta página
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