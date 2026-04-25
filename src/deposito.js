import { auth } from './firebase.js'
import { onAuthStateChanged } from 'firebase/auth'

// ==================== VARIÁVEIS GLOBAIS ====================
let currentWalletAddress = ''

// ==================== PEGAR WALLET DA URL ====================
function getWalletFromUrl() {
  const params = new URLSearchParams(window.location.search)
  return params.get('wallet')
}

// ==================== ABRIR ONRAMPER ====================
async function abrirOnramper() {
  if (!currentWalletAddress) {
    alert("❌ Endereço da carteira não encontrado.")
    return
  }

  const container = document.getElementById('onramper-widget-container')
  container.style.display = 'block'

  try {
    const widget = new Onramper.Widget({
      apiKey: import.meta.env.VITE_ONRAMPER_PUBLIC_KEY,
      walletAddress: currentWalletAddress,
      network: "polygon",
      crypto: "POL",           // ou "USDC" se preferir
      fiat: "BRL",
      fiatAmount: 100,         // valor inicial sugerido
      containerId: "onramper-widget-container",
      theme: "dark",
      language: "pt",
      
      onClose: () => {
        container.style.display = 'none'
      },

      onSuccess: (data) => {
        console.log("✅ Depósito realizado:", data)
        showSuccessMessage()
      }
    })

    widget.open()
  } catch (error) {
    console.error("Erro Onramper:", error)
    alert("Não foi possível carregar o sistema de pagamento. Tente novamente.")
  }
}

function showSuccessMessage() {
  const container = document.getElementById('onramper-widget-container')
  container.innerHTML = `
    <div style="text-align: center; padding: 50px 20px; color: #22ff88;">
      <h2>✅ PIX Recebido com Sucesso!</h2>
      <p>O POL será enviado automaticamente para sua carteira em até 30 minutos.</p>
      <br>
      <button onclick="window.location.href='carteira.html'" 
              style="padding: 14px 32px; font-size: 16px; background: #22ff88; color: #000; border: none; border-radius: 8px; font-weight: bold; cursor: pointer;">
        ← Voltar para Carteira
      </button>
    </div>
  `
}

// ==================== RENDERIZAR PÁGINA ====================
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

          <!-- Container do Widget Onramper -->
          <div id="onramper-widget-container" 
               style="display:none; margin-top:30px; background:#1a1a1a; border-radius:12px; padding:15px; min-height:400px;">
          </div>

          <div class="info-text">
            <small>
              • Valor mínimo: R$ 20,00<br>
              • Confirmação em até 30 minutos<br>
              • Taxa inclusa no valor exibido
            </small>
          </div>

          <button onclick="window.history.back()" class="deposito-btn secondary">
            ← Voltar para Carteira
          </button>
        </section>
      </div>
    </div>
  `

  // Preencher endereço da carteira
  const walletEl = document.getElementById('wallet-display')
  if (walletEl && currentWalletAddress) {
    walletEl.textContent = `${currentWalletAddress.slice(0, 6)}...${currentWalletAddress.slice(-4)}`
  }
}

// ==================== INICIALIZAÇÃO ====================
onAuthStateChanged(auth, (user) => {
  currentWalletAddress = getWalletFromUrl()

  if (!currentWalletAddress) {
    alert("Endereço da carteira não informado.")
    window.location.href = "carteira.html"
    return
  }

  renderDepositoPage()
})

// Expor função para o botão HTML
window.abrirOnramper = abrirOnramper