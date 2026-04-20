import './style/style.css'
import { auth, db } from './firebase'
import {
  browserLocalPersistence,
  onAuthStateChanged,
  setPersistence
} from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { JsonRpcProvider, Wallet, Contract, Interface, formatUnits } from 'ethers'

const POLYGON_CHAIN_ID = Number(import.meta.env.VITE_POLYGON_CHAIN_ID || 137)
const POLYGON_RPC_PRIMARY_URL = new URL('/api/rpc', window.location.origin).toString()
const POLYGON_RPC_FALLBACK_URL = new URL('/api/rpc-fallback', window.location.origin).toString()

const DEVICE_WALLET_STORAGE_KEY = 'vwala_device_wallet'
const TOKEN_SYMBOL = import.meta.env.VITE_TOKEN_SYMBOL || 'vWALA'
const VWALA_TOKEN = import.meta.env.VITE_VWALA_TOKEN || '0x7bD1f6f4F5CEf026b643758605737CB48b4B7D83'
const BINARY_PREDICTIONS_ADDRESS =
  import.meta.env.VITE_BINARY_PREDICTIONS_ADDRESS || '0x798474EC1C9f32ca2537bCD4f88d7b422baEE23d'
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

const ERC20_ABI = [
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)'
]

const PREDICTIONS_ABI = [
  'function claimPosition(uint64 marketId, uint64 couponId) external',
  'function getMarketState(uint64 marketId) external view returns (bool exists, address authority, uint64 storedMarketId, uint8 status, bool hasWinner, uint8 winningSide, uint256 createdAt, uint256 resolvedAt, uint256 closeAt)',
  'function getMarketMeta(uint64 marketId) external view returns (string assetSymbol, string question, int256 referencePriceE8)',
  'function getPosition(uint64 marketId, address user, uint64 couponId) external view returns (bool exists, uint64 storedMarketId, address positionUser, uint64 storedCouponId, uint8 side, uint256 amount, bool claimed, uint256 claimedAmount)',
  'error Unauthorized()',
  'error InvalidAmount()',
  'error InvalidProbabilityConfig()',
  'error FeeTooHigh()',
  'error MarketAlreadyExists()',
  'error MarketNotFound()',
  'error MarketClosed()',
  'error MarketNotOpen()',
  'error MarketAlreadyResolved()',
  'error MarketNotResolved()',
  'error NoWinningLiquidity()',
  'error PositionAlreadyExists()',
  'error PositionNotFound()',
  'error InvalidPositionOwner()',
  'error PositionAlreadyClaimed()',
  'error NotWinner()',
  'error InvalidPayout()',
  'error TreasuryInactive()',
  'error TreasuryInsufficient()'
]

const PREDICTIONS_ERROR_INTERFACE = new Interface(PREDICTIONS_ABI)

const Side = {
  YES: 0,
  NO: 1
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
  predictions: null,
  decimals: 18,
  positions: []
}

let currentGoogleUser = null
let balanceReadCounter = 0

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
            <span>H/Futures</span>
          </div>
        </div>

        <button id="connectBtn" class="connect" type="button">
          Carregando saldo...
        </button>
      </header>

      <aside id="sidebar" class="side-menu">
        <a href="/carteira.html">Carteira</a>
        <a href="/token.html">Criar Token</a>
        <a href="/apostas.html">Futebol</a>
        <a href="/predicoes.html">Predições</a>
        <a href="/posicoes.html">H/Futebol</a>
        <a href="/historico.html">H/Futures</a>
      </aside>

      <main class="app-content">
        <section class="hero-card">
          <div class="hero-copy">
            <p class="eyebrow">VWALA · POLYGON</p>
            <h1>Histórico Futures</h1>
            <p class="hero-text">
              Veja suas posições em cripto, acompanhe o status do mercado e resgate quando estiver liberado.
            </p>
          </div>

          <div class="hero-stats">
            <div class="stat-box">
              <span>Histórico</span>
              <strong>On-chain</strong>
            </div>

            <div class="stat-box">
              <span>Resgate</span>
              <strong>Claim</strong>
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
              <h2>Histórico de futures</h2>
            </div>
            <span class="section-count" id="positionCount">0</span>
          </div>

          <input
            id="searchInput"
            class="input"
            type="text"
            placeholder="Buscar por ativo, pergunta ou status"
          />
        </section>

        <section class="card">
          <div id="positionsGrid" class="match-grid"></div>

          <div id="positionsEmpty" class="empty-state">
            Nenhuma posição encontrada para esta carteira.
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

