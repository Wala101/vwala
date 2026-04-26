

import { auth, db } from './firebase'
import {
  browserLocalPersistence,
  onAuthStateChanged,
  setPersistence
} from 'firebase/auth'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { Contract, JsonRpcProvider, formatUnits, parseUnits } from 'ethers'

const app = document.querySelector('#app')

if (!app) {
  throw new Error('Elemento #app não encontrado.')
}

const TOKEN_SYMBOL = 'vWALA'
const POLYGON_RPC_PRIMARY_URL = new URL('/api/rpc', window.location.origin).toString()
const POLYGON_RPC_FALLBACK_URL = new URL('/api/rpc-fallback', window.location.origin).toString()
const VWALA_TOKEN_ADDRESS = '0x7bD1f6f4F5CEf026b643758605737CB48b4B7D83'

let currentFirebaseUser = null
let currentFirebaseWalletAddress = ''

const ERC20_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)'
]

let balanceReadCounter = 0



function createRpcProbeUrl(baseUrl, label) {
  const url = new URL(baseUrl, window.location.origin)
  url.searchParams.set('_ts', String(Date.now()))
  url.searchParams.set('_probe', label)
  return url.toString()
}

function compareRawBalanceAsc(a, b) {
  const aValue = BigInt(String(a || '0'))
  const bValue = BigInt(String(b || '0'))

  if (aValue === bValue) return 0
  return aValue < bValue ? -1 : 1
}

async function readSingleBalanceProbe(walletAddress, label, baseUrl, proxyName) {
  const rpcUrl = createRpcProbeUrl(baseUrl, label)
  const provider = new JsonRpcProvider(rpcUrl)
  const tokenContract = new Contract(VWALA_TOKEN_ADDRESS, ERC20_ABI, provider)
  const [blockNumber, rawBalance, decimals] = await Promise.all([
    provider.getBlockNumber(),
    tokenContract.balanceOf(walletAddress),
    tokenContract.decimals()
  ])

  return {
    source: label,
    proxyName,
    walletAddress,
    blockNumber: Number(blockNumber),
    rawBalance: rawBalance.toString(),
    decimals: Number(decimals),
    formattedBalance: Number(formatUnits(rawBalance, decimals)),
    rpcUrl
  }
}

