import './index.css'

const app = document.querySelector('#app')

if (!app) {
  throw new Error('Elemento #app não encontrado.')
}

app.innerHTML = `
  <div class="page-shell">
    <div class="app-frame">
      <header class="topbar">
        <div class="brand-wrap brand-wrap-left">
          <div class="brand-badge">W</div>
          <div class="brand-text">
            <strong>vWALA</strong>
            <span>Polygon Prediction Platform</span>
          </div>
        </div>

        <button id="connectBtn" class="connect" type="button">
          Wallet Polygon em breve
        </button>
      </header>

      <main class="app-content">
        <section class="hero-card">
          <div class="hero-copy">
            <p class="eyebrow">VWALA · POLYGON</p>
            <h1>Plataforma de previsões com economia própria em Polygon.</h1>
            <p class="hero-text">
              O novo ecossistema vWALA está sendo construído do zero com foco em
              previsões, swap interno, stake integrado e treasury operacional.
            </p>
          </div>

          <div class="hero-stats">
            <div class="stat-box">
              <span>Token base</span>
              <strong>vWALA</strong>
            </div>

            <div class="stat-box">
              <span>Rede</span>
              <strong>Polygon</strong>
            </div>

            <div class="stat-box">
              <span>Preço inicial</span>
              <strong>1 POL = 1 vWALA</strong>
            </div>
          </div>
        </section>

        <section class="section-head">
          <div>
            <p class="section-kicker">ESTRUTURA</p>
            <h2>Base do novo projeto</h2>
          </div>
        </section>

        <section class="cards-list">
          <article class="feature-card">
            <div class="feature-card-top">
              <span class="feature-badge">🔁</span>
              <span class="feature-chip">Swap interno</span>
            </div>

            <h3>Compra direta no site</h3>
            <p>
              O usuário poderá adquirir vWALA diretamente pela plataforma, sem depender
              de pool pública no lançamento inicial.
            </p>

            <div class="feature-card-footer">
              <span>Status</span>
              <strong>Planejado</strong>
            </div>
          </article>

          <article class="feature-card">
            <div class="feature-card-top">
              <span class="feature-badge">🏦</span>
              <span class="feature-chip">Treasury</span>
            </div>

            <h3>Reserva estratégica</h3>
            <p>
              A treasury operacional sustentará a base do sistema, a cobertura interna
              e o reaproveitamento econômico do ecossistema.
            </p>

            <div class="feature-card-footer">
              <span>Status</span>
              <strong>Definido</strong>
            </div>
          </article>

          <article class="feature-card">
            <div class="feature-card-top">
              <span class="feature-badge">📈</span>
              <span class="feature-chip">Stake</span>
            </div>

            <h3>Liquidez via stake</h3>
            <p>
              O stake fará parte da arquitetura de liquidez em Polygon, fortalecendo
              a operação e a estabilidade inicial da plataforma.
            </p>

            <div class="feature-card-footer">
              <span>Status</span>
              <strong>Em desenho</strong>
            </div>
          </article>

          <article class="feature-card">
            <div class="feature-card-top">
              <span class="feature-badge">🛡️</span>
              <span class="feature-chip">Bootstrap</span>
            </div>

            <h3>Sem controle posterior</h3>
            <p>
              O admin existirá apenas para inicialização. Depois disso, a lógica principal
              não terá poder de pausa, saque manual ou alteração arbitrária.
            </p>

            <div class="feature-card-footer">
              <span>Status</span>
              <strong>Definido</strong>
            </div>
          </article>
        </section>

        <section class="section-head">
          <div>
            <p class="section-kicker">PRÓXIMOS MÓDULOS</p>
            <h2>O que entra depois</h2>
          </div>
        </section>

        <section class="shortcut-grid">
          <div class="shortcut-card shortcut-card-disabled">
            <span class="shortcut-icon">👛</span>
            <strong>Wallet</strong>
            <small>Integração com carteira Polygon/EVM</small>
          </div>

          <div class="shortcut-card shortcut-card-disabled">
            <span class="shortcut-icon">🎯</span>
            <strong>Predictions</strong>
            <small>Mercados de previsão do ecossistema</small>
          </div>

          <div class="shortcut-card shortcut-card-disabled">
            <span class="shortcut-icon">🔒</span>
            <strong>Stake</strong>
            <small>Entrada integrada à liquidez</small>
          </div>

          <div class="shortcut-card shortcut-card-disabled">
            <span class="shortcut-icon">💱</span>
            <strong>Swap</strong>
            <small>Compra interna de vWALA</small>
          </div>
        </section>
      </main>
    </div>
  </div>
`

const connectBtn = document.getElementById('connectBtn')

connectBtn?.addEventListener('click', () => {
  alert('A integração com wallet Polygon/EVM será adicionada na próxima etapa.')
})