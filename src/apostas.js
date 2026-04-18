import './style/style.css'
import { auth, db } from './firebase'
import {
  browserLocalPersistence,
  onAuthStateChanged,
  setPersistence
} from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { JsonRpcProvider, Wallet, Contract, Interface, formatUnits, parseUnits } from 'ethers'

const POLYGON_CHAIN_ID = Number(import.meta.env.VITE_POLYGON_CHAIN_ID || 137)
const POLYGON_RPC_URL = import.meta.env.VITE_POLYGON_RPC_URL || new URL('/api/rpc', window.location.origin).toString()
const DEVICE_WALLET_STORAGE_KEY = 'vwala_device_wallet'
const TOKEN_SYMBOL = import.meta.env.VITE_TOKEN_SYMBOL || 'vWALA'
const VWALA_TOKEN = import.meta.env.VITE_VWALA_TOKEN || '0x7bD1f6f4F5CEf026b643758605737CB48b4B7D83'
const BETTING_ADDRESS = '0x486ea8E0E7C320b0b4940bce4e8Bf09905cf917f'
const API_BASE = '/.netlify/functions'

const ERC20_ABI = [
  'function approve(address spender, uint256 value) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)'
]

const BETTING_ABI = [
  'function previewPayout(uint64 fixtureId, uint8 outcome, uint256 amount) external view returns (uint256 payout, uint256 netProfit)',
  'function createMarket(uint64 fixtureId, string league, string teamA, string teamB, uint16 feeBps, uint16 homeProbBps, uint16 drawProbBps, uint16 awayProbBps) external',
  'function buyPosition(uint64 fixtureId, uint64 couponId, uint8 outcome, uint256 amount) external',
  'function claimPosition(uint64 fixtureId, uint64 couponId) external',
  'function getMarketState(uint64 fixtureId) external view returns (bool exists, address authority, uint64 storedFixtureId, uint8 status, bool hasWinner, uint8 winningOutcome, uint256 createdAt, uint256 resolvedAt)',
  'function getMarketNames(uint64 fixtureId) external view returns (string league, string teamA, string teamB)',
  'function getMarketPools(uint64 fixtureId) external view returns (uint256 poolHome, uint256 poolDraw, uint256 poolAway, uint256 totalPool, uint256 marketDistributed)',
  'function getMarketProbabilities(uint64 fixtureId) external view returns (uint16 probHomeBps, uint16 probDrawBps, uint16 probAwayBps, uint16 feeBps, uint256 feeAmount)',
  'function getPosition(uint64 fixtureId, address user, uint64 couponId) external view returns (bool exists, uint64 storedFixtureId, address positionUser, uint64 storedCouponId, uint8 outcome, uint256 amount, bool claimed, uint256 claimedAmount)',
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
  matches: [],
  positions: {},
  loading: false
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
            <span>Futebol</span>
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
            <h1>Mercado de Futebol</h1>
            <p class="hero-text">
              Abra posições em jogos on-chain usando a carteira interna do site.
            </p>
          </div>

          <div class="hero-stats">
            <div class="stat-box">
              <span>Mercado</span>
              <strong>Futebol</strong>
            </div>

            <div class="stat-box">
              <span>Liquidação</span>
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
              <p class="section-kicker">BUSCA</p>
              <h2>Mercados abertos</h2>
            </div>
            <span class="section-count" id="marketCount">0</span>
          </div>

          <input
            id="searchInput"
            class="input"
            type="text"
            placeholder="Buscar por campeonato ou time"
          />
        </section>

        <section class="card">
          <div id="marketGrid" class="match-grid"></div>

          <div id="marketEmpty" class="empty-state">
            Nenhum mercado disponível no momento.
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
        <p id="appPinText" class="notice-modal-text">Digite o PIN da carteira para apostar.</p>
        <input
          id="appPinInput"
          class="input"
          type="password"
          placeholder="Digite seu PIN"
          autocomplete="current-password"
        />
      </div>

      <div class="notice-modal-footer app-pin-actions">
        <button id="appPinCancelBtn" class="app-secondary-btn" type="button">Cancelar</button>
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

const marketGrid = document.getElementById('marketGrid')
const marketCount = document.getElementById('marketCount')
const marketEmpty = document.getElementById('marketEmpty')
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
const appPinCancelBtn = document.getElementById('appPinCancelBtn')
const appPinConfirmBtn = document.getElementById('appPinConfirmBtn')

const appLoadingOverlay = document.getElementById('appLoadingOverlay')
const appLoadingModal = document.getElementById('appLoadingModal')
const appLoadingTitle = document.getElementById('appLoadingTitle')
const appLoadingText = document.getElementById('appLoadingText')

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

const pinModalState = {
  resolve: null
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

async function showPinModal(title = 'Confirmar PIN', text = 'Digite o PIN da carteira para apostar.') {
  return openPinModal(title, text)
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



function compactAddress(address) {
  if (!address) return 'Não conectada'
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function formatNumber(value, digits = 2) {
  const num = Number(value || 0)
  if (!Number.isFinite(num)) return '0'
  return num.toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits
  })
}

function formatStatus(status, hasWinner) {
  if (Number(status) === MarketStatus.OPEN) return 'ABERTO'
  if (Number(status) === MarketStatus.CLOSED) return 'FECHADO'
  if (Number(status) === MarketStatus.RESOLVED && hasWinner) return 'RESOLVIDO'
  return '---'
}

function bpsToPercentText(bps) {
  return `${(Number(bps || 0) / 100).toFixed(2).replace('.', ',')}%`
}

function cleanTeamName(name = '') {
  return String(name || '')
    .replace(/\b(SC|EC|FC|AC|AFC|SAF|SE|AA|CA|FBPA)\b/gi, ' ')
    .replace(/\b(Paulista)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeMarketProbabilities(match = {}) {
  const home = Number(match.probHomeBps || match.homeProbBps || 0)
  const draw = Number(match.probDrawBps || match.drawProbBps || 0)
  const away = Number(match.probAwayBps || match.awayProbBps || 0)
  const total = home + draw + away

  if (home > 0 && draw > 0 && away > 0 && total === 10000) {
    return {
      probHomeBps: home,
      probDrawBps: draw,
      probAwayBps: away
    }
  }

  return {
    probHomeBps: 4000,
    probDrawBps: 3000,
    probAwayBps: 3000
  }
}

function getBettingErrorName(error) {
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

  if (errorName === 'Unauthorized') return 'Esse contrato ainda está bloqueando criação pública de mercado.'
  if (errorName === 'MarketAlreadyExists') return 'Esse mercado já foi criado.'
  if (errorName === 'MarketNotFound') return 'Esse mercado ainda não foi criado no contrato.'
  if (errorName === 'MarketClosed') return 'Esse mercado já está fechado.'
  if (errorName === 'InvalidAmount') return 'Valor inválido.'
  if (errorName === 'InvalidProbabilityConfig') return 'As probabilidades do mercado estão inválidas.'
  if (errorName === 'PositionAlreadyExists') return 'Essa posição já existe para esse cupom.'
  if (errorName === 'PositionNotFound') return 'Posição não encontrada.'
  if (errorName === 'PositionAlreadyClaimed') return 'Essa posição já foi resgatada.'
  if (errorName === 'NotWinner') return 'Essa posição não venceu.'
  if (errorName === 'MarketNotResolved') return 'Esse mercado ainda não foi resolvido.'
  if (errorName === 'TreasuryInactive') return 'A tesouraria ainda não foi iniciada.'
  if (errorName === 'TreasuryInsufficient') return 'A tesouraria está sem liquidez suficiente.'

  if (text.includes('marketalreadyexists')) return 'Esse mercado já foi criado.'
  if (text.includes('marketnotfound')) return 'Esse mercado ainda não foi criado no contrato.'
  if (text.includes('marketclosed')) return 'Esse mercado já está fechado.'
  if (text.includes('marketnotresolved')) return 'Esse mercado ainda não foi resolvido.'

  return error?.shortMessage || error?.message || 'Erro ao processar transação.'
}

function generateCouponId(match) {
  const now = Date.now()
  const random = Math.floor(Math.random() * 100000)
  return BigInt(`${match.fixtureId}${String(now).slice(-6)}${random}`)
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
  const wallet = readWalletProfile()

  return String(
    wallet?.walletAddress ||
    wallet?.address ||
    wallet?.wallet_address ||
    ''
  ).trim()
}

function getDeviceWalletPrivateKey(walletData) {
  if (!walletData || typeof walletData !== 'object') return ''

  return String(
    walletData.privateKey ||
    walletData.private_key ||
    walletData.pk ||
    ''
  ).trim()
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

function setConnectButtonText(text) {
  if (connectBtn) connectBtn.textContent = text
}

async function loadUserTokenBalance() {
  try {
    const walletAddress = getCurrentWalletAddress()

    if (!walletAddress) {
      setConnectButtonText('Sem carteira')
      return
    }

    setConnectButtonText('Carregando saldo...')

    const provider = new JsonRpcProvider(POLYGON_RPC_URL)
    const tokenContract = new Contract(VWALA_TOKEN, ERC20_ABI, provider)

    const [rawBalance, decimals] = await Promise.all([
      tokenContract.balanceOf(walletAddress),
      tokenContract.decimals()
    ])

    const formattedBalance = Number(formatUnits(rawBalance, decimals))
    setConnectButtonText(formatTokenBalance(formattedBalance))
  } catch (error) {
    console.error(`Erro ao carregar saldo ${TOKEN_SYMBOL}:`, error)
    setConnectButtonText(`0,00 ${TOKEN_SYMBOL}`)
  }
}

async function syncWalletProfileFromFirebase() {
  if (!currentGoogleUser?.uid) return

  const userRef = doc(db, 'users', currentGoogleUser.uid)
  const userSnap = await getDoc(userRef)

  if (!userSnap.exists()) return

  const userData = userSnap.data()
  const walletAddress = String(userData.walletAddress || '').trim()

  if (!walletAddress) return

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
          console.error('Erro ao sincronizar Firebase na página de apostas:', error)
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
    console.error('Erro ao iniciar Firebase na página de apostas:', error)
  }
}

function getLocalDeviceWalletForBetting() {
  try {
    const raw = localStorage.getItem(DEVICE_WALLET_STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch (error) {
    console.error('Erro ao ler carteira local da aposta:', error)
    return null
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

  const pin = await showPinModal('Confirmar PIN', 'Digite o PIN da carteira para apostar.')
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
  state.token = state.token.connect(signer)
  state.betting = state.betting.connect(signer)

  return signer
}



async function initWalletSession() {
  try {
    const walletAddress = getCurrentWalletAddress()

    state.provider = new JsonRpcProvider(POLYGON_RPC_URL, POLYGON_CHAIN_ID)
    state.userAddress = walletAddress
    state.signer = null
    state.token = new Contract(VWALA_TOKEN, ERC20_ABI, state.provider)
    state.betting = new Contract(BETTING_ADDRESS, BETTING_ABI, state.provider)
    state.decimals = Number(await state.token.decimals())

    await loadUserTokenBalance()
    state.matches = loadCouponsForMatches(state.matches)
    renderMatches()
  } catch (error) {
    console.error('Erro ao iniciar carteira da página de apostas:', error)
    setConnectButtonText('Sem carteira')
  }
}

async function refreshWalletBalance() {
  await loadUserTokenBalance()
}

async function fetchMatches() {
  const response = await fetch(`${API_BASE}/football-matches`)
  if (!response.ok) {
    throw new Error('Falha ao carregar jogos.')
  }

  const payload = await response.json()
  return Array.isArray(payload.matches) ? payload.matches : []
}

async function hydrateMatch(match) {
  if (!state.betting) {
    return {
      ...match,
      exists: false,
      status: MarketStatus.OPEN,
      hasWinner: false,
      winningOutcome: null,
      probHomeBps: match.probHomeBps || 0,
      probDrawBps: match.probDrawBps || 0,
      probAwayBps: match.probAwayBps || 0,
      poolHome: '0',
      poolDraw: '0',
      poolAway: '0',
      totalPool: '0'
    }
  }

  try {
    const [marketState, probs, pools] = await Promise.all([
      state.betting.getMarketState(match.fixtureId),
      state.betting.getMarketProbabilities(match.fixtureId),
      state.betting.getMarketPools(match.fixtureId)
    ])

    return {
      ...match,
      exists: marketState[0],
      status: Number(marketState[3]),
      hasWinner: marketState[4],
      winningOutcome: Number(marketState[5]),
      probHomeBps: Number(probs[0]),
      probDrawBps: Number(probs[1]),
      probAwayBps: Number(probs[2]),
      poolHome: formatUnits(pools[0], state.decimals || 18),
      poolDraw: formatUnits(pools[1], state.decimals || 18),
      poolAway: formatUnits(pools[2], state.decimals || 18),
      totalPool: formatUnits(pools[3], state.decimals || 18)
    }
  } catch {
    return {
      ...match,
      exists: false,
      status: MarketStatus.OPEN,
      hasWinner: false,
      winningOutcome: null,
      probHomeBps: match.probHomeBps || 0,
      probDrawBps: match.probDrawBps || 0,
      probAwayBps: match.probAwayBps || 0,
      poolHome: '0',
      poolDraw: '0',
      poolAway: '0',
      totalPool: '0'
    }
  }
}

async function loadMatches() {
  try {
    const fetchedMatches = await fetchMatches()

    const rawMatches = fetchedMatches.map((match) => ({
  ...match,
  teamA: cleanTeamName(match.teamA),
  teamB: cleanTeamName(match.teamB),
  ...normalizeMarketProbabilities(match)
}))

    const baseMatches = loadCouponsForMatches(rawMatches)

    if (!state.betting) {
      state.matches = baseMatches
      renderMatches()
      return
    }

    const hydrated = []
    for (const match of baseMatches) {
      hydrated.push(await hydrateMatch(match))
    }

    state.matches = loadCouponsForMatches(hydrated)
    await refreshAllPositions()
    renderMatches()
  } catch (error) {
    console.error(error)
    showAlert('Erro', 'Não foi possível carregar os mercados.')
  }
}

async function refreshAllPositions() {
  if (!state.userAddress || !state.betting) return

  const nextPositions = {}

  for (const match of state.matches) {
    if (!Array.isArray(match.userCoupons)) continue

    for (const couponId of match.userCoupons) {
      try {
        const position = await state.betting.getPosition(
          BigInt(match.fixtureId),
          state.userAddress,
          BigInt(couponId)
        )

        if (position[0]) {
          nextPositions[`${match.fixtureId}:${couponId}`] = {
            exists: position[0],
            fixtureId: Number(position[1]),
            couponId: position[3].toString(),
            outcome: Number(position[4]),
            amount: formatUnits(position[5], state.decimals),
            claimed: position[6],
            claimedAmount: formatUnits(position[7], state.decimals)
          }
        }
      } catch {
        continue
      }
    }
  }

  state.positions = nextPositions
}

function saveCouponId(fixtureId, couponId) {
  const key = `wala_coupons_${state.userAddress.toLowerCase()}`
  const current = JSON.parse(localStorage.getItem(key) || '{}')

  if (!Array.isArray(current[fixtureId])) {
    current[fixtureId] = []
  }

  if (!current[fixtureId].includes(String(couponId))) {
    current[fixtureId].push(String(couponId))
  }

  localStorage.setItem(key, JSON.stringify(current))
}

function loadCouponsForMatches(matches) {
  if (!state.userAddress) {
    return matches.map((match) => ({ ...match, userCoupons: [] }))
  }

  const key = `wala_coupons_${state.userAddress.toLowerCase()}`
  const saved = JSON.parse(localStorage.getItem(key) || '{}')

  return matches.map((match) => ({
    ...match,
    userCoupons: Array.isArray(saved[match.fixtureId]) ? saved[match.fixtureId] : []
  }))
}

async function previewPayout(fixtureId, outcome, amountUi, match = null) {
  const numericAmount = Number(String(amountUi).replace(',', '.'))

  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return null
  }

  if (match && !match.exists) {
    const normalized = normalizeMarketProbabilities(match)

    const probs = {
      [Outcome.HOME]: normalized.probHomeBps,
      [Outcome.DRAW]: normalized.probDrawBps,
      [Outcome.AWAY]: normalized.probAwayBps
    }

    const outcomeProbBps = Number(probs[Number(outcome)] || 0)
    const profit = numericAmount * ((10000 - outcomeProbBps) / 10000)
    const payout = numericAmount + profit

    return {
      payout: String(payout),
      profit: String(profit)
    }
  }

  if (!state.betting) return null

  const amount = parseUnits(String(amountUi).replace(',', '.'), state.decimals)
  const result = await state.betting.previewPayout(BigInt(fixtureId), Number(outcome), amount)

  return {
    payout: formatUnits(result[0], state.decimals),
    profit: formatUnits(result[1], state.decimals)
  }
}

async function ensureMarketExists(match, signer) {
  if (match.exists) return

  const bettingContract = state.betting.connect(signer)
  const normalized = normalizeMarketProbabilities(match)

  try {
    const tx = await bettingContract.createMarket(
      BigInt(match.fixtureId),
      match.league,
      match.teamA,
      match.teamB,
      0,
      normalized.probHomeBps,
      normalized.probDrawBps,
      normalized.probAwayBps
    )

    await tx.wait()
  } catch (error) {
    const text = String(error?.shortMessage || error?.message || error || '').toLowerCase()

    if (!text.includes('marketalreadyexists')) {
      throw error
    }
  }

  match.exists = true
  match.status = MarketStatus.OPEN
  match.hasWinner = false
  match.poolHome = match.poolHome || '0'
  match.poolDraw = match.poolDraw || '0'
  match.poolAway = match.poolAway || '0'
  match.totalPool = match.totalPool || '0'
}

async function approveIfNeeded(amountUi, signer) {
  const amount = parseUnits(String(amountUi).replace(',', '.'), state.decimals)
  const ownerAddress = await signer.getAddress()
  const tokenContract = state.token.connect(signer)
  const allowance = await tokenContract.allowance(ownerAddress, BETTING_ADDRESS)

  if (allowance >= amount) return

  const tx = await tokenContract.approve(BETTING_ADDRESS, amount)
  await tx.wait()
}

async function buyPosition(match, outcome, amountUi, signer) {
  const couponId = generateCouponId(match)
  const amount = parseUnits(String(amountUi).replace(',', '.'), state.decimals)
  const bettingContract = state.betting.connect(signer)

  await approveIfNeeded(amountUi, signer)

  const tx = await bettingContract.buyPosition(
    BigInt(match.fixtureId),
    couponId,
    Number(outcome),
    amount
  )

  await tx.wait()
  saveCouponId(match.fixtureId, couponId.toString())
}

function createPositionBlock() {
  return ''
}

function createCard(match) {
  const card = document.createElement('div')
  card.className = 'match-card inline-market-card'

  card.innerHTML = `
    <div class="match-box inline-match-box">
      <div class="match-league">${match.league}</div>

      <div class="match-teams">
        <div class="team-block">
          <div class="team-badge">A</div>
          <strong>${match.teamA}</strong>
        </div>

        <div class="match-versus">VS</div>

        <div class="team-block">
          <div class="team-badge">B</div>
          <strong>${match.teamB}</strong>
        </div>
      </div>

      <div class="match-time">${match.time || 'Em breve'}</div>
    </div>

    <div class="stats-grid inline-stats-grid">
      <div class="stat-box">
        <span class="stat-label">Prob. ${match.teamA}</span>
        <strong class="stat-value">${bpsToPercentText(match.probHomeBps)}</strong>
      </div>

      <div class="stat-box">
        <span class="stat-label">Empate</span>
        <strong class="stat-value">${bpsToPercentText(match.probDrawBps)}</strong>
      </div>

      <div class="stat-box">
        <span class="stat-label">Prob. ${match.teamB}</span>
        <strong class="stat-value">${bpsToPercentText(match.probAwayBps)}</strong>
      </div>
    </div>

    <div class="market-question inline-market-question force-show">
      <div class="market-mini-status">
        <span class="market-chip pending">${formatStatus(match.status, match.hasWinner)}</span>
        <span class="market-total">Pool ${formatNumber(match.totalPool)} ${TOKEN_SYMBOL}</span>
      </div>

      <div class="market-mini-pools">
        <span>A ${formatNumber(match.poolHome)}</span>
        <span>E ${formatNumber(match.poolDraw)}</span>
        <span>B ${formatNumber(match.poolAway)}</span>
      </div>
    </div>

    <div class="bet-panel">
      <div class="bet-top">
        <div class="selected-outcome-chip js-selected-outcome-chip">Selecione um lado</div>
        <div class="estimated-payout-text js-estimated-payout-text">Retorno estimado: --</div>
      </div>

      <input
        class="input bet-amount-input js-bet-amount-input"
        type="number"
        min="0"
        step="0.01"
        placeholder="Digite o valor da posição"
      />

      <div class="bet-hint-text js-bet-hint-text">
        Digite o valor e escolha um lado.
      </div>
    </div>

    <div class="modal-footer inline-modal-footer">
      <button class="trade js-pick-btn" data-outcome="0" type="button">${match.teamA}</button>
      <button class="trade js-pick-btn" data-outcome="1" type="button">Empate</button>
      <button class="launch js-pick-btn" data-outcome="2" type="button">${match.teamB}</button>
    </div>

    <button class="launch confirm-bet-btn js-confirm-bet-btn" type="button" ${match.exists && Number(match.status) !== MarketStatus.OPEN ? 'disabled' : ''}>
  ${match.exists ? 'Abrir posição' : 'Criar mercado e apostar'}
</button>

  `

  const amountInputEl = card.querySelector('.js-bet-amount-input')
  const hintEl = card.querySelector('.js-bet-hint-text')
  const payoutEl = card.querySelector('.js-estimated-payout-text')
  const outcomeChipEl = card.querySelector('.js-selected-outcome-chip')
  const confirmBtn = card.querySelector('.js-confirm-bet-btn')
  const pickButtons = [...card.querySelectorAll('.js-pick-btn')]

  let selectedOutcome = null

  async function updateInlinePreview() {
    if (selectedOutcome == null) {
      payoutEl.textContent = 'Retorno estimado: --'
      confirmBtn.disabled = true
      return
    }

    if (!state.userAddress) {
      hintEl.textContent = 'Faça login para usar a carteira interna.'
      confirmBtn.disabled = true
      return
    }

    if (!state.betting) {
      hintEl.textContent = 'Mercado indisponível no momento.'
      confirmBtn.disabled = true
      return
    }

    const amountUi = Number(String(amountInputEl.value || '').replace(',', '.'))

    if (!Number.isFinite(amountUi) || amountUi <= 0) {
      payoutEl.textContent = 'Retorno estimado: --'
      confirmBtn.disabled = true
      return
    }

    try {
const projected = await previewPayout(match.fixtureId, selectedOutcome, amountUi, match)

      payoutEl.textContent = `Retorno estimado: ${formatNumber(projected.payout)} ${TOKEN_SYMBOL}`
      hintEl.textContent = `Lucro estimado: ${formatNumber(projected.profit)} ${TOKEN_SYMBOL}`
      confirmBtn.disabled = Number(match.status) !== MarketStatus.OPEN
    } catch (error) {
      payoutEl.textContent = 'Retorno estimado: --'
      hintEl.textContent = getFriendlyError(error)
      confirmBtn.disabled = true
    }
  }

  pickButtons.forEach((btn) => {
    btn.addEventListener('click', async () => {
      selectedOutcome = Number(btn.dataset.outcome)

      outcomeChipEl.textContent = getOutcomeLabel(match, selectedOutcome)

      pickButtons.forEach((item) => {
        item.classList.toggle('active-pick', item === btn)
      })

      await updateInlinePreview()
    })
  })

  amountInputEl.addEventListener('input', updateInlinePreview)

  confirmBtn.addEventListener('click', async () => {
    try {
      if (!state.userAddress) {
        showAlert('Carteira necessária', 'Configure a carteira interna antes de apostar.')
        return
      }

      const signer = await getInternalWalletSigner()

      if (!signer) {
        showAlert('PIN necessário', 'Digite o PIN da carteira interna para apostar.')
        return
      }

      const amountUi = Number(String(amountInputEl.value || '').replace(',', '.'))

      if (!Number.isFinite(amountUi) || amountUi <= 0) {
        showAlert('Valor inválido', 'Digite um valor válido.')
        return
      }

      if (selectedOutcome == null) {
        showAlert('Previsão obrigatória', 'Selecione um lado antes de continuar.')
        return
      }

      confirmBtn.disabled = true

      let createdNow = false

      if (!match.exists) {
        showLoadingModal('Criando mercado', 'Aguarde enquanto o mercado é criado na Polygon.')
        await ensureMarketExists(match, signer)
        createdNow = true
      }

      showLoadingModal('Abrindo posição', 'Aguarde enquanto sua aposta é enviada para a Polygon.')

      await buyPosition(match, selectedOutcome, amountUi, signer)

      hideLoadingModal()

      showAlert(
        'Sucesso',
        createdNow
          ? 'Mercado criado e posição aberta com sucesso.'
          : 'Posição aberta com sucesso.'
      )

      await refreshWalletBalance()
      state.matches = loadCouponsForMatches(state.matches)
      await refreshAllPositions()
      renderMatches()
    } catch (error) {
      hideLoadingModal()
      showAlert('Erro', getFriendlyError(error))
    } finally {
      confirmBtn.disabled = false
    }
  })



  return card
}

function renderMatches() {
  const term = searchInput.value.trim().toLowerCase()

  const filtered = state.matches.filter((match) => {
    const text = `${match.league} ${match.teamA} ${match.teamB}`.toLowerCase()
    return text.includes(term)
  })

  marketGrid.innerHTML = ''
  filtered.forEach((match) => {
    marketGrid.appendChild(createCard(match))
  })

  marketCount.textContent = String(filtered.length)
  marketEmpty.classList.toggle('show', filtered.length === 0)
}

async function boot() {
  menuBtn.addEventListener('click', openSidebar)
  sidebarOverlay.addEventListener('click', closeSidebar)

  connectBtn.addEventListener('click', async () => {
    await loadUserTokenBalance()
  })

  searchInput.addEventListener('input', renderMatches)
  closeAppNoticeBtn.addEventListener('click', closeAlert)
  appNoticeConfirmBtn.addEventListener('click', closeAlert)
  appNoticeOverlay.addEventListener('click', closeAlert)

  closeAppPinBtn.addEventListener('click', () => closePinModal(null))
  appPinCancelBtn.addEventListener('click', () => closePinModal(null))
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
  await loadMatches()
}

boot()