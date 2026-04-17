const app = document.querySelector('#app')

if (!app) {
  throw new Error('Elemento #app não encontrado.')
}

const walletState = {
  polBalance: '12.85',
  vwalaBalance: '0.00',
  userTokens: []
}

function formatAmount(value = '0', symbol = '') {
  const num = Number(value || 0)

  if (!Number.isFinite(num)) {
    return `0 ${symbol}`.trim()
  }

  return `${num.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6
  })} ${symbol}`.trim()
}

function handleWalletAction(action) {
  if (action === 'enviar') {
    alert('A função Enviar será ligada à carteira interna.')
    return
  }

  if (action === 'receber') {
    alert('A função Receber mostrará o endereço interno da carteira.')
    return
  }

  if (action === 'swap') {
    alert('O swap interno 1 POL = 1 vWALA será ligado ao sistema.')
  }
}

function renderUserTokens() {
  if (!walletState.userTokens.length) {
    return `
      <div class="wallet-empty">
        Nenhum token criado pelo usuário ainda.
      </div>
    `
  }

  return walletState.userTokens
    .map((token) => {
      return `
        <div class="wallet-token-card">
          <div class="wallet-token-left">
            <div class="wallet-token-icon user">T</div>
            <div class="wallet-token-info">
              <div class="wallet-token-name">${token.name}</div>
              <div class="wallet-token-symbol">${token.symbol}</div>
            </div>
          </div>

          <div class="wallet-token-balance">
            <strong>${formatAmount(token.balance, token.symbol)}</strong>
            <small>Token do usuário</small>
          </div>
        </div>
      `
    })
    .join('')
}

app.innerHTML = `
  <div class="wallet-page">
    <div class="wallet-shell">
      <header class="wallet-topbar">
        <div class="wallet-brand">
          <div class="wallet-brand-badge">W</div>
          <div class="wallet-brand-text">
            <strong>vWALA</strong>
            <span>Carteira</span>
          </div>
        </div>

        <div class="wallet-vwala-chip">
          ${formatAmount(walletState.vwalaBalance, 'vWALA')}
        </div>
      </header>

      <section class="wallet-main-card">
        <div class="wallet-balance-label">Saldo em Polygon</div>
        <div class="wallet-balance-value">
          ${Number(walletState.polBalance).toLocaleString('pt-BR', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 6
          })}
          <span class="wallet-balance-symbol">POL</span>
        </div>
        <div class="wallet-network">Polygon Mainnet</div>
      </section>

      <section class="wallet-actions">
        <button class="wallet-action" data-action="enviar" type="button">
          <span class="wallet-action-icon">📤</span>
          <span class="wallet-action-label">Enviar</span>
        </button>

        <button class="wallet-action" data-action="receber" type="button">
          <span class="wallet-action-icon">📥</span>
          <span class="wallet-action-label">Receber</span>
        </button>

        <button class="wallet-action" data-action="swap" type="button">
          <span class="wallet-action-icon">🔁</span>
          <span class="wallet-action-label">Swap</span>
        </button>
      </section>

      <section class="wallet-tabs">
        <button class="wallet-tab active" type="button">Tokens</button>
        <button class="wallet-tab" type="button">Autores</button>
        <button class="wallet-tab" type="button">Colecionáveis</button>
      </section>

      <section class="wallet-token-list">
        <div class="wallet-token-card">
          <div class="wallet-token-left">
            <div class="wallet-token-icon pol">P</div>
            <div class="wallet-token-info">
              <div class="wallet-token-name">Polygon</div>
              <div class="wallet-token-symbol">POL</div>
            </div>
          </div>

          <div class="wallet-token-balance">
            <strong>${formatAmount(walletState.polBalance, 'POL')}</strong>
            <small>Saldo principal</small>
          </div>
        </div>

        <div class="wallet-token-card">
          <div class="wallet-token-left">
            <div class="wallet-token-icon vwala">V</div>
            <div class="wallet-token-info">
              <div class="wallet-token-name">vWALA</div>
              <div class="wallet-token-symbol">vWALA</div>
            </div>
          </div>

          <div class="wallet-token-balance">
            <strong>${formatAmount(walletState.vwalaBalance, 'vWALA')}</strong>
            <small>Token da plataforma</small>
          </div>
        </div>

        ${renderUserTokens()}
      </section>
    </div>
  </div>
`

document.querySelectorAll('.wallet-action').forEach((button) => {
  const action = button.getAttribute('data-action')

  button.addEventListener('click', () => {
    handleWalletAction(action)
  })
})