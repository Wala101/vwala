import { auth } from './firebase.js'
import { onAuthStateChanged, setPersistence, browserLocalPersistence } from 'firebase/auth'

let currentWalletAddress = ''

function getWalletFromUrl() {
  const params = new URLSearchParams(window.location.search)
  return params.get('wallet')
}

// ==================== ABRIR MOONPAY SAQUE ====================
function abrirMoonpaySaque() {
  if (!currentWalletAddress) {
    showMessageModal('Erro', 'Carteira não encontrada.')
    return
  }

  const url = `https://sell.moonpay.com/v2/sell?apiKey=pk_live_PrcGnaQchlCHiQknBR8HrkNw6tD3J1Q&baseCurrencyCode=pol_polygon&quoteCurrencyCode=brl&paymentMethod=pix_instant_payment&refundWalletAddress=${currentWalletAddress}&showWalletAddressForm=false&lockAmount=true`

  window.open(url, '_blank', 'noopener,noreferrer')
}

// ==================== RENDER PAGE ====================
function renderSaquePage() {
  const app = document.querySelector('#app')

  app.innerHTML = `
    <div class="deposito-page">
      <div class="wallet-shell">
        <header class="wallet-topbar">
          <div class="wallet-brand">
            <div class="wallet-brand-badge">W</div>
            <div class="wallet-brand-text">
              <strong>vWALA</strong>
              <span>Saque via PIX</span>
            </div>
          </div>
        </header>

        <section class="deposito-main">
          <h1>Saque via PIX</h1>
          <p class="deposito-subtitle">Venda POL e receba em Reais</p>

<div class="info-text" style="margin-bottom: 24px; font-weight: 700;">
            
              • Valor mínimo: R$ 98,00 (aprox.)<br>
              • KYC necessário uma única vez<br>
              • Recebimento via PIX<br>
              • Taxas do MoonPay aplicadas
            
          </div>


          <button onclick="abrirMoonpaySaque()" class="deposito-btn primary">
             Sacar via PIX
          </button>

         

        </section>
      </div>
    </div>
  `
}

// ==================== INIT ====================
async function initSaque() {
  try {
    await setPersistence(auth, browserLocalPersistence)
  } catch (e) {
    console.warn("Erro ao definir persistência", e)
  }

  onAuthStateChanged(auth, (user) => {
    currentWalletAddress = getWalletFromUrl()

    if (!currentWalletAddress) {
      showMessageModal('Atenção', 'Endereço da carteira não informado.')
      setTimeout(() => window.location.href = 'carteira.html', 1500)
      return
    }

    renderSaquePage()
  })
}

initSaque()

window.abrirMoonpaySaque = abrirMoonpaySaque