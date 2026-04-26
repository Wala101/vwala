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

    document.getElementById('btn-copiar').innerHTML = '✅ Endereço Copiado!'
    document.getElementById('btn-comprar').disabled = false

    await showMessageModal(
      '✅ Copiado com Sucesso!',
      'Agora você pode abrir o Changelly para fazer o depósito.',
      'Continuar'
    )
  } catch (err) {
    await showMessageModal(
      'Erro',
      'Não foi possível copiar o endereço. Tente novamente.'
    )
  }
}

// ==================== MODAL PADRÃO DO SITE ====================
function showCopyWalletRequiredModal() {
  openUiModal({
    title: 'Atenção',
    text: 'Antes de abrir o Changelly, você precisa copiar o endereço da sua carteira.',
    confirmText: '📋 Copiar Endereço',
    cancelText: 'Cancelar',
    showCancel: true
  }).then(async (result) => {
    if (result) {
      await copiarEndereco()
    }
  })
}

// ==================== ABRIR CHANGELLY ====================
function abrirChangelly() {
  if (!addressCopied) {
    showCopyWalletRequiredModal()
    return
  }

  const url = `https://changelly.com/buy-crypto?from=BRL&to=POL&amount=25&address=${currentWalletAddress}&currency=POL&fiatCurrency=BRL`
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
            💰 Abrir Changelly
          </button>

          <div class="info-text">
            <small>
              1. Copie sua carteira<br>
              2. Clique em Abrir Changelly<br>
              3. Pague com PIX
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
    walletEl.textContent = `${currentWalletAddress.slice(0, 6)}...${currentWalletAddress.slice(-4)}`
  }
}

// ==================== INIT ====================
onAuthStateChanged(auth, () => {
  currentWalletAddress = getWalletFromUrl()

  if (!currentWalletAddress) {
    showMessageModal('Atenção', 'Endereço da carteira não informado.')
    window.location.href = 'carteira.html'
    return
  }

  renderDepositoPage()
})

window.copiarEndereco = copiarEndereco
window.abrirChangelly = abrirChangelly