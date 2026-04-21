import './style/style.css'
import { auth, db } from './firebase'
import {
  browserLocalPersistence,
  onAuthStateChanged,
  setPersistence
} from 'firebase/auth'
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, serverTimestamp } from 'firebase/firestore'
import { JsonRpcProvider, Wallet, Contract, Interface, formatUnits, parseUnits } from 'ethers'

const POLYGON_CHAIN_ID = Number(import.meta.env.VITE_POLYGON_CHAIN_ID || 137)
const POLYGON_RPC_PRIMARY_URL = new URL('/api/rpc', window.location.origin).toString()
const POLYGON_RPC_FALLBACK_URL = new URL('/api/rpc-fallback', window.location.origin).toString()
const DEVICE_WALLET_STORAGE_KEY = 'vwala_device_wallet'
const TOKEN_SYMBOL = import.meta.env.VITE_TOKEN_SYMBOL || 'vWALA'
const VWALA_TOKEN = import.meta.env.VITE_VWALA_TOKEN || '0x7bD1f6f4F5CEf026b643758605737CB48b4B7D83'
const BETTING_ADDRESS = '0x486ea8E0E7C320b0b4940bce4e8Bf09905cf917f'
const FOOTBALL_KEEPER_URL = '/.netlify/functions/football-keeper'

const ERC20_ABI = [
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)'
]

const BETTING_ABI = [
  'function claimPosition(uint64 fixtureId, uint64 couponId) external',
  'function getMarketState(uint64 fixtureId) external view returns (bool exists, address authority, uint64 storedFixtureId, uint8 status, bool hasWinner, uint8 winningOutcome, uint256 createdAt, uint256 resolvedAt)',
  'function getMarketNames(uint64 fixtureId) external view returns (string league, string teamA, string teamB)',
  'function getPosition(uint64 fixtureId, address user, uint64 couponId) external view returns (bool exists, uint64 storedFixtureId, address positionUser, uint64 storedCouponId, uint8 outcome, uint256 amount, bool claimed, uint256 claimedAmount)',
  'error MarketNotFound()',
  'error MarketNotResolved()',
  'error PositionNotFound()',
  'error InvalidPositionOwner()',
  'error PositionAlreadyClaimed()',
  'error NotWinner()',
  'error TreasuryInactive()',
  'error TreasuryInsufficient()'
]

const BETTING_ERROR_INTERFACE = new Interface(BETTING_ABI)

const Outcome = {
  HOME: 0,
  DRAW: 1,
  AWAY: 2
}

const MarketStatus = {
  OPEN: 0,
  CLOSED: 1,
  RESOLVED: 2
}

const state = {
  provider: null,
  signer: null,
  userAddress: '',
  token: null,
  betting: null,
  decimals: 18,
  positions: []
}

let currentGoogleUser = null

document.querySelector('#app').innerHTML = `
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
            <span>H/Futebol</span>
          </div>
        </div>

        <button id="connectBtn" class="connect" type="button">
          Carregando saldo...
        </button>
      </header>

      <aside id="sidebar" class="side-menu">
        <a href="/carteira">Carteira</a>
        <a href="/token">Criar Token</a>
        <a href="/apostas">Futebol</a>
        <a href="/posicoes">H/Futebol</a>
        <a href="/historico">H/Futures</a>
      </aside>

      <main class="app-content">
        <section class="hero-card">
          <div class="hero-copy">
            <p class="eyebrow">VWALA · POLYGON</p>
            <h1>Histórico de Futebol</h1>
            <p class="hero-text">
              Veja suas apostas, acompanhe se o mercado está aberto, fechado ou resolvido e resgate quando estiver liberado.
            </p>
          </div>

          <div class="hero-stats">
            <div class="stat-box">
              <span>Histórico</span>
              <strong>On-chain</strong>
            </div>

            <div class="stat-box">
              <span>Resgate</span>
              <strong>Winner Claim</strong>
            </div>

            <div class="stat-box">
              <span>Rede</span>
              <strong>Polygon</strong>
            </div>
          </div>
        </section>

        <section class="card">
          <div class="section-head">
            <div>
              <p class="section-kicker">MINHAS POSIÇÕES</p>
              <h2>Histórico de apostas</h2>
            </div>
            <span class="section-count" id="positionCount">0</span>
          </div>

          <input
            id="searchInput"
            class="input"
            type="text"
            placeholder="Buscar por campeonato, time ou status"
          />
        </section>

        <section class="card">
          <div id="positionsGrid" class="match-grid"></div>

          <div id="positionsEmpty" class="empty-state">
            Nenhuma aposta encontrada para esta carteira.
          </div>
        </section>
      </main>
    </div>
  </div>

  <div id="appNoticeOverlay" class="overlay"></div>
  <div id="appNoticeModal" class="custom-modal">
    <div class="card modal-card notice-modal-card">
      <div class="modal-header">
        <h3 id="appNoticeTitle">Aviso</h3>
        <button class="modal-close" id="closeAppNoticeBtn" type="button">✕</button>
      </div>

      <div class="notice-modal-body">
        <p id="appNoticeText" class="notice-modal-text">Mensagem do sistema</p>
      </div>

      <div class="notice-modal-footer">
        <button id="appNoticeConfirmBtn" class="notice-confirm-btn" type="button">Entendi</button>
      </div>
    </div>
  </div>

  <div id="appPinOverlay" class="overlay"></div>
  <div id="appPinModal" class="custom-modal">
    <div class="card modal-card notice-modal-card">
      <div class="modal-header">
        <h3 id="appPinTitle">Confirmar PIN</h3>
        <button class="modal-close" id="closeAppPinBtn" type="button">✕</button>
      </div>

      <div class="notice-modal-body">
        <p id="appPinText" class="notice-modal-text">Digite o PIN da carteira para resgatar.</p>
        <input
          id="appPinInput"
          class="input"
          type="password"
          placeholder="Digite seu PIN"
          autocomplete="current-password"
        />
      </div>

      <div class="notice-modal-footer app-pin-actions">
        <button id="appPinConfirmBtn" class="notice-confirm-btn" type="button">Confirmar</button>
      </div>
    </div>
  </div>

  <div id="appLoadingOverlay" class="overlay"></div>
  <div id="appLoadingModal" class="custom-modal">
    <div class="card modal-card notice-modal-card app-loading-card">
      <div class="notice-modal-body app-loading-body">
        <div class="app-loading-spinner"></div>
        <h3 id="appLoadingTitle">Processando</h3>
        <p id="appLoadingText" class="notice-modal-text">Aguarde...</p>
      </div>
    </div>
  </div>
`