function selectStableBalanceProbe(probes = []) {
  const groupedMap = new Map()

  probes.forEach((probe) => {
    const key = String(probe.rawBalance || '0')

    if (!groupedMap.has(key)) {
      groupedMap.set(key, {
        rawBalance: key,
        count: 0,
        maxBlock: 0,
        probes: []
      })
    }

    const group = groupedMap.get(key)
    group.count += 1
    group.maxBlock = Math.max(group.maxBlock, Number(probe.blockNumber || 0))
    group.probes.push(probe)
  })

  const groups = [...groupedMap.values()].sort((a, b) => {
  if (b.count !== a.count) {
    return b.count - a.count
  }

  if (b.maxBlock !== a.maxBlock) {
    return b.maxBlock - a.maxBlock
  }

  return compareRawBalanceAsc(a.rawBalance, b.rawBalance)
})

  const selectedGroup = groups[0]
  const selectedProbe = [...selectedGroup.probes].sort((a, b) => {
    const blockDiff = Number(b.blockNumber || 0) - Number(a.blockNumber || 0)

    if (blockDiff !== 0) {
      return blockDiff
    }

    return String(a.source || '').localeCompare(String(b.source || ''))
  })[0]

const selectionReason = groups.length === 1
  ? 'unanimous'
  : 'majority_then_latest_block'

  return {
    selectedProbe,
    selectionReason,
    groups
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function runBalanceProbeRound(walletAddress, label, round) {
  const settled = await Promise.allSettled([
    readSingleBalanceProbe(
      walletAddress,
      `${label}_r${round}_primary_a`,
      POLYGON_RPC_PRIMARY_URL,
      'primary'
    ),
    readSingleBalanceProbe(
      walletAddress,
      `${label}_r${round}_primary_b`,
      POLYGON_RPC_PRIMARY_URL,
      'primary'
    ),
    readSingleBalanceProbe(
      walletAddress,
      `${label}_r${round}_fallback_a`,
      POLYGON_RPC_FALLBACK_URL,
      'fallback'
    ),
    readSingleBalanceProbe(
      walletAddress,
      `${label}_r${round}_fallback_b`,
      POLYGON_RPC_FALLBACK_URL,
      'fallback'
    )
  ])

  const probes = settled
    .filter((item) => item.status === 'fulfilled')
    .map((item) => item.value)

  const failures = settled
    .filter((item) => item.status === 'rejected')
    .map((item) => item.reason)

  if (!probes.length) {
    throw failures[0] || new Error('Nenhuma leitura de saldo foi concluída.')
  }

  const { selectedProbe, selectionReason, groups } = selectStableBalanceProbe(probes)

  console.groupCollapsed(`[VWALA_RPC_PROBES] ${label} round=${round}`)
  console.log('all_probes', probes)
  console.log('grouped_probes', groups)
  console.log('selected_probe', selectedProbe)
  console.log('selection_reason', selectionReason)

  if (failures.length) {
    console.warn('probe_failures', failures)
  }

  console.groupEnd()

  return {
    ...selectedProbe,
    selectedFrom: selectedProbe.source,
    selectionReason,
    allProbes: probes,
    failedProbeCount: failures.length,
    groups,
    round
  }
}

async function readBalanceViaEthers(walletAddress, label) {
  const attempts = []
  let previousRawBalance = ''

  for (let round = 1; round <= 4; round += 1) {
    const result = await runBalanceProbeRound(walletAddress, label, round)
    attempts.push(result)

    const isUnanimous = result.groups.length === 1
    const sameAsPrevious =
      previousRawBalance &&
      String(previousRawBalance) === String(result.rawBalance)

    if (isUnanimous || sameAsPrevious) {
      return {
        ...result,
        stabilizationReason: isUnanimous
          ? 'unanimous_round'
          : 'same_result_in_two_rounds',
        attempts
      }
    }

    previousRawBalance = String(result.rawBalance)

    if (round < 4) {
      await sleep(900)
    }
  }

  const lastResult = attempts[attempts.length - 1]

  return {
    ...lastResult,
    stabilizationReason: 'max_rounds_last_result',
    attempts
  }
}

async function syncFirebaseWalletAddress() {
  currentFirebaseWalletAddress = ''

  const uid = String(currentFirebaseUser?.uid || '').trim()

  if (!uid) {
    return ''
  }

  const userRef = doc(db, 'users', uid)
  const userSnap = await getDoc(userRef)

  if (!userSnap.exists()) {
    return ''
  }

  const userData = userSnap.data() || {}
  const walletAddress = String(userData.walletAddress || '').trim()

  currentFirebaseWalletAddress = walletAddress
  return walletAddress
}

function getCurrentWalletAddress() {
  return String(currentFirebaseWalletAddress || '').trim()
}


function formatTokenBalance(value = 0) {
  const num = Number(value || 0)

  if (!Number.isFinite(num)) {
    return `0,00 ${TOKEN_SYMBOL}`
  }

  return `${num.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4
  })} ${TOKEN_SYMBOL}`
}

function parseVWalaUnits(value) {
  return parseUnits(String(value || '0'), 18)
}

function formatVWalaUnits(value) {
  return formatUnits(value, 18)
}

function sanitizeTxHashForDoc(txHash = '') {
  return String(txHash || '').trim().toLowerCase()
}

function getSwapBalanceDocRef(userId, assetId = 'vwala') {
  return doc(db, 'users', userId, 'swap_balances', assetId)
}

function getSwapHistoryDocRef(userId, txHash) {
  return doc(db, 'users', userId, 'swap_history', sanitizeTxHashForDoc(txHash))
}

async function readFirebaseVWalaBalance(userId, walletAddress = '') {
  if (!userId) return '0'

  const balanceRef = getSwapBalanceDocRef(userId, 'vwala')
  const balanceSnap = await getDoc(balanceRef)

  if (balanceSnap.exists()) {
    const data = balanceSnap.data() || {}

    if (data.balanceRaw != null) {
      return formatVWalaUnits(BigInt(String(data.balanceRaw)))
    }

    return String(data.balanceFormatted || data.balance || '0')
  }

  if (!walletAddress) {
    return '0'
  }

  const migratedRead = await readBalanceViaEthers(
    walletAddress,
    `home_vwala_migration_${userId}`
  )

  const migratedBalanceRaw = BigInt(String(migratedRead?.rawBalance || '0'))
  const migratedBalance = formatVWalaUnits(migratedBalanceRaw)

  if (migratedBalanceRaw > 0n) {
    await setDoc(
      balanceRef,
      {
        assetId: 'vwala',
        token: TOKEN_SYMBOL,
        tokenAddress: VWALA_TOKEN_ADDRESS,
        walletAddress,
        balanceRaw: migratedBalanceRaw.toString(),
        balance: Number(migratedBalance),
        balanceFormatted: migratedBalance,
        lastType: 'migration',
        lastTxHash: 'migration-initial-onchain-read',
        updatedAt: serverTimestamp()
      },
      { merge: true }
    )

    await setDoc(
      getSwapHistoryDocRef(userId, `migration-${String(walletAddress).toLowerCase()}`),
      {
        assetId: 'vwala',
        type: 'migration',
        token: TOKEN_SYMBOL,
        tokenAddress: VWALA_TOKEN_ADDRESS,
        walletAddress,
        amountRaw: migratedBalanceRaw.toString(),
        amount: Number(migratedBalance),
        amountFormatted: migratedBalance,
        txHash: 'migration-initial-onchain-read',
        createdAt: serverTimestamp()
      },
      { merge: true }
    )
  }

  return migratedBalance
}

function setConnectButtonText(text) {
  const connectBtn = document.getElementById('connectBtn')
  if (connectBtn) connectBtn.textContent = text
}

async function loadUserTokenBalance() {
  const readId = ++balanceReadCounter
  const groupLabel = `[VWALA_FIREBASE_BALANCE_READ_${readId}]`

  console.groupCollapsed(groupLabel)

  try {
    const walletAddress = getCurrentWalletAddress()

    console.log('wallet_resolution', {
      uid: currentFirebaseUser?.uid || '',
      walletAddress,
      source: 'firebase_users_walletAddress'
    })

    if (!walletAddress) {
      setConnectButtonText('Sem carteira')
      console.warn('Nenhuma carteira ativa resolvida.')
      return
    }

    setConnectButtonText('Validando saldo...')

    const firebaseBalance = currentFirebaseUser?.uid
      ? await readFirebaseVWalaBalance(currentFirebaseUser.uid, walletAddress)
      : '0'

    setConnectButtonText(formatTokenBalance(firebaseBalance))
    console.log('firebase_balance_read', {
      walletAddress,
      balanceFormatted: firebaseBalance
    })
  } catch (error) {
    console.error(`Erro ao carregar saldo ${TOKEN_SYMBOL} no Firebase:`, error)
    setConnectButtonText(`0,00 ${TOKEN_SYMBOL}`)
  } finally {
    console.groupEnd()
  }
}

app.innerHTML = `
  <div id="sidebarOverlay" class="overlay"></div>


  <div class="page-shell">
    <div class="app-frame">
      <header class="topbar">
        <button class="menu-btn" id="menuBtn" type="button" aria-label="Abrir menu">
          <span></span>
          <span></span>
          <span></span>
        </button>

        <div class="brand-wrap">
          <div class="brand-badge">W</div>
          <div class="brand-text">
            <strong>Wala-v2</strong>
            <span>Mercado</span>
          </div>
        </div>

        <button id="connectBtn" class="connect" type="button">
  Carregando saldo...
</button>
      </header>



      <aside id="sidebar" class="side-menu">
  <a href="/carteira">Carteira</a>
  <a href="/token">Criar Token</a>
  <a href="/futeboll">Futebol</a>
  <a href="/predicoes">Predições</a>
  <a href="/posicoes">H/Futebol</a>
  <a href="/historico">H/Futures</a>
</aside>

      <main class="app-content">
        <section class="hero-card">
          <div class="hero-copy">
            <p class="eyebrow">VWALA · POLYGON</p>
            <h1>vWALA Platform</h1>
            <p class="hero-text">
              Plataforma de previsões, swap interno, stake e liquidez em Polygon.
            </p>
          </div>

          <div class="hero-stats">
            <div class="stat-box">
              <span>Mercado</span>
              <strong>Futebol e Predições</strong>
            </div>

            <div class="stat-box">
              <span>Status</span>
              <strong>Em construção</strong>
            </div>

            <div class="stat-box">
              <span>Rede</span>
              <strong>Polygon</strong>
            </div>
          </div>
        </section>

        <section class="section-head">
          <div>
            <p class="section-kicker">DESTAQUES</p>
            <h2>Acessos principais</h2>
          </div>
        </section>

        <section class="cards-list">
          <article
            class="feature-card clickable-card"
            data-href="/futeboll"
            role="button"
            tabindex="0"
            aria-label="Abrir página Futebol"
          >
            <div class="feature-card-top">
              <span class="feature-badge">⚽</span>
              <span class="feature-chip">Em destaque</span>
            </div>

            <h3>Futebol</h3>
            <p>
              Jogos, probabilidades e abertura de posições no mercado esportivo.
            </p>

            <div class="feature-card-footer">
              <span>Abrir</span>
              <strong style="display: none;">futeboll</strong>
            </div>
          </article>

          <article
            class="feature-card clickable-card"
            data-href="/predicoes"
            role="button"
            tabindex="0"
            aria-label="Abrir página Predições"
          >
            <div class="feature-card-top">
              <span class="feature-badge">📈</span>
              <span class="feature-chip">Novo</span>
            </div>

            <h3>Predições</h3>
            <p>
              Área de mercado binário para cripto com posições de sim ou não.
            </p>

            <div class="feature-card-footer">
              <span>Abrir</span>
              <strong style="display: none;">predicoes.html</strong>
            </div>
          </article>

          <article
            class="feature-card clickable-card"
            data-href="/token"
            role="button"
            tabindex="0"
            aria-label="Abrir página Criar Token"
          >
            <div class="feature-card-top">
              <span class="feature-badge">🧾</span>
              <span class="feature-chip">Token</span>
            </div>

            <h3>Criar Token</h3>
            <p>
              Crie seu token com imagem, nome, símbolo e metadata ligada ao ecossistema WALA.
            </p>

            <div class="feature-card-footer">
              <span>Abrir</span>
              <strong style="display: none;">token.html</strong>
            </div>
          </article>

          <article
            class="feature-card clickable-card"
            data-href="/whitepaper"
            role="button"
            tabindex="0"
            aria-label="Abrir página Whitepaper"
          >
            <div class="feature-card-top">
              <span class="feature-badge">📘</span>
              <span class="feature-chip">Sobre</span>
            </div>

            <h3>Whitepaper</h3>
            <p>
              Conheça a proposta do projeto, visão, estrutura e objetivos do ecossistema WALA.
            </p>

            <div class="feature-card-footer">
              <span>Abrir</span>
              <strong style="display: none;">whitepaper.html</strong>
            </div>
          </article>
        </section>
        <section class="section-head">
          <div>
            <p class="section-kicker">ATALHOS</p>
            <h2>Outras páginas</h2>
          </div>
        </section>

        <section class="shortcut-grid">
          <a class="shortcut-card" href="/futeboll">
            <span class="shortcut-icon">⚽</span>
            <strong>Futebol</strong>
            <small>Mercado esportivo</small>
          </a>

          <a class="shortcut-card" href="/predicoes">
            <span class="shortcut-icon">📈</span>
            <strong>Predições</strong>
            <small>Mercado binário cripto</small>
          </a>

         <a class="shortcut-card" href="/token">
          <span class="shortcut-icon">🧾</span>
          <strong>Criar Token</strong>
          <small>Crie seu token</small>
        </a>



          <a class="shortcut-card" href="/carteira">
            <span class="shortcut-icon">👛</span>
            <strong>Carteira</strong>
            <small>Saldo e ações internas</small>
          </a>
        </section>
      </main>
    </div>
  </div>
`

const sidebar = document.getElementById('sidebar')

const sidebarOverlay = document.getElementById('sidebarOverlay')

const menuBtn = document.getElementById('menuBtn')
const connectBtn = document.getElementById('connectBtn')

const clickableCards = document.querySelectorAll('.clickable-card')

function goTo(path) {
  if (!path) return
  window.location.href = path
}

function openSidebar() {
  sidebar.style.right = '0'
  sidebarOverlay.classList.add('active')
}

function closeSidebar() {
  sidebar.style.right = '-280px'
  sidebarOverlay.classList.remove('active')
}



async function initFirebaseSession() {
  try {
    await setPersistence(auth, browserLocalPersistence)

    await new Promise((resolve) => {
      let finished = false

      const unsubscribe = onAuthStateChanged(auth, async (user) => {
  currentFirebaseUser = user || null

  if (user) {
    localStorage.setItem(
      'vwala_user',
      JSON.stringify({
        uid: user.uid,
        name: user.displayName || '',
        email: user.email || '',
        photo: user.photoURL || ''
      })
    )

    try {
      await syncFirebaseWalletAddress()
    } catch (error) {
      console.error('Erro ao sincronizar wallet do Firebase:', error)
      currentFirebaseWalletAddress = ''
    }
  } else {
    localStorage.removeItem('vwala_user')
    currentFirebaseWalletAddress = ''
  }

  if (!finished) {
    finished = true
    unsubscribe()
    resolve()
  }
})
    })
  } catch (error) {
    console.error('Erro ao iniciar sessão Firebase:', error)
  }
}



menuBtn?.addEventListener('click', openSidebar)
sidebarOverlay?.addEventListener('click', closeSidebar)


// saldo somente leitura



clickableCards.forEach((card) => {
  const target = card.getAttribute('data-href')

  card.addEventListener('click', () => {
    goTo(target)
  })

  card.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      goTo(target)
    }
  })
})

document.querySelectorAll('#sidebar a').forEach((link) => {
  link.addEventListener('click', () => {
    closeSidebar()
  })
})



async function initApp() {

  await initFirebaseSession()
  await loadUserTokenBalance()
}

initApp()