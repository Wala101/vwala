import { auth } from './firebase.js'
import { onAuthStateChanged } from 'firebase/auth'

let currentWalletAddress = ''
let addressCopied = false

function getWalletFromUrl() {
  const params = new URLSearchParams(window.location.search)
  return params.get('wallet')
}

async function copiarEndereco() {
  if (!currentWalletAddress) return

  try {
    await navigator.clipboard.writeText(currentWalletAddress)
    addressCopied = true

    const btnCopiar = document.getElementById('btn-copiar')
    const btnComprar = document.getElementById('btn-comprar')

    if (btnCopiar) {
      btnCopiar.innerHTML = '✅ Endereço Copiado!'
    }

    if (btnComprar) {
      btnComprar.disabled = false
      btnComprar.classList.remove('disabled')
    }

    await showMessageModal(
      '✅ Endereço Copiado',
      'Agora você pode abrir o Changelly e concluir sua compra via PIX.',
      'Continuar'
    )
  } catch (err) {
    await showMessageModal(
      'Erro',
      'Não foi possível copiar o endereço. Tente novamente.'
    )
  }
}

async function showCopyWalletRequiredModal() {
  if (typeof showMessageModal !== 'function') {
    const confirmed = window.confirm(
      'Antes de abrir o Changelly, copie primeiro o endereço da sua carteira.'
    )

    if (confirmed) {
      await copiarEndereco()
    }
    return false
  }

  const confirmed = await showMessageModal(
    'Atenção',
    'Antes de abrir o Changelly, você precisa copiar o endereço da sua carteira.',
    '📋 Copiar Endereço',
    true
  )

  if (confirmed) {
    await copiarEndereco()
    return true
  }

  return false
}

async function abrirChangelly() {
  if (!addressCopied) {
    const liberado = await showCopyWalletRequiredModal()
    if (!liberado && !addressCopied) return
  }

  const url = `https://changelly.com/buy-crypto?from=BRL&to=POL&amount=25&address=${currentWalletAddress}&currency=POL&fiatCurrency=BRL`
  window.open(url, '_blank', 'noopener,noreferrer')
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
              <span>Depósito PIX</span>
            </div>
          </div>
        </header>

        <section class="deposito-main">
          <h1>Depósito via PIX</h1>
          <p class="deposito-subtitle">Compre POL com Changelly</p>


 <div class="info-text">
            <small>
              1. Copie sua carteira<br>
              2. O acesso ao Changelly será liberado<br>
              3. Pague com PIX
            </small>
          </div>



          <div class="wallet-info-box" style="display: none;">
            <strong>Sua carteira Polygon:</strong><br>
            <span id="wallet-display" class="wallet-address"></span>
          </div>

          <button onclick="copiarEndereco()" class="deposito-btn secondary" id="btn-copiar">
             Copiar Endereço da Carteira
          </button>

          <button onclick="abrirChangelly()" class="deposito-btn primary disabled" id="btn-comprar" disabled>
             Abrir Changelly
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

onAuthStateChanged(auth, () => {
  currentWalletAddress = getWalletFromUrl()

  if (!currentWalletAddress) {
    showMessageModal('Atenção', 'Endereço da carteira não informado.')
    setTimeout(() => {
      window.location.href = 'carteira.html'
    }, 1500)
    return
  }

  renderDepositoPage()
})

window.copiarEndereco = copiarEndereco
window.abrirChangelly = abrirChangelly