const positionsGrid = document.getElementById('positionsGrid')
const positionsEmpty = document.getElementById('positionsEmpty')
const positionCount = document.getElementById('positionCount')
const searchInput = document.getElementById('searchInput')
const connectBtn = document.getElementById('connectBtn')
const sidebar = document.getElementById('sidebar')
const sidebarOverlay = document.getElementById('sidebarOverlay')
const menuBtn = document.getElementById('menuBtn')

const appNoticeOverlay = document.getElementById('appNoticeOverlay')
const appNoticeModal = document.getElementById('appNoticeModal')
const appNoticeTitle = document.getElementById('appNoticeTitle')
const appNoticeText = document.getElementById('appNoticeText')
const closeAppNoticeBtn = document.getElementById('closeAppNoticeBtn')
const appNoticeConfirmBtn = document.getElementById('appNoticeConfirmBtn')

const appPinOverlay = document.getElementById('appPinOverlay')
const appPinModal = document.getElementById('appPinModal')
const appPinTitle = document.getElementById('appPinTitle')
const appPinText = document.getElementById('appPinText')
const appPinInput = document.getElementById('appPinInput')
const closeAppPinBtn = document.getElementById('closeAppPinBtn')
const appPinConfirmBtn = document.getElementById('appPinConfirmBtn')

const appLoadingOverlay = document.getElementById('appLoadingOverlay')
const appLoadingModal = document.getElementById('appLoadingModal')
const appLoadingTitle = document.getElementById('appLoadingTitle')
const appLoadingText = document.getElementById('appLoadingText')

const pinModalState = {
  resolve: null
}

function showAlert(title, message) {
  appNoticeTitle.textContent = title
  appNoticeText.textContent = message
  appNoticeModal.classList.add('active')
  appNoticeOverlay.classList.add('active')
}

function closeAlert() {
  appNoticeModal.classList.remove('active')
  appNoticeOverlay.classList.remove('active')
}

function openPinModal(title, text) {
  appPinTitle.textContent = title
  appPinText.textContent = text
  appPinInput.value = ''
  appPinModal.classList.add('active')
  appPinOverlay.classList.add('active')

  setTimeout(() => {
    appPinInput.focus()
  }, 0)

  return new Promise((resolve) => {
    pinModalState.resolve = resolve
  })
}

function closePinModal(result = null) {
  appPinModal.classList.remove('active')
  appPinOverlay.classList.remove('active')

  const resolve = pinModalState.resolve
  pinModalState.resolve = null

  if (resolve) {
    resolve(result)
  }
}

function showLoadingModal(title = 'Processando', text = 'Aguarde...') {
  appLoadingTitle.textContent = title
  appLoadingText.textContent = text
  appLoadingModal.classList.add('active')
  appLoadingOverlay.classList.add('active')
}

function hideLoadingModal() {
  appLoadingModal.classList.remove('active')
  appLoadingOverlay.classList.remove('active')
}

function openSidebar() {
  sidebar.style.right = '0'
  sidebarOverlay.classList.add('active')
}

function closeSidebar() {
  sidebar.style.right = '-280px'
  sidebarOverlay.classList.remove('active')
}

