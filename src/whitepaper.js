const app = document.querySelector('#app')

if (!app) {
  throw new Error('Elemento #app não encontrado.')
}

app.innerHTML = `
  <div class="site-noise"></div>
  <div class="site-glow glow-left"></div>
  <div class="site-glow glow-right"></div>

  <div class="page-wrap">
    <header class="topbar shell-card">
      <div class="brand-box">
        <div class="brand-mark">W</div>
        <div class="brand-text">
          <span class="brand-title">WALA V2</span>
          <span class="brand-subtitle">Whitepaper • Infraestrutura, mercado de previsões e expansão de ecossistema</span>
        </div>
      </div>

      <nav class="top-links">
        <a href="https://t.me/WalaTokenOfficial" target="_blank" rel="noopener noreferrer">Telegram</a>
        <a href="https://x.com/WalaTokenSwap" target="_blank" rel="noopener noreferrer">X</a>
      </nav>
    </header>

    <section class="hero-grid">
      <article class="hero-copy shell-card shell-depth">
        <span class="tag">WALA V2 • Documento Estratégico</span>
        <h1>Um ecossistema que conecta criação de token, liquidez, mercado de previsões e uma futura blockchain própria.</h1>
        <p class="hero-text">
          A primeira etapa da WALA V2 já foi concluída: o usuário pode criar seu token, adicionar e remover liquidez,
          e obter exibição de mercado tanto dentro da WALA quanto em grandes explorers, como o Dexscreener.
          Agora o projeto entra na fase de expansão do app WALA Predictions como mercado de previsões,
          seguido por uma evolução estrutural futura para uma blockchain própria.
        </p>

        <div class="hero-actions">
          <a class="btn btn-primary" href="#roadmap">Ver roadmap</a>
          <a class="btn btn-secondary" href="#tokenomics">Tokenomics</a>
        </div>

        <div class="hero-stat-row">
          <div class="mini-stat">
            <span>Fase 1</span>
            <strong>Concluída</strong>
          </div>
          <div class="mini-stat">
            <span>Fase 2</span>
            <strong>Em andamento</strong>
          </div>
          <div class="mini-stat">
            <span>Acesso utilitário</span>
            <strong>Holders WALA V2</strong>
          </div>
        </div>
      </article>

      <aside class="hero-panel shell-card shell-depth">
        <div class="panel-head">
          <span class="panel-label">Ecossistema ativo</span>
          <span class="status-pill">Live Build</span>
        </div>

        <div class="terminal-card">
          <div class="terminal-dots">
            <span></span><span></span><span></span>
          </div>
          <div class="terminal-lines">
            <div><span class="line-key">token.launch</span><span class="line-value success">ready</span></div>
            <div><span class="line-key">liquidity.add_remove</span><span class="line-value success">ready</span></div>
            <div><span class="line-key">market.visibility</span><span class="line-value success">ready</span></div>
            <div><span class="line-key">prediction.market</span><span class="line-value warn">building</span></div>
            <div><span class="line-key">wala.chain</span><span class="line-value mute">planned</span></div>
          </div>
        </div>

        <div class="chart-card">
          <div class="chart-head">
            <strong>Avanço do plano</strong>
            <span>Roadmap visual</span>
          </div>
          <svg viewBox="0 0 420 220" class="line-chart" aria-label="Gráfico de avanço do roadmap">
            <defs>
              <linearGradient id="gridFade" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stop-color="rgba(255,255,255,0.12)" />
                <stop offset="100%" stop-color="rgba(255,255,255,0.02)" />
              </linearGradient>
              <linearGradient id="lineFill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stop-color="#25ff8a" stop-opacity="0.35" />
                <stop offset="100%" stop-color="#25ff8a" stop-opacity="0.02" />
              </linearGradient>
              <linearGradient id="lineStroke" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0%" stop-color="#5cffb4" />
                <stop offset="100%" stop-color="#25ff8a" />
              </linearGradient>
            </defs>
            <g class="grid-lines">
              <line x1="30" y1="30" x2="390" y2="30"></line>
              <line x1="30" y1="75" x2="390" y2="75"></line>
              <line x1="30" y1="120" x2="390" y2="120"></line>
              <line x1="30" y1="165" x2="390" y2="165"></line>
              <line x1="30" y1="200" x2="390" y2="200"></line>
            </g>
            <path class="area-fill" d="M30 185 C75 180, 105 162, 145 154 C190 145, 220 120, 255 110 C295 96, 330 55, 390 35 L390 200 L30 200 Z"></path>
            <path class="progress-line" d="M30 185 C75 180, 105 162, 145 154 C190 145, 220 120, 255 110 C295 96, 330 55, 390 35"></path>
            <g class="chart-points">
              <circle cx="30" cy="185" r="5"></circle>
              <circle cx="145" cy="154" r="5"></circle>
              <circle cx="255" cy="110" r="6"></circle>
              <circle cx="390" cy="35" r="7"></circle>
            </g>
            <g class="chart-labels">
              <text x="28" y="214">Start</text>
              <text x="118" y="214">Fase 1</text>
              <text x="228" y="214">Fase 2</text>
              <text x="352" y="214">Fase 3</text>
            </g>
          </svg>
        </div>
      </aside>
    </section>

    <section class="metrics-grid">
      <article class="metric-card shell-card shell-depth">
        <span>Infraestrutura</span>
        <strong>Token + Liquidez</strong>
        <p>Criação de ativos, remoção e adição de liquidez já operacionais dentro do ecossistema.</p>
      </article>

      <article class="metric-card shell-card shell-depth">
        <span>Mercado</span>
        <strong>WALA + Explorers</strong>
        <p>Os ativos já podem ser exibidos no site e em grandes painéis de mercado externos.</p>
      </article>

      <article class="metric-card shell-card shell-depth">
        <span>Próxima camada</span>
        <strong>Mercado de previsões</strong>
        <p>Expansão do app WALA Predictions como produto utilitário do ecossistema, com integração ao token.</p>
      </article>
    </section>

    <section class="two-col-grid">
      <article class="shell-card shell-depth section-card">
        <div class="section-title">
          <span class="tag">Tese</span>
          <h2>O que a WALA V2 está construindo</h2>
        </div>
        <p class="section-text">
          A visão da WALA V2 é unir infraestrutura de mercado com utilidade real de produto. Em vez de ser apenas um token,
          o projeto quer transformar o ativo em uma peça funcional de um ecossistema maior. A primeira camada entrega base técnica.
          A segunda expande o app WALA Predictions como mercado de previsões dentro do ecossistema. A terceira abre caminho para autonomia total,
          por meio de uma blockchain própria.
        </p>

        <div class="feature-stack">
          <div class="feature-box">
            <strong>Camada 1</strong>
            <span>Emissão e liquidez</span>
          </div>
          <div class="feature-box">
            <strong>Camada 2</strong>
            <span>Mercado de previsões</span>
          </div>
          <div class="feature-box">
            <strong>Camada 3</strong>
            <span>Blockchain WALA</span>
          </div>
        </div>
      </article>

      <article class="shell-card shell-depth section-card flow-card">
        <div class="section-title">
          <span class="tag">Fluxo utilitário</span>
          <h2>Como o holder entra no ciclo de valor</h2>
        </div>

        <div class="flow-steps">
          <div class="flow-step">
            <div class="flow-number">01</div>
            <div>
              <strong>Compra ou obtém WALA V2</strong>
              <p>Entrada no ecossistema e alinhamento com a utilidade central do projeto.</p>
            </div>
          </div>
          <div class="flow-step">
            <div class="flow-number">02</div>
            <div>
              <strong>Usa o app WALA Predictions</strong>
              <p>O holder participa do mercado de previsões dentro do ecossistema WALA.</p>
            </div>
          </div>
          <div class="flow-step">
            <div class="flow-number">03</div>
            <div>
              <strong>Interage com os mercados</strong>
              <p>Abre posições em mercados de previsão e participa da dinâmica de liquidez e volume do app.</p>
            </div>
          </div>
          <div class="flow-step">
            <div class="flow-number">04</div>
            <div>
              <strong>Expansão futura</strong>
              <p>Novas funções poderão ser integradas quando a infraestrutura própria evoluir.</p>
            </div>
          </div>
        </div>
      </article>
    </section>

    <section id="roadmap" class="shell-card shell-depth section-card roadmap-block">
      <div class="section-title">
        <span class="tag">Roadmap</span>
        <h2>As 3 fases do projeto</h2>
      </div>

      <div class="roadmap-grid">
        <article class="phase-card done">
          <div class="phase-top">
            <span class="phase-pill done-pill">Concluída</span>
            <strong>Fase 1</strong>
          </div>
          <h3>Infraestrutura de token e mercado</h3>
          <p>
            Entrega concluída. A WALA V2 já permite criar tokens, adicionar e remover liquidez,
            e exibir mercado dentro do ecossistema WALA e em grandes explorers como Dexscreener.
          </p>
          <ul>
            <li>Criação de token</li>
            <li>Liquidez adicionada e removida</li>
            <li>Exposição pública de mercado</li>
          </ul>
        </article>

        <article class="phase-card active">
          <div class="phase-top">
            <span class="phase-pill active-pill">Em andamento</span>
            <strong>Fase 2</strong>
          </div>
          <h3>Mercado de previsões WALA Predictions</h3>
          <p>
            Desenvolvimento e expansão do WALA Predictions como mercado de previsões integrado ao ecossistema,
            com foco em participação dos usuários, volume, liquidez interna e crescimento utilitário do app.
          </p>
          <ul>
            <li>Mercados de previsão integrados ao ecossistema</li>
            <li>Participação via posições em eventos</li>
            <li>Expansão de utilidade para holders WALA V2</li>
          </ul>
        </article>

        <article class="phase-card planned">
          <div class="phase-top">
            <span class="phase-pill planned-pill">Planejada</span>
            <strong>Fase 3</strong>
          </div>
          <h3>Blockchain própria</h3>
          <p>
            Etapa estratégica para ampliar autonomia, performance e integração entre produtos,
            preparando uma infraestrutura própria para sustentar novas aplicações do ecossistema.
          </p>
          <ul>
            <li>Base de soberania técnica</li>
            <li>Integração nativa de produtos</li>
            <li>Expansão de utilidade</li>
          </ul>
        </article>
      </div>
    </section>

    <section class="two-col-grid arbitrage-grid">
      <article class="shell-card shell-depth section-card">
        <div class="section-title">
          <span class="tag">Predictions</span>
          <h2>Mercado de previsões como motor de utilidade</h2>
        </div>
        <p class="section-text">
          A segunda fase da WALA V2 introduz uma camada prática de produto. O app WALA Predictions amplia a utilidade do ecossistema
          ao permitir participação em mercados de previsão, gerando volume, atividade e circulação dentro da própria estrutura WALA.
          A ideia central é simples: transformar o token em peça funcional de um produto vivo.
        </p>

        <div class="market-compare">
          <div class="compare-col">
            <span class="compare-label">Usuário</span>
            <strong>Abre posição</strong>
            <small>Participa do mercado</small>
          </div>
          <div class="compare-middle">
            <span class="arb-badge">WALA</span>
            <div class="arb-line"></div>
          </div>
          <div class="compare-col">
            <span class="compare-label">Ecossistema</span>
            <strong>Gera atividade</strong>
            <small>Volume e utilidade</small>
          </div>
        </div>
      </article>

      <article class="shell-card shell-depth section-card access-card">
        <div class="section-title">
          <span class="tag">Acesso</span>
          <h2>Integração com o ecossistema</h2>
        </div>

        <div class="access-ring-wrap">
          <svg viewBox="0 0 220 220" class="access-ring" aria-label="Anel de acesso dos holders">
            <circle class="ring-base" cx="110" cy="110" r="82"></circle>
            <circle class="ring-progress" cx="110" cy="110" r="82"></circle>
          </svg>
          <div class="access-ring-center">
            <strong>WALA</strong>
            <span>Utility Loop</span>
          </div>
        </div>

        <div class="access-notes">
          <div class="access-note">
            <strong>Requisito</strong>
            <p>Integração entre token, liquidez e produto.</p>
          </div>
          <div class="access-note">
            <strong>Benefício</strong>
            <p>Fortalecimento do ecossistema e expansão futura de módulos e utilidades.</p>
          </div>
        </div>
      </article>
    </section>

    <section id="tokenomics" class="shell-card shell-depth section-card tokenomics-block">
      <div class="section-title">
        <span class="tag">Tokenomics</span>
        <h2>Distribuição de supply</h2>
      </div>

      <div class="tokenomics-grid">
        <div class="donut-side">
          <div class="donut-box">
            <svg viewBox="0 0 260 260" class="donut-chart" aria-label="Gráfico de distribuição do supply WALA V2">
              <circle class="donut-track" cx="130" cy="130" r="88"></circle>
              <circle class="slice slice-market" cx="130" cy="130" r="88"></circle>
              <circle class="slice slice-ecosystem" cx="130" cy="130" r="88"></circle>
              <circle class="slice slice-dev" cx="130" cy="130" r="88"></circle>
              <circle class="slice slice-reserve" cx="130" cy="130" r="88"></circle>
            </svg>
            <div class="donut-center">
              <strong>WALA V2</strong>
              <span>Supply Model</span>
            </div>
          </div>
        </div>

        <div class="legend-side">
          <div class="legend-card market">
            <span class="legend-dot"></span>
            <div>
              <strong>20% para mercado</strong>
              <p>Alocação destinada à presença de mercado, circulação e exposição do token.</p>
            </div>
          </div>
          <div class="legend-card ecosystem">
            <span class="legend-dot"></span>
            <div>
              <strong>40% para a pool do mercado</strong>
              <p>Liquidez destinada ao app WALA Predictions, fortalecendo a base operacional do produto.</p>
            </div>
          </div>
          <div class="legend-card dev">
            <span class="legend-dot"></span>
            <div>
              <strong>35% para desenvolvimento do ecossistema</strong>
              <p>Produto, integrações, infraestrutura, expansão técnica e crescimento do ecossistema WALA.</p>
            </div>
          </div>
          <div class="legend-card reserve">
            <span class="legend-dot"></span>
            <div>
              <strong>5% para reserva estratégica</strong>
              <p>Camada de segurança para suporte operacional, contingência e gestão estratégica.</p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="two-col-grid vesting-grid">
      <article class="shell-card shell-depth section-card">
        <div class="section-title">
          <span class="tag">Vesting</span>
          <h2>Cronograma de despejo e liberação</h2>
        </div>
        <p class="section-text">
          A proposta abaixo busca reduzir pressão de venda desorganizada, alinhar liberação com entregas do projeto
          e preservar confiança do mercado. O foco é previsibilidade.
        </p>

        <div class="vesting-table-wrap">
          <table class="vesting-table">
            <thead>
              <tr>
                <th>Faixa</th>
                <th>Percentual</th>
                <th>Modelo</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Mercado</td>
                <td>20%</td>
                <td>Alocação para presença e circulação de mercado</td>
              </tr>
              <tr>
                <td>Pool WALA Predictions</td>
                <td>40%</td>
                <td>Liquidez estrutural do app e suporte operacional</td>
              </tr>
              <tr>
                <td>Ecossistema</td>
                <td>35%</td>
                <td>Desenvolvimento, integrações e expansão técnica</td>
              </tr>
              <tr>
                <td>Reserva</td>
                <td>5%</td>
                <td>Uso estratégico e contingencial</td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>

      <article class="shell-card shell-depth section-card release-graph-card">
        <div class="section-title">
          <span class="tag">Gráfico real</span>
          <h2>Liberação prevista ao longo do tempo</h2>
        </div>

        <svg viewBox="0 0 460 300" class="bar-chart" aria-label="Gráfico de barras do cronograma de liberação">
          <g class="bar-grid">
            <line x1="50" y1="40" x2="430" y2="40"></line>
            <line x1="50" y1="90" x2="430" y2="90"></line>
            <line x1="50" y1="140" x2="430" y2="140"></line>
            <line x1="50" y1="190" x2="430" y2="190"></line>
            <line x1="50" y1="240" x2="430" y2="240"></line>
          </g>
          <g class="bar-group">
            <rect x="85" y="192" width="52" height="48" rx="14"></rect>
            <rect x="180" y="144" width="52" height="96" rx="14"></rect>
            <rect x="275" y="156" width="52" height="84" rx="14"></rect>
            <rect x="370" y="228" width="52" height="12" rx="14"></rect>
          </g>
          <g class="bar-values">
            <text x="111" y="184">20%</text>
            <text x="206" y="136">40%</text>
            <text x="301" y="148">35%</text>
            <text x="396" y="220">5%</text>
          </g>
          <g class="bar-labels">
            <text x="84" y="270">Mercado</text>
            <text x="182" y="270">Pool</text>
            <text x="266" y="270">Ecossistema</text>
            <text x="360" y="270">Reserva</text>
          </g>
        </svg>

        <div class="release-notes">
          <div class="release-note"><span></span><p>A pool do WALA Predictions recebe a maior alocação para sustentar a liquidez do app.</p></div>
          <div class="release-note"><span></span><p>Mercado, ecossistema e reserva seguem papéis complementares na estrutura do projeto.</p></div>
        </div>
      </article>
    </section>

    <section class="shell-card shell-depth section-card final-block">
      <div class="section-title">
        <span class="tag">Direção final</span>
        <h2>Conclusão estratégica</h2>
      </div>
      <p class="section-text">
        A WALA V2 não quer depender apenas de narrativa. A proposta mais forte do projeto é ligar token, mercado,
        liquidez e produto a uma mesma estrutura de valor. Primeiro foi construída a base transacional. Agora entra a fase
        de expansão do WALA Predictions como mercado de previsões. Depois, a ambição cresce para uma blockchain própria.
        Na minha opinião, essa leitura é a correta: projeto que sobrevive é projeto que transforma token em ferramenta real.
      </p>
    </section>
  </div>
`