function formatUsd(value) {
  const num = Number(value || 0)

  if (!Number.isFinite(num)) {
    return '--'
  }

  return num.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
}

function formatTimestamp(timestamp) {
  const value = Number(timestamp || 0)

  if (!value) {
    return '--'
  }

  return new Date(value * 1000).toLocaleString('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short'
  })
}

function setConnectButtonText(text) {
  if (connectBtn) {
    connectBtn.textContent = text
  }
}

function createRpcProbeUrl(baseUrl, label = 'historico_runtime') {
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

  console.groupCollapsed(`[HISTORICO_VWALA_RPC_PROBES] ${label} round=${round}`)
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

function getSideLabel(side) {
  return Number(side) === Side.YES ? 'SIM' : 'NÃO'
}

function formatMarketStatus(status, hasWinner, closeAt) {
  if (Number(status) === MarketStatus.RESOLVED && hasWinner) return 'RESOLVIDO'
  if (Number(status) === MarketStatus.CLOSED) return 'FECHADO'

  const now = Math.floor(Date.now() / 1000)
  if (Number(closeAt || 0) <= now) return 'FECHADO'

  return 'ABERTO'
}

function readWalletProfile() {
  try {
    const rawProfile = localStorage.getItem('vwala_wallet_profile')
    if (rawProfile) return JSON.parse(rawProfile)

    const rawDeviceWallet = localStorage.getItem(DEVICE_WALLET_STORAGE_KEY)
    return rawDeviceWallet ? JSON.parse(rawDeviceWallet) : null
  } catch (error) {
    console.error('Erro ao ler carteira local:', error)
    return null
  }
}

function getCurrentWalletAddress() {
  return String(state.userAddress || '').trim()
}

function getLocalDeviceWalletForPredictions() {
  try {
    const raw = localStorage.getItem(DEVICE_WALLET_STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch (error) {
    console.error('Erro ao ler carteira local:', error)
    return null
  }
}

function isPredictionsConfigured() {
  return Boolean(
    BINARY_PREDICTIONS_ADDRESS &&
    BINARY_PREDICTIONS_ADDRESS !== ZERO_ADDRESS
  )
}

function getSavedCouponEntries() {
  const walletAddress = String(state.userAddress || getCurrentWalletAddress()).trim().toLowerCase()

  if (!walletAddress) {
    return []
  }

  try {
    const raw = localStorage.getItem(`wala_binary_coupons_${walletAddress}`)
    const saved = raw ? JSON.parse(raw) : {}
    const dedupe = new Set()
    const entries = []

    for (const [marketId, coupons] of Object.entries(saved)) {
      if (!Array.isArray(coupons)) continue

      for (const couponId of coupons) {
        const uniqueKey = `${marketId}:${couponId}`

        if (dedupe.has(uniqueKey)) continue
        dedupe.add(uniqueKey)

        entries.push({
          marketId: String(marketId),
          couponId: String(couponId)
        })
      }
    }

    return entries.sort((a, b) => Number(b.marketId) - Number(a.marketId))
  } catch (error) {
    console.error('Erro ao ler cupons salvos:', error)
    return []
  }
}

function getPredictionsErrorName(error) {
  const candidates = [
    error?.data,
    error?.error?.data,
    error?.info?.error?.data,
    error?.info?.data
  ]

  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !candidate.startsWith('0x')) {
      continue
    }

    try {
      const parsed = PREDICTIONS_ERROR_INTERFACE.parseError(candidate)
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
  const errorName = getPredictionsErrorName(error)

  if (text.includes('user rejected')) return 'Transação cancelada na wallet.'
  if (text.includes('insufficient funds')) return 'Saldo insuficiente para a transação.'
  if (text.includes('invalid password') || text.includes('wrong password') || text.includes('incorrect password')) {
    return 'PIN incorreto.'
  }

  if (errorName === 'MarketNotFound') return 'Mercado não encontrado.'
  if (errorName === 'PositionNotFound') return 'Posição não encontrada.'
  if (errorName === 'InvalidPositionOwner') return 'Essa posição não pertence a esta carteira.'
  if (errorName === 'PositionAlreadyClaimed') return 'Essa posição já foi resgatada.'
  if (errorName === 'NotWinner') return 'Essa posição não venceu.'
  if (errorName === 'MarketNotResolved') return 'Esse mercado ainda não foi resolvido.'
  if (errorName === 'TreasuryInactive') return 'A tesouraria ainda não foi iniciada.'
  if (errorName === 'TreasuryInsufficient') return 'A tesouraria está sem liquidez suficiente.'

  return error?.shortMessage || error?.message || 'Erro ao processar a operação.'
}

function isClaimable(item) {
  return (
    Number(item.status) === MarketStatus.RESOLVED &&
    item.hasWinner &&
    !item.claimed &&
    Number(item.side) === Number(item.winningSide)
  )
}

function getHistoryStateLabel(item) {
  if (item.claimed) return 'RESGATADA'
  if (isClaimable(item)) return 'PRONTA PARA RESGATE'
  if (Number(item.status) === MarketStatus.OPEN) return 'MERCADO ABERTO'
  if (Number(item.status) === MarketStatus.CLOSED) return 'AGUARDANDO RESOLUÇÃO'
  if (Number(item.status) === MarketStatus.RESOLVED && Number(item.side) !== Number(item.winningSide)) {
    return 'NÃO VENCEU'
  }

  return '---'
}

function getClaimButtonText(item) {
  if (item.claimed) return 'Resgatado'
  if (isClaimable(item)) return 'Resgatar'
  if (Number(item.status) === MarketStatus.OPEN) return 'Mercado aberto'
  if (Number(item.status) === MarketStatus.CLOSED) return 'Aguardando'
  if (Number(item.status) === MarketStatus.RESOLVED) return 'Sem resgate'
  return 'Indisponível'
}

async function loadUserTokenBalance() {
  const readId = ++balanceReadCounter
  const groupLabel = `[HISTORICO_VWALA_BALANCE_READ_${readId}]`

  console.groupCollapsed(groupLabel)

  try {
    const walletAddress = String(state.userAddress || getCurrentWalletAddress()).trim()

    if (!walletAddress) {
      setConnectButtonText('Sem carteira')
      return
    }

    setConnectButtonText('Carregando saldo...')

    setConnectButtonText('Validando saldo...')

const selectedRead = await readBalanceViaConsensus(
  walletAddress,
  `historico_vwala_balance_main_${readId}`
)

setConnectButtonText(formatTokenBalance(selectedRead.formattedBalance))
console.log('selected_balance_read', selectedRead)
console.log('balance_stabilization_reason', selectedRead.stabilizationReason)
console.log('balance_attempts', selectedRead.attempts)
  } catch (error) {
    console.error(`Erro ao carregar saldo ${TOKEN_SYMBOL}:`, error)
    setConnectButtonText(`0,00 ${TOKEN_SYMBOL}`)
  } finally {
    console.groupEnd()
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
  let walletAddress = ''

  if (userData?.walletKeystoreCloud) {
    try {
      const unlockedWallet = await Wallet.fromEncryptedJson(
        userData.walletKeystoreCloud,
        `vwala_google_device_pin_v1:${currentGoogleUser.uid}`
      )

      walletAddress = String(unlockedWallet.address || '').trim()
    } catch (error) {
      console.error('Erro ao resolver wallet pelo keystore cloud no histórico:', error)
    }
  }

  if (!walletAddress) {
    walletAddress = String(userData.walletAddress || '').trim()
  }

  if (!walletAddress) {
  state.userAddress = ''
  localStorage.removeItem('vwala_wallet_profile')
  return
}

  if (!walletAddress) {
    state.userAddress = ''
    localStorage.removeItem('vwala_wallet_profile')
    return
  }

  const existingDeviceWallet = getLocalDeviceWalletForPredictions()

  if (existingDeviceWallet?.walletAddress) {
    const localAddress = String(existingDeviceWallet.walletAddress).trim().toLowerCase()
    const resolvedAddress = walletAddress.toLowerCase()

    if (localAddress !== resolvedAddress) {
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
          console.error('Erro ao sincronizar Firebase no histórico:', error)
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
    console.error('Erro ao iniciar Firebase no histórico:', error)
  }
}

async function getInternalWalletSigner() {
  if (state.signer) {
    return state.signer
  }

  const deviceVault = getLocalDeviceWalletForPredictions()
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

  if (state.predictions) {
    state.predictions = state.predictions.connect(signer)
  }

  return signer
}

async function initWalletSession() {
  try {
    const walletAddress = getCurrentWalletAddress()

    state.provider = new JsonRpcProvider(POLYGON_RPC_PRIMARY_URL, POLYGON_CHAIN_ID)
    state.userAddress = walletAddress
    state.signer = null
    state.token = new Contract(VWALA_TOKEN, ERC20_ABI, state.provider)
    state.decimals = Number(await state.token.decimals())

    if (isPredictionsConfigured()) {
      state.predictions = new Contract(
        BINARY_PREDICTIONS_ADDRESS,
        PREDICTIONS_ABI,
        state.provider
      )
    } else {
      state.predictions = null
    }

    await loadUserTokenBalance()
  } catch (error) {
    console.error('Erro ao iniciar carteira do histórico:', error)
    setConnectButtonText('Sem carteira')
  }
}

async function loadHistory() {
  try {
    if (!state.userAddress || !state.predictions) {
      state.positions = []
      renderPositions()
      return
    }

    const entries = getSavedCouponEntries()

    if (!entries.length) {
      state.positions = []
      renderPositions()
      return
    }

    const marketStateCache = new Map()
    const marketMetaCache = new Map()
    const nextPositions = []

    for (const entry of entries) {
      try {
        const marketIdBigInt = BigInt(entry.marketId)
        const couponIdBigInt = BigInt(entry.couponId)

        let marketState = marketStateCache.get(entry.marketId)
        if (!marketState) {
          marketState = await state.predictions.getMarketState(marketIdBigInt)
          marketStateCache.set(entry.marketId, marketState)
        }

        let marketMeta = marketMetaCache.get(entry.marketId)
        if (!marketMeta) {
          marketMeta = await state.predictions.getMarketMeta(marketIdBigInt)
          marketMetaCache.set(entry.marketId, marketMeta)
        }

        const position = await state.predictions.getPosition(
          marketIdBigInt,
          state.userAddress,
          couponIdBigInt
        )

        if (!position[0]) {
          continue
        }

        nextPositions.push({
          marketId: String(entry.marketId),
          couponId: String(entry.couponId),
          assetSymbol: marketMeta[0] || 'CRYPTO',
          question: marketMeta[1] || 'Mercado binário',
          referencePriceUsd: Number(marketMeta[2]) / 100000000,
          status: Number(marketState[3]),
          hasWinner: marketState[4],
          winningSide: Number(marketState[5]),
          createdAt: Number(marketState[6]),
          resolvedAt: Number(marketState[7]),
          closeAt: Number(marketState[8]),
          side: Number(position[4]),
          amount: formatUnits(position[5], state.decimals),
          claimed: position[6],
          claimedAmount: formatUnits(position[7], state.decimals)
        })
      } catch (error) {
        console.error(`Erro ao carregar posição ${entry.marketId}:${entry.couponId}`, error)
      }
    }

    state.positions = nextPositions.sort((a, b) => {
      const aClaimable = isClaimable(a) ? 1 : 0
      const bClaimable = isClaimable(b) ? 1 : 0

      if (aClaimable !== bClaimable) {
        return bClaimable - aClaimable
      }

      return Number(b.marketId) - Number(a.marketId)
    })

    renderPositions()
  } catch (error) {
    console.error(error)
    showAlert('Erro', 'Não foi possível carregar o histórico de futures.')
  }
}

async function claimItem(item) {
  try {
    if (!isClaimable(item)) {
      showAlert('Resgate indisponível', 'Essa posição ainda não pode ser resgatada.')
      return
    }

    const signer = await getInternalWalletSigner()

    if (!signer) {
      showAlert('PIN necessário', 'Digite o PIN da carteira interna para resgatar.')
      return
    }

    showLoadingModal('Resgatando posição', 'Aguarde enquanto o resgate é enviado para a Polygon.')

    const predictionsWithSigner = state.predictions.connect(signer)
    const tx = await predictionsWithSigner.claimPosition(
      BigInt(item.marketId),
      BigInt(item.couponId)
    )

    await tx.wait()

    hideLoadingModal()
    showAlert('Sucesso', 'Resgate concluído com sucesso.')

    await loadUserTokenBalance()
    await loadHistory()
  } catch (error) {
    hideLoadingModal()
    showAlert('Erro', getFriendlyError(error))
  }
}

function createHistoryCard(item) {
  const card = document.createElement('div')
  card.className = 'match-card inline-market-card'

  const userPick = getSideLabel(item.side)
  const winningPick = item.hasWinner ? getSideLabel(item.winningSide) : '--'
  const marketStatus = formatMarketStatus(item.status, item.hasWinner, item.closeAt)
  const historyState = getHistoryStateLabel(item)
  const buttonText = getClaimButtonText(item)
  const canClaim = isClaimable(item)

  card.innerHTML = `
    <div class="match-box inline-match-box">
      <div class="match-league">${item.assetSymbol}</div>

      <div class="match-teams">
        <div class="team-block">
          <div class="team-badge">${item.assetSymbol.slice(0, 3)}</div>
          <strong>${item.question}</strong>
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
        <span class="stat-label">Vencedor</span>
        <strong class="stat-value">${winningPick}</strong>
      </div>
    </div>

    <div class="market-question inline-market-question force-show">
      <div class="market-mini-status">
        <span class="market-chip pending">${historyState}</span>
        <span class="market-total">${formatNumber(item.amount, 4)} ${TOKEN_SYMBOL}</span>
      </div>

      <div class="market-mini-pools">
        <span>Meta: ${formatUsd(item.referencePriceUsd)}</span>
        <span>Fecha: ${formatTimestamp(item.closeAt)}</span>
      </div>
    </div>

    <div class="bet-panel">
      <div class="bet-top">
        <div class="selected-outcome-chip">${userPick}</div>
        <div class="estimated-payout-text">
          ${
            item.claimed
              ? `Resgatado: ${formatNumber(item.claimedAmount, 4)} ${TOKEN_SYMBOL}`
              : `Valor apostado: ${formatNumber(item.amount, 4)} ${TOKEN_SYMBOL}`
          }
        </div>
      </div>

      <div class="bet-hint-text">
        ${
          item.claimed
            ? 'Essa posição já foi resgatada.'
            : canClaim
              ? 'Sua posição venceu e já pode ser resgatada.'
              : Number(item.status) === MarketStatus.OPEN
                ? 'Esse mercado ainda está aberto.'
                : Number(item.status) === MarketStatus.CLOSED
                  ? 'O mercado fechou e aguarda resolução.'
                  : Number(item.status) === MarketStatus.RESOLVED
                    ? 'Essa posição não venceu.'
                    : 'Aguardando atualização on-chain.'
        }
      </div>
    </div>

    <button class="launch confirm-bet-btn js-claim-btn" type="button" ${canClaim ? '' : 'disabled'}>
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
      item.assetSymbol,
      item.question,
      getSideLabel(item.side),
      getSideLabel(item.winningSide),
      formatMarketStatus(item.status, item.hasWinner, item.closeAt),
      getHistoryStateLabel(item)
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