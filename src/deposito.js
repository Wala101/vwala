import { auth } from './firebase.js'
import { onAuthStateChanged } from 'firebase/auth'

let currentWalletAddress = ''
let copied = false

function getWalletFromUrl() {
  const params = new URLSearchParams(window.location.search)
  return params.get('wallet')
}

// Copiar endereço
async function copiarEndereco() {
  if (!currentWalletAddress) return

  try {
    await navigator.clipboard.writeText(currentWalletAddress)
    copied = true

    const btn = document.getElementById('btn-comprar')
    if (btn) {
      btn.disabled = false
      btn.textContent = "✅ Endereço Copiado! Abrir Changelly"
    }

    alert("✅ Endereço copiado com sucesso!\n\nAgora clique no botão abaixo para abrir o Changelly.")
  } catch (err) {
    alert("Erro ao copiar. Tente novamente.")
  }
}

// Abrir Changelly
function abrirChangelly() {
  if (!copied) {
    alert("Por favor, copie o endereço da carteira primeiro.")
    return
  }

  const url = `https://changelly.com/buy-crypto?from=BRL&to=POL&amount=25&currency=POL&fiatCurrency=BRL`

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
          <p class="deposito-subtitle">Compre POL com Changelly</p>

          <div class="wallet-info-box">
            <strong>Sua carteira Polygon:</strong><br>
            <span id="wallet-display" class="wallet-address"></span>
          </div>

          <button onclick="copiarEndereco()" class="deposito-btn secondary" id="btn-copiar">
            📋 Copiar Endereço da Carteira
          </button>

          <button onclick="abrirChangelly()" class="deposito-btn primary" id="btn-comprar" disabled>
            💰 Abrir Changelly para Depositar
          </button>

          <div class="info-text">
            <small>
              <strong>Como fazer o depósito:</strong><br><br>
              1. Clique em "Copiar Endereço da Carteira"<br>
              2. Clique no botão verde "Abrir Changelly"<br>
              3. No Changelly, cole o endereço se necessário<br>
              4. Escolha PIX como método de pagamento<br><br>
              Valor mínimo: R$ 25,00
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
    walletEl.textContent = currentWalletAddress
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

window.copiarEndereco = copiarEndereco
window.abrirChangelly = abrirChangelly