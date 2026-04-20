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
          <span class="brand-title">vWala</span>
          <span class="brand-subtitle">Whitepaper • Token, tesouraria, mercados de previsões, Polygon e blockchain própria</span>
        </div>
      </div>

      <nav class="top-links">
        <a href="https://t.me/WalaTokenOfficial" target="_blank" rel="noopener noreferrer">Telegram</a>
        <a href="https://x.com/WalaTokenSwap" target="_blank" rel="noopener noreferrer">X</a>
      </nav>
    </header>

    <section class="hero-grid">
      <article class="hero-copy shell-card shell-depth">
        <span class="tag">vWala • Documento Estratégico</span>
        <h1>Um ecossistema funcional com token próprio, tesouraria onchain, mercados de previsões em esporte e cripto, integração com Polygon e infraestrutura própria.</h1>
        <p class="hero-text">
          O projeto vWala já opera com criação de token, base de integração com Polygon, mercados de previsões para esporte e cripto,
          além de uma arquitetura própria pensada para sustentar liquidez, utilidade e expansão do ecossistema. A proposta do projeto
          não é depender apenas de narrativa: o foco é construir produto real, fluxo real e uso real do token dentro da plataforma.
        </p>

        <div class="hero-actions">
          <a class="btn btn-primary" href="#roadmap">Ver roadmap</a>
          <a class="btn btn-secondary" href="#tokenomics">Tokenomics</a>
        </div>

        <div class="hero-stat-row">
          <div class="mini-stat">
            <span>Token</span>
            <strong>vWala</strong>
          </div>
          <div class="mini-stat">
            <span>Supply</span>
            <strong>70 milhões</strong>
          </div>
          <div class="mini-stat">
            <span>Base</span>
            <strong>Polygon + Infra própria</strong>
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
            <div><span class="line-key">token.creation</span><span class="line-value success">ready</span></div>
            <div><span class="line-key">polygon.integration</span><span class="line-value success">ready</span></div>
            <div><span class="line-key">sports.predictions</span><span class="line-value success">ready</span></div>
            <div><span class="line-key">crypto.predictions</span><span class="line-value success">ready</span></div>
            <div><span class="line-key">own.infrastructure</span><span class="line-value success">ready</span></div>
          </div>
        </div>

        <div class="chart-card">
          <div class="chart-head">
            <strong>Avanço do projeto</strong>
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
            <path class="area-fill" d="M30 185 C75 178, 105 152, 145 128 C190 104, 220 84, 255 62 C295 48, 330 40, 390 32 L390 200 L30 200 Z"></path>
            <path class="progress-line" d="M30 185 C75 178, 105 152, 145 128 C190 104, 220 84, 255 62 C295 48, 330 40, 390 32"></path>
            <g class="chart-points">
              <circle cx="30" cy="185" r="5"></circle>
              <circle cx="145" cy="128" r="5"></circle>
              <circle cx="255" cy="62" r="6"></circle>
              <circle cx="390" cy="32" r="7"></circle>
            </g>
            <g class="chart-labels">
              <text x="28" y="214">Start</text>
              <text x="118" y="214">Base</text>
              <text x="228" y="214">Produto</text>
              <text x="352" y="214">Escala</text>
            </g>
          </svg>
        </div>
      </aside>
    </section>

    <section class="metrics-grid">
      <article class="metric-card shell-card shell-depth">
        <span>Token</span>
        <strong>vWala • 70M</strong>
        <p>Supply total de 70 milhões de tokens com foco em utilidade, tesouraria e sustentação do ecossistema.</p>
      </article>

      <article class="metric-card shell-card shell-depth">
        <span>Mercados</span>
        <strong>Esporte + Cripto</strong>
        <p>O projeto já contempla mercados de previsões para eventos esportivos e previsões binárias em cripto.</p>
      </article>

      <article class="metric-card shell-card shell-depth">
        <span>Infraestrutura</span>
        <strong>Polygon + Própria</strong>
        <p>Integração com Polygon para operação atual e evolução com infraestrutura própria já assumida no projeto.</p>
      </article>
    </section>

    <section class="two-col-grid">
      <article class="shell-card shell-depth section-card">
        <div class="section-title">
          <span class="tag">Tese</span>
          <h2>O que o vWala está construindo</h2>
        </div>
        <p class="section-text">
          O vWala está construindo um ecossistema em que token, tesouraria, mercado e produto operam juntos. A base atual já inclui
          criação de token, presença em Polygon, interface própria, lógica de tesouraria e mercados de previsões para esporte e cripto.
          A visão é consolidar um sistema onde o token tenha função dentro de uma estrutura viva, com uso contínuo e expansão técnica.
        </p>

        <div class="feature-stack">
          <div class="feature-box">
            <strong>Camada 1</strong>
            <span>Token e tesouraria</span>
          </div>
          <div class="feature-box">
            <strong>Camada 2</strong>
            <span>Predições esporte e cripto</span>
          </div>
          <div class="feature-box">
            <strong>Camada 3</strong>
            <span>Escala de infraestrutura própria</span>
          </div>
        </div>
      </article>

      <article class="shell-card shell-depth section-card flow-card">
        <div class="section-title">
          <span class="tag">Fluxo utilitário</span>
          <h2>Como o usuário entra no ciclo de valor</h2>
        </div>

        <div class="flow-steps">
          <div class="flow-step">
            <div class="flow-number">01</div>
            <div>
              <strong>Adquire ou recebe vWala</strong>
              <p>Entrada no ecossistema e alinhamento com a camada utilitária do projeto.</p>
            </div>
          </div>
          <div class="flow-step">
            <div class="flow-number">02</div>
            <div>
              <strong>Usa os produtos do ecossistema</strong>
              <p>Interação com criação de token, mercados e estrutura interna da plataforma.</p>
            </div>
          </div>
          <div class="flow-step">
            <div class="flow-number">03</div>
            <div>
              <strong>Participa dos mercados</strong>
              <p>Abre posições em previsões de esporte e cripto, gerando uso, volume e atividade real.</p>
            </div>
          </div>
          <div class="flow-step">
            <div class="flow-number">04</div>
            <div>
              <strong>Fortalece a tesouraria e o ecossistema</strong>
              <p>O ciclo de uso do token retroalimenta a estrutura do projeto e sua capacidade de expansão.</p>
            </div>
          </div>
        </div>
      </article>
    </section>

    <section id="roadmap" class="shell-card shell-depth section-card roadmap-block">
      <div class="section-title">
        <span class="tag">Roadmap</span>
        <h2>Fases do projeto atual</h2>
      </div>

      <div class="roadmap-grid">
        <article class="phase-card done">
          <div class="phase-top">
            <span class="phase-pill done-pill">Concluída</span>
            <strong>Fase 1</strong>
          </div>
          <h3>Base do ecossistema</h3>
          <p>
            O projeto já possui token próprio, integração com Polygon, criação de token dentro da plataforma
            e estrutura funcional inicial para operar o ecossistema.
          </p>
          <ul>
            <li>Token vWala definido</li>
            <li>Integração com Polygon ativa</li>
            <li>Criação de token no site</li>
          </ul>
        </article>

        <article class="phase-card done">
          <div class="phase-top">
            <span class="phase-pill done-pill">Concluída</span>
            <strong>Fase 2</strong>
          </div>
          <h3>Mercados de previsões operacionais</h3>
          <p>
            O ecossistema já contempla mercados de previsões para esporte e cripto, formando a camada principal de uso prático
            do projeto e reforçando a utilidade do token dentro da plataforma.
          </p>
          <ul>
            <li>Predições esportivas</li>
            <li>Predições em cripto</li>
            <li>Produto funcional dentro do app</li>
          </ul>
        </article>

        <article class="phase-card active">
          <div class="phase-top">
            <span class="phase-pill active-pill">Em expansão</span>
            <strong>Fase 3</strong>
          </div>
          <h3>Escala de tesouraria e infraestrutura</h3>
          <p>
            A próxima etapa é fortalecer a tesouraria do projeto, ampliar liquidez, melhorar a estrutura de execução onchain
            e consolidar ainda mais a infraestrutura própria do ecossistema.
          </p>
          <ul>
            <li>Fortalecimento da tesouraria</li>
            <li>Escala operacional</li>
            <li>Expansão da infraestrutura própria</li>
          </ul>
        </article>
      </div>
    </section>

    <section class="two-col-grid arbitrage-grid">
      <article class="shell-card shell-depth section-card">
        <div class="section-title">
          <span class="tag">Mercados</span>
          <h2>Predições como motor de utilidade real</h2>
        </div>
        <p class="section-text">
          No vWala, os mercados de previsões não são um módulo decorativo. Eles são parte central da utilidade do token.
          A existência de mercados em esporte e cripto cria atividade recorrente, retenção de usuários e um fluxo claro
          para uso do ecossistema. Essa é a base que diferencia projeto com produto real de projeto apenas narrativo.
        </p>

        <div class="market-compare">
          <div class="compare-col">
            <span class="compare-label">Usuário</span>
            <strong>Usa o token</strong>
            <small>Entra em mercados reais</small>
          </div>
          <div class="compare-middle">
            <span class="arb-badge">vWala</span>
            <div class="arb-line"></div>
          </div>
          <div class="compare-col">
            <span class="compare-label">Ecossistema</span>
            <strong>Gera volume</strong>
            <small>Uso, atividade e recorrência</small>
          </div>
        </div>
      </article>

      <article class="shell-card shell-depth section-card access-card">
        <div class="section-title">
          <span class="tag">Tesouraria</span>
          <h2>Base financeira do projeto</h2>
        </div>

        <div class="access-ring-wrap">
          <svg viewBox="0 0 220 220" class="access-ring" aria-label="Anel de acesso dos holders">
            <circle class="ring-base" cx="110" cy="110" r="82"></circle>
            <circle class="ring-progress" cx="110" cy="110" r="82"></circle>
          </svg>
          <div class="access-ring-center">
            <strong>70%</strong>
            <span>Tesouraria</span>
          </div>
        </div>

        <div class="access-notes">
          <div class="access-note">
            <strong>Principal reserva</strong>
            <p>70% do supply total permanece na tesouraria do projeto para sustentação e expansão do ecossistema.</p>
          </div>
          <div class="access-note">
            <strong>Função</strong>
            <p>Dar base operacional, liquidez estratégica, estabilidade e capacidade de crescimento ao projeto.</p>
          </div>
        </div>
      </article>
    </section>

    <section id="tokenomics" class="shell-card shell-depth section-card tokenomics-block">
      <div class="section-title">
        <span class="tag">Tokenomics</span>
        <h2>Distribuição do supply de 70 milhões de vWala</h2>
      </div>

      <div class="tokenomics-grid">
        <div class="donut-side">
          <div class="donut-box">
            <svg viewBox="0 0 260 260" class="donut-chart" aria-label="Gráfico de distribuição do supply vWala">
              <circle class="donut-track" cx="130" cy="130" r="88"></circle>
              <circle class="slice slice-market" cx="130" cy="130" r="88"></circle>
              <circle class="slice slice-ecosystem" cx="130" cy="130" r="88"></circle>
              <circle class="slice slice-dev" cx="130" cy="130" r="88"></circle>
              <circle class="slice slice-reserve" cx="130" cy="130" r="88"></circle>
            </svg>
            <div class="donut-center">
              <strong>vWala</strong>
              <span>70M Supply</span>
            </div>
          </div>
        </div>

        <div class="legend-side">
          <div class="legend-card market">
            <span class="legend-dot"></span>
            <div>
              <strong>70% para a tesouraria do projeto</strong>
              <p>Reserva principal para sustentação operacional, liquidez estratégica, segurança e expansão do ecossistema.</p>
            </div>
          </div>
          <div class="legend-card ecosystem">
            <span class="legend-dot"></span>
            <div>
              <strong>15% para mercado e liquidez</strong>
              <p>Alocação destinada a circulação, presença de mercado, liquidez e fortalecimento do uso externo do token.</p>
            </div>
          </div>
          <div class="legend-card dev">
            <span class="legend-dot"></span>
            <div>
              <strong>10% para desenvolvimento do ecossistema</strong>
              <p>Produto, infraestrutura, integrações, evolução técnica e melhorias contínuas da plataforma.</p>
            </div>
          </div>
          <div class="legend-card reserve">
            <span class="legend-dot"></span>
            <div>
              <strong>5% para reserva estratégica</strong>
              <p>Camada complementar de contingência para oportunidades, segurança operacional e ações estratégicas.</p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="two-col-grid vesting-grid">
      <article class="shell-card shell-depth section-card">
        <div class="section-title">
          <span class="tag">Distribuição</span>
          <h2>Modelo de alocação do token</h2>
        </div>
        <p class="section-text">
          O supply total do vWala é de 70 milhões de tokens. A lógica central da distribuição prioriza força de tesouraria,
          sustentação do ecossistema e capacidade real de execução, evitando um modelo frágil ou dependente apenas de mercado aberto.
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
                <td>Tesouraria do projeto</td>
                <td>70%</td>
                <td>Base estrutural, liquidez estratégica, sustentação operacional e expansão</td>
              </tr>
              <tr>
                <td>Mercado e liquidez</td>
                <td>15%</td>
                <td>Circulação, presença de mercado e reforço de liquidez</td>
              </tr>
              <tr>
                <td>Desenvolvimento</td>
                <td>10%</td>
                <td>Produto, integrações, crescimento técnico e evolução do ecossistema</td>
              </tr>
              <tr>
                <td>Reserva estratégica</td>
                <td>5%</td>
                <td>Contingência, segurança e ações estratégicas futuras</td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>

      <article class="shell-card shell-depth section-card release-graph-card">
        <div class="section-title">
          <span class="tag">Gráfico real</span>
          <h2>Composição da distribuição</h2>
        </div>

        <svg viewBox="0 0 460 300" class="bar-chart" aria-label="Gráfico de barras da distribuição do supply">
          <g class="bar-grid">
            <line x1="50" y1="40" x2="430" y2="40"></line>
            <line x1="50" y1="90" x2="430" y2="90"></line>
            <line x1="50" y1="140" x2="430" y2="140"></line>
            <line x1="50" y1="190" x2="430" y2="190"></line>
            <line x1="50" y1="240" x2="430" y2="240"></line>
          </g>
          <g class="bar-group">
            <rect x="70" y="72" width="52" height="168" rx="14"></rect>
            <rect x="165" y="204" width="52" height="36" rx="14"></rect>
            <rect x="260" y="216" width="52" height="24" rx="14"></rect>
            <rect x="355" y="228" width="52" height="12" rx="14"></rect>
          </g>
          <g class="bar-values">
            <text x="89" y="64">70%</text>
            <text x="184" y="196">15%</text>
            <text x="279" y="208">10%</text>
            <text x="374" y="220">5%</text>
          </g>
          <g class="bar-labels">
            <text x="56" y="270">Tesouraria</text>
            <text x="164" y="270">Mercado</text>
            <text x="250" y="270">Desenv.</text>
            <text x="348" y="270">Reserva</text>
          </g>
        </svg>

        <div class="release-notes">
          <div class="release-note"><span></span><p>A maior parte do supply fica na tesouraria para dar força estrutural e operacional ao projeto.</p></div>
          <div class="release-note"><span></span><p>O restante é distribuído entre mercado, desenvolvimento e reserva estratégica para crescimento sustentável.</p></div>
        </div>
      </article>
    </section>

    <section class="shell-card shell-depth section-card final-block">
      <div class="section-title">
        <span class="tag">Direção final</span>
        <h2>Conclusão estratégica</h2>
      </div>
      <p class="section-text">
        O vWala já passou da fase de conceito. Hoje o projeto reúne token próprio, integração com Polygon, criação de token,
        mercados de previsões em esporte e cripto e uma base estrutural voltada para tesouraria e expansão. A leitura correta,
        na minha opinião, é esta: projeto forte não é o que promete muito, é o que constrói infraestrutura, produto e utilidade real.
      </p>
    </section>
  </div>
`