function cleanTeamName(name = '') {
  return String(name || '')
    .replace(/^\b(SC|EC|FC|AC|AFC|SAF|SE|AA)\b\s+/i, '')
    .replace(/\s+\b(SC|EC|FC|AC|AFC|SAF|SE|AA|FBPA|FBC)\b$/i, '')
    .replace(/\s+\b(Paulista)\b$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function formatNumber(value, digits = 2) {
  const num = Number(value || 0)

  if (!Number.isFinite(num)) {
    return '0'
  }

  return num.toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits
  })
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

  const migratedRead = await readBalanceViaConsensus(
    walletAddress,
    `posicoes_vwala_migration_${userId}`
  )

  const migratedBalanceRaw = BigInt(String(migratedRead?.rawBalance || '0'))
  const migratedBalance = formatVWalaUnits(migratedBalanceRaw)

  if (migratedBalanceRaw > 0n) {
    await setDoc(
      balanceRef,
      {
        assetId: 'vwala',
        token: TOKEN_SYMBOL,
        tokenAddress: VWALA_TOKEN,
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
        tokenAddress: VWALA_TOKEN,
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

async function saveConfirmedCreditVWalaToFirebase({
  userId,
  walletAddress,
  amount,
  txHash,
  historyType = 'football_claim'
}) {
  const normalizedTxHash = sanitizeTxHashForDoc(txHash)
  const amountRaw = parseVWalaUnits(amount)

  if (!userId) {
    throw new Error('userId ausente para salvar crédito.')
  }

  if (!normalizedTxHash) {
    throw new Error('txHash ausente para salvar crédito.')
  }

  if (amountRaw <= 0n) {
    throw new Error('amount inválido para salvar crédito.')
  }

  const balanceRef = getSwapBalanceDocRef(userId, 'vwala')
  const balanceSnap = await getDoc(balanceRef)
  const currentData = balanceSnap.exists() ? balanceSnap.data() || {} : {}

  const currentBalanceRaw =
    currentData.balanceRaw != null
      ? BigInt(String(currentData.balanceRaw))
      : parseVWalaUnits(currentData.balanceFormatted || currentData.balance || '0')

  const nextBalanceRaw = currentBalanceRaw + amountRaw
  const nextBalanceFormatted = formatVWalaUnits(nextBalanceRaw)
  const amountFormatted = formatVWalaUnits(amountRaw)

  await setDoc(
    balanceRef,
    {
      assetId: 'vwala',
      token: TOKEN_SYMBOL,
      tokenAddress: VWALA_TOKEN,
      walletAddress,
      balanceRaw: nextBalanceRaw.toString(),
      balance: Number(nextBalanceFormatted),
      balanceFormatted: nextBalanceFormatted,
      lastType: historyType,
      lastTxHash: normalizedTxHash,
      updatedAt: serverTimestamp()
    },
    { merge: true }
  )

  await setDoc(
    getSwapHistoryDocRef(userId, normalizedTxHash),
    {
      assetId: 'vwala',
      type: historyType,
      token: TOKEN_SYMBOL,
      tokenAddress: VWALA_TOKEN,
      walletAddress,
      amountRaw: amountRaw.toString(),
      amount: Number(amountFormatted),
      amountFormatted: amountFormatted,
      txHash: normalizedTxHash,
      createdAt: serverTimestamp()
    },
    { merge: true }
  )
}

function setConnectButtonText(text) {
  if (connectBtn) connectBtn.textContent = text
}

function createRpcProbeUrl(baseUrl, label = 'posicoes_runtime') {
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
  const tokenContract = new Contract(VWALA_TOKEN, ERC20_ABI, provider)

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

  console.groupCollapsed(`[POSICOES_VWALA_RPC_PROBES] ${label} round=${round}`)
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

async function readBalanceViaConsensus(walletAddress, label) {
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



function getCurrentWalletAddress() {
  return String(state.userAddress || '').trim()
}

function getLocalDeviceWalletForBetting() {
  try {
    const raw = localStorage.getItem(DEVICE_WALLET_STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch (error) {
    console.error('Erro ao ler carteira local:', error)
    return null
  }
}

function getFootballPositionDocId(fixtureId, couponId) {
  return `${String(fixtureId).trim()}_${String(couponId).trim()}`
}

function getFootballLocalPositionsStorageKey() {
  const walletAddress = String(state.userAddress || '').trim().toLowerCase()
  return `wala_football_local_positions_${walletAddress || 'guest'}`
}

function readLocalFootballPositions() {
  try {
    const raw = localStorage.getItem(getFootballLocalPositionsStorageKey())
    const parsed = JSON.parse(raw || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch (error) {
    console.error('Erro ao ler posições locais de futebol:', error)
    return []
  }
}

function writeLocalFootballPositions(items) {
  localStorage.setItem(getFootballLocalPositionsStorageKey(), JSON.stringify(items))
}

function removeLocalFootballPosition(fixtureId, couponId) {
  const docId = getFootballPositionDocId(fixtureId, couponId)
  const items = readLocalFootballPositions()
  const filtered = items.filter((item) => String(item?.docId || '') !== docId)
  writeLocalFootballPositions(filtered)
}

function getFootballPendingStorageKey() {
  const walletAddress = String(state.userAddress || '').trim().toLowerCase()
  return `wala_football_pending_positions_${walletAddress || 'guest'}`
}

function readPendingFootballPositions() {
  try {
    const raw = localStorage.getItem(getFootballPendingStorageKey())
    const parsed = JSON.parse(raw || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch (error) {
    console.error('Erro ao ler pendências locais de futebol:', error)
    return []
  }
}

function writePendingFootballPositions(items) {
  localStorage.setItem(getFootballPendingStorageKey(), JSON.stringify(items))
}

function removePendingFootballPositionLocally(fixtureId, couponId) {
  const docId = getFootballPositionDocId(fixtureId, couponId)
  const items = readPendingFootballPositions()
  const filtered = items.filter((item) => String(item?.docId || '') !== docId)
  writePendingFootballPositions(filtered)
}

async function finalizeFootballPositionCleanup(fixtureId, couponId) {
  try {
    await removeFootballPositionFromFirebase({
      fixtureId: String(fixtureId),
      couponId: String(couponId)
    })
  } catch (firebaseError) {
    console.error('Erro ao remover posição de futebol do Firebase:', firebaseError)
  }

  removePendingFootballPositionLocally(fixtureId, couponId)
  removeLocalFootballPosition(fixtureId, couponId)
  removeCouponFromLocalStorage(fixtureId, couponId)

  state.positions = state.positions.filter(
    (item) =>
      !(
        String(item.fixtureId) === String(fixtureId) &&
        String(item.couponId) === String(couponId)
      )
  )
}
 
function getSavedCouponEntriesFromLocal() {
  const walletAddress = String(state.userAddress || '').trim().toLowerCase()

  if (!walletAddress) {
    return []
  }

  try {
    const raw = localStorage.getItem(`wala_coupons_${walletAddress}`)
    const saved = raw ? JSON.parse(raw) : {}
    const dedupe = new Set()
    const entries = []

    for (const [fixtureId, coupons] of Object.entries(saved)) {
      if (!Array.isArray(coupons)) continue

      for (const couponId of coupons) {
        const uniqueKey = `${fixtureId}:${couponId}`

        if (dedupe.has(uniqueKey)) continue
        dedupe.add(uniqueKey)

        entries.push({
          fixtureId: String(fixtureId),
          couponId: String(couponId)
        })
      }
    }

    return entries.sort((a, b) => Number(b.fixtureId) - Number(a.fixtureId))
  } catch (error) {
    console.error('Erro ao ler cupons salvos:', error)
    return []
  }
}

function restoreCouponsToLocalStorage(entries = []) {
  const walletAddress = String(state.userAddress || '').trim().toLowerCase()

  if (!walletAddress || !entries.length) {
    return
  }

  const next = {}

  for (const entry of entries) {
    const fixtureId = String(entry?.fixtureId || '').trim()
    const couponId = String(entry?.couponId || '').trim()

    if (!fixtureId || !couponId) continue

    if (!Array.isArray(next[fixtureId])) {
      next[fixtureId] = []
    }

    if (!next[fixtureId].includes(couponId)) {
      next[fixtureId].push(couponId)
    }
  }

  localStorage.setItem(`wala_coupons_${walletAddress}`, JSON.stringify(next))
}

async function getSavedCouponEntriesFromFirebase() {
  if (!currentGoogleUser?.uid) {
    return []
  }

  const walletAddress = String(state.userAddress || '').trim().toLowerCase()

  if (!walletAddress) {
    return []
  }

  try {
    const snapshot = await getDocs(
      collection(db, 'users', currentGoogleUser.uid, 'football_positions')
    )

    const dedupe = new Set()
    const entries = []

    snapshot.forEach((docSnap) => {
      const data = docSnap.data() || {}

      if (data.claimed === true) return
      if (String(data.walletAddress || '').trim().toLowerCase() !== walletAddress) return

      const fixtureId = String(data.fixtureId || '').trim()
      const couponId = String(data.couponId || '').trim()
      const uniqueKey = `${fixtureId}:${couponId}`

      if (!fixtureId || !couponId || dedupe.has(uniqueKey)) {
        return
      }

      dedupe.add(uniqueKey)
      entries.push({ fixtureId, couponId })
    })

    return entries.sort((a, b) => Number(b.fixtureId) - Number(a.fixtureId))
  } catch (error) {
    console.error('Erro ao ler posições do Firebase:', error)
    return []
  }
}

async function getSavedCouponEntries() {
  if (currentGoogleUser?.uid) {
    const firebaseEntries = await getSavedCouponEntriesFromFirebase()

    if (firebaseEntries.length) {
      restoreCouponsToLocalStorage(firebaseEntries)
    }

    return firebaseEntries
  }

  return getSavedCouponEntriesFromLocal()
}

function removeCouponFromLocalStorage(fixtureId, couponId) {
  const walletAddress = String(state.userAddress || '').trim().toLowerCase()

  if (!walletAddress) {
    return
  }

  try {
    const key = `wala_coupons_${walletAddress}`
    const saved = JSON.parse(localStorage.getItem(key) || '{}')
    const fixtureKey = String(fixtureId).trim()
    const couponKey = String(couponId).trim()

    if (!Array.isArray(saved[fixtureKey])) {
      return
    }

    saved[fixtureKey] = saved[fixtureKey].filter((item) => String(item) !== couponKey)

    if (!saved[fixtureKey].length) {
      delete saved[fixtureKey]
    }

    localStorage.setItem(key, JSON.stringify(saved))
  } catch (error) {
    console.error('Erro ao remover cupom do localStorage:', error)
  }
}

async function removeFootballPositionFromFirebase(item) {
  if (!currentGoogleUser?.uid) {
    return
  }

  await deleteDoc(
    doc(
      db,
      'users',
      currentGoogleUser.uid,
      'football_positions',
      getFootballPositionDocId(item.fixtureId, item.couponId)
    )
  )
}

function getBettingErrorName(error) {
  const candidates = [
    error?.data,
    error?.error?.data,
    error?.info?.error?.data,
    error?.info?.data
  ]

  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !candidate.startsWith('0x')) continue

    try {
      const parsed = BETTING_ERROR_INTERFACE.parseError(candidate)
      if (parsed?.name) {
        return parsed.name
      }
    } catch {
      continue
    }
  }

  return ''
}

function getFriendlyError(error) {
  const text = String(error?.shortMessage || error?.message || error || '').toLowerCase()
  const errorName = getBettingErrorName(error)

  if (text.includes('user rejected')) return 'Transação cancelada na wallet.'
  if (text.includes('insufficient funds')) return 'Saldo insuficiente para a transação.'
  if (text.includes('invalid password') || text.includes('wrong password') || text.includes('incorrect password')) {
    return 'PIN incorreto.'
  }

  if (errorName === 'MarketNotFound') return 'Mercado não encontrado.'
  if (errorName === 'MarketNotResolved') return 'Esse mercado ainda não foi resolvido.'
  if (errorName === 'PositionNotFound') return 'Posição não encontrada.'
  if (errorName === 'InvalidPositionOwner') return 'Essa posição não pertence a esta carteira.'
  if (errorName === 'PositionAlreadyClaimed') return 'Essa posição já foi resgatada.'
  if (errorName === 'NotWinner') return 'Essa posição não venceu.'
  if (errorName === 'TreasuryInactive') return 'A tesouraria ainda não foi iniciada.'
  if (errorName === 'TreasuryInsufficient') return 'A tesouraria está sem liquidez suficiente.'

  if (text.includes('marketnotresolved')) return 'Esse mercado ainda não foi resolvido.'
  if (text.includes('positionalreadyclaimed')) return 'Essa posição já foi resgatada.'
  if (text.includes('notwinner')) return 'Essa posição não venceu.'

  return error?.shortMessage || error?.message || 'Erro ao processar a operação.'
}

function formatMarketStatus(status, hasWinner) {
  if (Number(status) === MarketStatus.OPEN) return 'ABERTO'
  if (Number(status) === MarketStatus.CLOSED) return 'FECHADO'
  if (Number(status) === MarketStatus.RESOLVED && hasWinner) return 'RESOLVIDO'
  return '---'
}

function formatOutcomeLabel(teamA, teamB, outcome) {
  if (Number(outcome) === Outcome.HOME) return teamA
  if (Number(outcome) === Outcome.DRAW) return 'Empate'
  if (Number(outcome) === Outcome.AWAY) return teamB
  return '---'
}

function formatTimestamp(timestamp) {
  const value = Number(timestamp || 0)

  if (!value) return '--'

  return new Date(value * 1000).toLocaleString('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short'
  })
}

function isClaimable(item) {
  return (
    Number(item.status) === MarketStatus.RESOLVED &&
    item.hasWinner &&
    !item.claimed &&
    Number(item.outcome) === Number(item.winningOutcome)
  )
}

function isLosingResolved(item) {
  return (
    Number(item.status) === MarketStatus.RESOLVED &&
    item.hasWinner &&
    !item.claimed &&
    Number(item.outcome) !== Number(item.winningOutcome)
  )
}

function getHistoryStateLabel(item) {
  if (item.claimed) return 'RESGATADA'
  if (isLosingResolved(item)) return 'NÃO VENCEU'
  if (isClaimable(item)) return 'PRONTA PARA RESGATE'
  if (Number(item.status) === MarketStatus.OPEN) return 'APOSTA ABERTA'
  if (Number(item.status) === MarketStatus.CLOSED) return 'APOSTA FECHADA'
  return '---'
}

function getClaimButtonText(item) {
  if (item.claimed) return 'Resgatado'
  if (isLosingResolved(item)) return 'Perdido'
  if (isClaimable(item)) return 'Resgatar'
  return 'Verificar resultado'
}

function getPositionSortWeight(item) {
  if (item.claimed) return 3
  if (isLosingResolved(item)) return 2
  if (isClaimable(item)) return 0
  return 1
}

async function loadUserTokenBalance() {
  try {
    const walletAddress = String(state.userAddress || getCurrentWalletAddress()).trim()

    if (!walletAddress) {
      setConnectButtonText('Sem carteira')
      return
    }

    setConnectButtonText('Validando saldo...')

    const firebaseBalance = currentGoogleUser?.uid
      ? await readFirebaseVWalaBalance(currentGoogleUser.uid, walletAddress)
      : '0'

    setConnectButtonText(formatTokenBalance(firebaseBalance))
    console.log('firebase_balance_read', {
      walletAddress,
      balanceFormatted: firebaseBalance
    })
  } catch (error) {
    console.error(`Erro ao carregar saldo ${TOKEN_SYMBOL} no Firebase:`, error)
    setConnectButtonText(`0,00 ${TOKEN_SYMBOL}`)
  }
}

async function syncWalletProfileFromFirebase() {
  if (!currentGoogleUser?.uid) {
    state.userAddress = ''
    return
  }

  const userRef = doc(db, 'users', currentGoogleUser.uid)
  const userSnap = await getDoc(userRef)

  if (!userSnap.exists()) {
    state.userAddress = ''
    localStorage.removeItem('vwala_wallet_profile')
    return
  }

  const userData = userSnap.data()
  const walletAddress = String(userData.walletAddress || '').trim()

  if (!walletAddress) {
    state.userAddress = ''
    localStorage.removeItem('vwala_wallet_profile')
    return
  }

  const existingDeviceWallet = getLocalDeviceWalletForBetting()

  if (existingDeviceWallet?.walletAddress) {
    const localAddress = String(existingDeviceWallet.walletAddress).trim().toLowerCase()
    const firebaseAddress = walletAddress.toLowerCase()

    if (localAddress !== firebaseAddress) {
      localStorage.removeItem(DEVICE_WALLET_STORAGE_KEY)
      state.signer = null
    }
  }

  localStorage.setItem(
    'vwala_wallet_profile',
    JSON.stringify({
      uid: currentGoogleUser.uid,
      walletAddress,
      chainId: userData.chainId || POLYGON_CHAIN_ID,
      network: userData.network || 'polygon'
    })
  )

  state.userAddress = walletAddress
}

async function initFirebaseSession() {
  try {
    await setPersistence(auth, browserLocalPersistence)

    await new Promise((resolve) => {
      let finished = false

      const unsubscribe = onAuthStateChanged(auth, async (user) => {
        currentGoogleUser = user || null

        try {
          if (user) {
            await syncWalletProfileFromFirebase()
          }
        } catch (error) {
          console.error('Erro ao sincronizar Firebase:', error)
        } finally {
          if (!finished) {
            finished = true
            unsubscribe()
            resolve()
          }
        }
      })
    })
  } catch (error) {
    console.error('Erro ao iniciar Firebase:', error)
  }
}

async function getInternalWalletSigner() {
  if (state.signer) {
    return state.signer
  }

  const deviceVault = getLocalDeviceWalletForBetting()
  if (!deviceVault?.walletKeystoreLocal) {
    return null
  }

  const expectedAddress = getCurrentWalletAddress().trim().toLowerCase()
  const vaultAddress = String(deviceVault.walletAddress || '').trim().toLowerCase()

  if (!expectedAddress || !vaultAddress || expectedAddress !== vaultAddress) {
    return null
  }

  const pin = await openPinModal('Confirmar PIN', 'Digite o PIN da carteira para resgatar.')
  if (pin === null) {
    return null
  }

  if (!pin.trim()) {
    throw new Error('PIN inválido.')
  }

  const unlockedWallet = await Wallet.fromEncryptedJson(
    deviceVault.walletKeystoreLocal,
    pin.trim()
  )

  const signer = unlockedWallet.connect(state.provider)
  state.signer = signer
  state.betting = state.betting.connect(signer)

  return signer
}

async function initWalletSession() {
  try {
    const walletAddress = getCurrentWalletAddress()

    state.provider = new JsonRpcProvider(POLYGON_RPC_PRIMARY_URL, POLYGON_CHAIN_ID)
    state.userAddress = walletAddress
    state.signer = null
    state.token = new Contract(VWALA_TOKEN, ERC20_ABI, state.provider)
    state.betting = new Contract(BETTING_ADDRESS, BETTING_ABI, state.provider)
    state.decimals = Number(await state.token.decimals())

    await loadUserTokenBalance()
  } catch (error) {
    console.error('Erro ao iniciar carteira da página de posições:', error)
    setConnectButtonText('Sem carteira')
  }
}

async function loadHistory() {
  try {
    if (!state.userAddress || !state.betting) {
      state.positions = []
      renderPositions()
      return
    }

    const entries = await getSavedCouponEntries()

    if (!entries.length) {
      state.positions = []
      renderPositions()
      return
    }

    const marketStateCache = new Map()
    const marketNamesCache = new Map()
    const nextPositions = []

    for (const entry of entries) {
      try {
        const fixtureIdBigInt = BigInt(entry.fixtureId)
        const couponIdBigInt = BigInt(entry.couponId)

        let marketState = marketStateCache.get(entry.fixtureId)
        if (!marketState) {
          marketState = await state.betting.getMarketState(fixtureIdBigInt)
          marketStateCache.set(entry.fixtureId, marketState)
        }

        let marketNames = marketNamesCache.get(entry.fixtureId)
        if (!marketNames) {
          marketNames = await state.betting.getMarketNames(fixtureIdBigInt)
          marketNamesCache.set(entry.fixtureId, marketNames)
        }

        const position = await state.betting.getPosition(
          fixtureIdBigInt,
          state.userAddress,
          couponIdBigInt
        )

        if (!position[0]) {
          continue
        }

        if (position[6] === true) {
  await finalizeFootballPositionCleanup(entry.fixtureId, entry.couponId)
  continue
}

const isResolved = Number(marketState[3]) === MarketStatus.RESOLVED
const hasWinner = Boolean(marketState[4])
const winningOutcome = Number(marketState[5])
const userOutcome = Number(position[4])

if (isResolved && hasWinner && userOutcome !== winningOutcome) {
  await finalizeFootballPositionCleanup(entry.fixtureId, entry.couponId)
  continue
}

        const teamA = cleanTeamName(marketNames[1] || 'Time A')
        const teamB = cleanTeamName(marketNames[2] || 'Time B')

        nextPositions.push({
          fixtureId: String(entry.fixtureId),
          couponId: String(entry.couponId),
          league: marketNames[0] || 'Futebol',
          teamA,
          teamB,
          status: Number(marketState[3]),
          hasWinner: marketState[4],
          winningOutcome: Number(marketState[5]),
          createdAt: Number(marketState[6]),
          resolvedAt: Number(marketState[7]),
          outcome: Number(position[4]),
          amount: formatUnits(position[5], state.decimals),
          claimed: position[6],
          claimedAmount: formatUnits(position[7], state.decimals)
        })      } catch (error) {
        console.error(`Erro ao carregar cupom ${entry.fixtureId}:${entry.couponId}`, error)
      }
    }

    state.positions = nextPositions.sort((a, b) => {
      const weightDiff = getPositionSortWeight(a) - getPositionSortWeight(b)

      if (weightDiff !== 0) {
        return weightDiff
      }

      return Number(b.fixtureId) - Number(a.fixtureId)
    })

    renderPositions()
  } catch (error) {
    console.error(error)
    showAlert('Erro', 'Não foi possível carregar o histórico de futebol.')
  }
}

async function syncFixtureBeforeClaim(fixtureId) {
  const response = await fetch(
    `${FOOTBALL_KEEPER_URL}?fixtureId=${encodeURIComponent(String(fixtureId || '').trim())}`
  )

  let result = {}

  try {
    result = await response.json()
  } catch {
    result = {}
  }

  if (!response.ok || result?.ok === false) {
  const detailParts = [
    result?.stage ? `Etapa: ${result.stage}` : '',
    result?.error || '',
    result?.shortMessage || '',
    result?.code ? `Code: ${result.code}` : '',
    result?.marketStateOnError
  ? `status=${result.marketStateOnError.status}, hasWinner=${result.marketStateOnError.hasWinner}, winning=${result.marketStateOnError.currentWinningOutcome}, authority=${result.marketStateOnError.authority || '-'}, operator=${result.operator || '-'}`
  : ''
  ].filter(Boolean)

  throw new Error(
    detailParts.join(' | ') || 'Não foi possível verificar o resultado do mercado.'
  )
}

  return result
}

async function claimItem(item) {
  try {
    if (item.claimed) {
      showAlert('Resgate', 'Essa posição já foi resgatada.')
      return
    }

    if (isLosingResolved(item)) {
      showAlert('Resultado', 'Essa posição não venceu.')
      return
    }

    showLoadingModal('Verificando resultado', 'Consultando API e sincronizando o mercado on-chain.')

    await syncFixtureBeforeClaim(item.fixtureId)
    await loadHistory()

    const freshItem = state.positions.find(
      (position) =>
        String(position.fixtureId) === String(item.fixtureId) &&
        String(position.couponId) === String(item.couponId)
    )

    hideLoadingModal()

    if (!freshItem) {
      const marketStateAfterSync = await state.betting.getMarketState(BigInt(item.fixtureId))
      const marketStatusAfterSync = Number(marketStateAfterSync[3])
      const hasWinnerAfterSync = Boolean(marketStateAfterSync[4])
      const winningOutcomeAfterSync = Number(marketStateAfterSync[5])
      const originalOutcome = Number(item.outcome)

      if (
  marketStatusAfterSync === MarketStatus.RESOLVED &&
  hasWinnerAfterSync &&
  originalOutcome !== winningOutcomeAfterSync
) {
  await finalizeFootballPositionCleanup(item.fixtureId, item.couponId)
  showAlert('Aposta perdida', 'Essa aposta não venceu e foi removida da lista.')
  renderPositions()
  return
}

      if (
        marketStatusAfterSync === MarketStatus.RESOLVED &&
        hasWinnerAfterSync &&
        originalOutcome === winningOutcomeAfterSync
      ) {
        showAlert(
          'Resultado confirmado',
          'Sua posição venceu, mas não foi possível recarregar o item na lista. Atualize a página e tente resgatar.'
        )
        return
      }

      showAlert(
        'Resultado confirmado',
        'Essa posição foi encerrada após a verificação, mas ainda não ficou disponível para resgate.'
      )
      return
    }

    if (freshItem.claimed) {
      showAlert('Resgate', 'Essa posição já foi resgatada.')
      return
    }

    if (isLosingResolved(freshItem)) {
  await finalizeFootballPositionCleanup(freshItem.fixtureId, freshItem.couponId)
  showAlert('Resultado confirmado', 'Sua posição não venceu.')
  renderPositions()
  return
}

    if (!isClaimable(freshItem)) {
      showAlert('Mercado ainda não resolvido', 'O jogo ainda não terminou ou o resultado ainda não foi confirmado on-chain.')
      return
    }

    const signer = await getInternalWalletSigner()

    if (!signer) {
      showAlert('PIN necessário', 'Digite o PIN da carteira interna para resgatar.')
      return
    }

    showLoadingModal('Resgatando posição', 'Aguarde enquanto o resgate é enviado para a Polygon.')

    const bettingWithSigner = state.betting.connect(signer)
    const tx = await bettingWithSigner.claimPosition(
      BigInt(freshItem.fixtureId),
      BigInt(freshItem.couponId)
    )

    const receipt = await tx.wait()
    const confirmedTxHash = String(receipt?.hash || tx?.hash || '')

    if (!confirmedTxHash) {
      throw new Error('Claim confirmado sem tx hash.')
    }

    const claimedPosition = await state.betting.getPosition(
      BigInt(freshItem.fixtureId),
      await signer.getAddress(),
      BigInt(freshItem.couponId)
    )

    const claimedAmountUi =
      Number(formatUnits(claimedPosition[7], state.decimals) || 0) > 0
        ? formatUnits(claimedPosition[7], state.decimals)
        : String(freshItem.amount || '0')

    if (currentGoogleUser?.uid) {
      await saveConfirmedCreditVWalaToFirebase({
        userId: currentGoogleUser.uid,
        walletAddress: await signer.getAddress(),
        amount: claimedAmountUi,
        txHash: confirmedTxHash,
        historyType: 'football_claim'
      })
    }

    await finalizeFootballPositionCleanup(freshItem.fixtureId, freshItem.couponId)

hideLoadingModal()
showAlert('Sucesso', 'Resgate concluído com sucesso.')

await loadUserTokenBalance()
renderPositions()
await loadHistory()
  } catch (error) {
    hideLoadingModal()
    showAlert('Erro', getFriendlyError(error))
  }
}

function createHistoryCard(item) {
  const card = document.createElement('div')
  card.className = 'match-card inline-market-card'

  const userPick = formatOutcomeLabel(item.teamA, item.teamB, item.outcome)
  const winningPick = item.hasWinner
    ? formatOutcomeLabel(item.teamA, item.teamB, item.winningOutcome)
    : '--'

  const marketStatus = formatMarketStatus(item.status, item.hasWinner)
  const historyState = getHistoryStateLabel(item)
  const buttonText = getClaimButtonText(item)
  const canClaim = isClaimable(item)

  card.innerHTML = `
    <div class="match-box inline-match-box">
      <div class="match-league">${item.league}</div>

      <div class="match-teams">
        <div class="team-block">
          <div class="team-badge">A</div>
          <strong>${item.teamA}</strong>
        </div>

        <div class="match-versus">VS</div>

        <div class="team-block">
          <div class="team-badge">B</div>
          <strong>${item.teamB}</strong>
        </div>
      </div>

      <div class="match-time">Cupom #${item.couponId.slice(-10)}</div>
    </div>

    <div class="stats-grid inline-stats-grid">
      <div class="stat-box">
        <span class="stat-label">Mercado</span>
        <strong class="stat-value">${marketStatus}</strong>
      </div>

      <div class="stat-box">
        <span class="stat-label">Sua aposta</span>
        <strong class="stat-value">${userPick}</strong>
      </div>

      <div class="stat-box">
        <span class="stat-label">Resultado</span>
        <strong class="stat-value">${winningPick}</strong>
      </div>
    </div>

    <div class="market-question inline-market-question force-show">
      <div class="market-mini-status">
        <span class="market-chip pending">${historyState}</span>
        <span class="market-total">${formatNumber(item.amount, 4)} ${TOKEN_SYMBOL}</span>
      </div>

      <div class="market-mini-pools">
        <span>Criado: ${formatTimestamp(item.createdAt)}</span>
        <span>Resolvido: ${formatTimestamp(item.resolvedAt)}</span>
      </div>
    </div>

    <div class="bet-panel">
      <div class="bet-top">
        <div class="selected-outcome-chip js-selected-outcome-chip">${userPick}</div>
        <div class="estimated-payout-text js-estimated-payout-text">
          ${item.claimed ? `Resgatado: ${formatNumber(item.claimedAmount, 4)} ${TOKEN_SYMBOL}` : `Valor apostado: ${formatNumber(item.amount, 4)} ${TOKEN_SYMBOL}`}
        </div>
      </div>

      <div class="bet-hint-text js-bet-hint-text">
        ${
          item.claimed
            ? 'Essa posição já foi resgatada.'
            : canClaim
              ? 'Sua posição venceu e já pode ser resgatada.'
              : Number(item.status) === MarketStatus.OPEN
                ? 'Essa aposta ainda está aberta.'
                : Number(item.status) === MarketStatus.CLOSED
                  ? 'A aposta fechou e aguarda resolução.'
                  : Number(item.status) === MarketStatus.RESOLVED
                    ? 'Essa posição não venceu.'
                    : 'Aguardando atualização on-chain.'
        }
      </div>
    </div>

    <button class="launch confirm-bet-btn js-claim-btn" type="button" ${item.claimed || isLosingResolved(item) ? 'disabled' : ''}>
      ${buttonText}
    </button>
  `

  const claimBtn = card.querySelector('.js-claim-btn')

  claimBtn.addEventListener('click', async () => {
    claimBtn.disabled = true

    try {
      await claimItem(item)
    } finally {
      await loadHistory()
    }
  })

  return card
}

function renderPositions() {
  const term = searchInput.value.trim().toLowerCase()

  const filtered = state.positions.filter((item) => {
    const text = [
      item.league,
      item.teamA,
      item.teamB,
      formatMarketStatus(item.status, item.hasWinner),
      getHistoryStateLabel(item),
      formatOutcomeLabel(item.teamA, item.teamB, item.outcome)
    ]
      .join(' ')
      .toLowerCase()

    return text.includes(term)
  })

  positionsGrid.innerHTML = ''

  filtered.forEach((item) => {
    positionsGrid.appendChild(createHistoryCard(item))
  })

  positionCount.textContent = String(filtered.length)
  positionsEmpty.classList.toggle('show', filtered.length === 0)
}

async function boot() {
  menuBtn.addEventListener('click', openSidebar)
  sidebarOverlay.addEventListener('click', closeSidebar)

  connectBtn.addEventListener('click', async () => {
    await loadUserTokenBalance()
    await loadHistory()
  })

  searchInput.addEventListener('input', renderPositions)

  closeAppNoticeBtn.addEventListener('click', closeAlert)
  appNoticeConfirmBtn.addEventListener('click', closeAlert)
  appNoticeOverlay.addEventListener('click', closeAlert)

  closeAppPinBtn.addEventListener('click', () => closePinModal(null))
  appPinConfirmBtn.addEventListener('click', () => closePinModal(appPinInput.value))
  appPinOverlay.addEventListener('click', () => closePinModal(null))

  appPinInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      closePinModal(appPinInput.value)
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      closePinModal(null)
    }
  })

  await initFirebaseSession()
  await initWalletSession()
  await loadHistory()
}

boot()