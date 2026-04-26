import { auth } from './firebase.js'
import { onAuthStateChanged } from 'firebase/auth'

let currentWalletAddress = ''
let addressCopied = false

function getWalletFromUrl() {
  const params = new URLSearchParams(window.location.search)
  return params.get('wallet')
}

// ==================== COPIAR ENDEREÇO ====================
async function copiarEndereco() {
  if (!currentWalletAddress) return

  try {
    await navigator.clipboard.writeText(currentWalletAddress)
    addressCopied = true

    document.getElementById('btn-copiar').innerHTML = '✅ Copiado!'
    document.getElementById('btn-comprar').disabled = false

    showMessageModal('Endereço Copiado!', 'Agora você pode abrir o Changelly.', 'Continuar')
  } catch (err) {
    alert('Erro ao copiar endereço. Tente novamente.')
  }
}

// ==================== ABRIR CHANGELLY ====================
function abrirChangelly() {
  if (!addressCopied) {
    showCustomModal()   // Modal personalizado
    return
  }

  const url = `https://changelly.com/buy-crypto?from=BRL&to=POL&amount=25&address=${currentWalletAddress}&currency=POL&fiatCurrency=BRL`
  window.open(url, '_blank')
}

// ==================== MODAL PERSONALIZADO ====================
function showCustomModal() {
  const modalHTML = `
    <div id="customModal" style="position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.85); z-index:9999; display:flex; align-items:center; justify-content:center;">
      <div style="background:#1a1a1a; border-radius:16px; width:90%; max-width:380px; padding:24px; text-align:center; border:1px solid #333;">
        <h2 style="margin:0 0 16px; color:#fff;">⚠️ Atenção</h2>
        <p style="color:#ccc; line-height:1.5; margin-bottom:24px;">
          Antes de abrir o Changelly, você precisa copiar sua carteira.
        </p>
        <button onclick="copiarEnderecoFromModal()" 
                style="width:100%; padding:14px; background:#25ff8a; color:#000; border:none; border-radius:12px; font-weight:700; margin-bottom:12px;">
          📋 Copiar Endereço Agora
        </button>
        <button onclick="closeCustomModal()" 
                style="width:100%; padding:14px; background:transparent; border:1px solid #555; color:#fff; border-radius:12px;">
          Cancelar
        </button>
      </div>
    </div>
  `

  document.body.insertAdjacentHTML('beforeend', modalHTML)
}

window.copiarEnderecoFromModal = () => {
  copiarEndereco()
  closeCustomModal()
}

window.closeCustomModal = () => {
  const modal = document.getElementById('customModal')
  if (modal) modal.remove()
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
            💰 Abrir Changelly
          </button>

          <div class="info-text">
            <small>
              1. Copie sua carteira<br>
              2. Abra o Changelly<br>
              3. Cole o endereço se necessário
            </small>
          </div>

          <button onclick="window.history.back()" class="deposito-btn secondary">
            ← Voltar
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

window.copiarEndereco = copiarEndereco
window.abrirChangelly = abrirChangelly