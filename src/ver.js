import './style/style.css'
import { auth, db } from './firebase'
import {
  browserLocalPersistence,
  onAuthStateChanged,
  setPersistence
} from 'firebase/auth'
import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  serverTimestamp,
  query, 
  where, 
  orderBy, 
  limit 
} from 'firebase/firestore'
import { JsonRpcProvider, Wallet, Contract, Interface, formatUnits, parseUnits } from 'ethers'

const POLYGON_CHAIN_ID = Number(import.meta.env.VITE_POLYGON_CHAIN_ID || 137)
const POLYGON_RPC_PRIMARY_URL = new URL('/api/rpc', window.location.origin).toString()
const POLYGON_RPC_FALLBACK_URL = new URL('/api/rpc-fallback', window.location.origin).toString()
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

        <section id="marketLoadingCard" class="card market-loading-card">
          <div class="market-loading-card-inner">
            <div class="market-loading-spinner"></div>
            <p class="market-loading-title">Carregando mercados</p>
            <p class="market-loading-text">Buscando jogos e preparando os mercados para você.</p>
          </div>
        </section>

        <section id="marketSearchCard" class="card" style="display:none;">
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
    <div class="card modal-card notice-modal-card app-pin-modal-card">
      <div class="modal-header app-pin-modal-header">
        <div class="app-pin-modal-brand">
          <div class="app-pin-modal-badge">W</div>
          <div class="app-pin-modal-headings">
            <h3 id="appPinTitle">Confirmar PIN</h3>
            <span class="app-pin-modal-subtitle">Segurança da carteira</span>
          </div>
        </div>
        <button class="modal-close app-pin-modal-close" id="closeAppPinBtn" type="button">✕</button>
      </div>

      <div class="notice-modal-body app-pin-modal-body">
        <p id="appPinText" class="notice-modal-text app-pin-modal-text">
          Digite o PIN da carteira para apostar.
        </p>

        <div class="app-pin-input-wrap">
          <input
            id="appPinInput"
            class="input app-pin-input"
            type="password"
            placeholder="Digite seu PIN"
            autocomplete="current-password"
          />
        </div>
      </div>

      <div class="notice-modal-footer app-pin-actions app-pin-modal-footer">
        <button id="appPinConfirmBtn" class="notice-confirm-btn app-pin-confirm-btn" type="button">Confirmar</button>
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
const marketLoadingCard = document.getElementById('marketLoadingCard')
const marketSearchCard = document.getElementById('marketSearchCard')
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

function resetPinModalState() {
  appPinTitle.textContent = 'Confirmar PIN'
  appPinText.textContent = 'Digite o PIN da carteira para apostar.'
  appPinText.style.color = '#cfd6df'
  appPinConfirmBtn.textContent = 'Confirmar'
  appPinInput.value = ''
  appPinInput.disabled = false
  appPinConfirmBtn.disabled = false
}

function setPinModalError() {
  appPinTitle.textContent = 'PIN inválido'
  appPinText.textContent = 'PIN errado ou não cadastrado. Vá até a página de swap e crie um novo.'
  appPinText.style.color = '#ff7b7b'
  appPinConfirmBtn.textContent = 'Tentar novamente'
  appPinInput.value = ''
  appPinInput.disabled = false
  appPinConfirmBtn.disabled = false

  setTimeout(() => {
    appPinInput.focus()
  }, 0)
}

function openPinModal(title, text) {
  resetPinModalState()
  appPinTitle.textContent = title
  appPinText.textContent = text
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

function getOutcomeLabel(match, outcome) {
  if (Number(outcome) === Outcome.HOME) return match.teamA
  if (Number(outcome) === Outcome.DRAW) return 'Empate'
  if (Number(outcome) === Outcome.AWAY) return match.teamB
  return 'Selecione um lado'
}

function cleanTeamName(name = '') {
  return String(name || '')
    .replace(/^\b(SC|EC|FC|AC|AFC|SAF|SE|AA)\b\s+/i, '')
    .replace(/\s+\b(SC|EC|FC|AC|AFC|SAF|SE|AA|FBPA|FBC)\b$/i, '')
    .replace(/\s+\b(Paulista)\b$/i, '')
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

function getKickoffDate(match = {}) {
  const rawValue =
    match.utcDate ||
    match.kickoffAt ||
    match.matchDate ||
    match.startsAt ||
    match.date ||
    ''

  if (!rawValue) {
    return null
  }

  const parsed = new Date(rawValue)

  if (!Number.isFinite(parsed.getTime())) {
    return null
  }

  return parsed
}

function getKickoffLabel(match = {}) {
  const kickoffDate = getKickoffDate(match)

  if (!kickoffDate) {
    return match.time || 'Em breve'
  }

  return kickoffDate.toLocaleString('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short'
  })
}

function getLeaguePriority(match = {}) {
  const league = String(match.league || '').toLowerCase()

  if (league.includes('brasileir')) return 0
  if (league.includes('premier')) return 1
  return 2
}

function sortMatchesForDisplay(matches = []) {
  return [...matches].sort((a, b) => {
    const leagueDiff = getLeaguePriority(a) - getLeaguePriority(b)

    if (leagueDiff !== 0) {
      return leagueDiff
    }

    const aKickoff = getKickoffDate(a)?.getTime() ?? Number.MAX_SAFE_INTEGER
    const bKickoff = getKickoffDate(b)?.getTime() ?? Number.MAX_SAFE_INTEGER

    if (aKickoff !== bKickoff) {
      return aKickoff - bKickoff
    }

    return String(a.teamA || '').localeCompare(String(b.teamA || ''), 'pt-BR')
  })
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
    const currentUid = String(currentGoogleUser?.uid || '').trim()
    const deviceWallet = getLocalDeviceWalletForBetting()

    if (deviceWallet?.walletAddress) {
      const deviceUid = String(deviceWallet?.uid || '').trim()

      if (!currentUid || !deviceUid || deviceUid === currentUid) {
        return deviceWallet
      }
    }

    const rawProfile = localStorage.getItem('vwala_wallet_profile')
    if (!rawProfile) return null

    const parsedProfile = JSON.parse(rawProfile)
    const profileUid = String(parsedProfile?.uid || '').trim()

    if (
      parsedProfile?.walletAddress &&
      (!currentUid || !profileUid || profileUid === currentUid)
    ) {
      return parsedProfile
    }

    return null
  } catch (error) {
    console.error('Erro ao ler carteira local:', error)
    return null
  }
}

function resolveActiveWalletAddress() {
  return String(state.userAddress || '').trim()
}

function getCurrentWalletAddress() {
  return resolveActiveWalletAddress()
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
    `apostas_vwala_migration_${userId}`
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

async function saveConfirmedSpendVWalaToFirebase({
  userId,
  walletAddress,
  amount,
  txHash,
  historyType = 'football_bet'
}) {
  const normalizedTxHash = sanitizeTxHashForDoc(txHash)
  const amountRaw = parseVWalaUnits(amount)

  if (!userId) {
    throw new Error('userId ausente para salvar débito.')
  }

  if (!normalizedTxHash) {
    throw new Error('txHash ausente para salvar débito.')
  }

  if (amountRaw <= 0n) {
    throw new Error('amount inválido para salvar débito.')
  }

  const balanceRef = getSwapBalanceDocRef(userId, 'vwala')
  const balanceSnap = await getDoc(balanceRef)
  const currentData = balanceSnap.exists() ? balanceSnap.data() || {} : {}

  const currentBalanceRaw =
    currentData.balanceRaw != null
      ? BigInt(String(currentData.balanceRaw))
      : parseVWalaUnits(currentData.balanceFormatted || currentData.balance || '0')

  const nextBalanceRaw = currentBalanceRaw - amountRaw
  const amountFormatted = formatVWalaUnits(amountRaw)

  if (nextBalanceRaw > 0n) {
    const nextBalanceFormatted = formatVWalaUnits(nextBalanceRaw)

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
  } else {
    await deleteDoc(balanceRef)
  }

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

function createRpcProbeUrl(baseUrl, label = 'apostas_runtime') {
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

  console.groupCollapsed(`[APOSTAS_VWALA_RPC_PROBES] ${label} round=${round}`)
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

async function loadUserTokenBalance() {
  const readId = ++balanceReadCounter
  const groupLabel = `[APOSTAS_VWALA_FIREBASE_BALANCE_READ_${readId}]`

  console.groupCollapsed(groupLabel)

  try {
    const walletAddress = resolveActiveWalletAddress()
    state.userAddress = walletAddress

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
  } finally {
    console.groupEnd()
  }
}

async function syncWalletProfileFromFirebase() {
  if (!currentGoogleUser?.uid) {
    state.userAddress = ''
    return
  }

  const currentUid = String(currentGoogleUser.uid).trim()
  const userRef = doc(db, 'users', currentGoogleUser.uid)
  const userSnap = await getDoc(userRef)

  if (!userSnap.exists()) {
    state.userAddress = ''
    localStorage.removeItem('vwala_wallet_profile')
    return
  }

  const userData = userSnap.data()
  const existingDeviceWallet = getLocalDeviceWalletForBetting()
  const localDeviceUid = String(existingDeviceWallet?.uid || '').trim()
  let walletAddress = ''

  if (userData?.walletKeystoreCloud) {
    try {
      const unlockedWallet = await Wallet.fromEncryptedJson(
        userData.walletKeystoreCloud,
        `vwala_google_device_pin_v1:${currentUid}`
      )

      walletAddress = String(unlockedWallet.address || '').trim()
    } catch (error) {
      console.error('Erro ao resolver wallet pelo keystore cloud na página de apostas:', error)
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
      uid: currentUid,
      walletAddress,
      chainId: userData.chainId || POLYGON_CHAIN_ID,
      network: userData.network || 'polygon'
    })
  )

  state.userAddress = walletAddress

  console.log('[APOSTAS_WALLET_RESOLUTION]', {
    currentUid,
    walletAddress,
    deviceWalletAddress: String(existingDeviceWallet?.walletAddress || '').trim(),
    firestoreWalletAddress: String(userData?.walletAddress || '').trim()
  })
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
    showAlert('Carteira não encontrada', 'Nenhum PIN cadastrado para esta carteira. Vá até a página de swap e crie um novo.')
    return null
  }

  const expectedAddress = getCurrentWalletAddress().trim().toLowerCase()
  const vaultAddress = String(deviceVault.walletAddress || '').trim().toLowerCase()

  if (!expectedAddress || !vaultAddress || expectedAddress !== vaultAddress) {
    showAlert('Carteira incompatível', 'A carteira local não corresponde à carteira logada. Vá até a página de swap e crie um novo PIN.')
    return null
  }

  while (true) {
    const pin = await showPinModal('Confirmar PIN', 'Digite o PIN da carteira para apostar.')

    if (pin === null) {
      return null
    }

    if (!pin.trim()) {
      setPinModalError()
      continue
    }

    try {
      appPinInput.disabled = true
      appPinConfirmBtn.disabled = true
      appPinConfirmBtn.textContent = 'Validando...'

      const unlockedWallet = await Wallet.fromEncryptedJson(
        deviceVault.walletKeystoreLocal,
        pin.trim()
      )

      const signer = unlockedWallet.connect(state.provider)

      state.signer = signer
      state.token = state.token.connect(signer)
      state.betting = state.betting.connect(signer)

      closePinModal(pin.trim())
      return signer
    } catch (error) {
      console.error('Erro ao desbloquear carteira pelo PIN:', error)
      setPinModalError()
    }
  }
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

    await ensureFootballCouponsLoaded()
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

//================== FUNÇÃO OTIMIZADA - FRONTEND ====================
async function fetchMatches() {
  try {
    console.log("📡 Verificando jogos no Firebase...");

    const agora = new Date().toISOString();

    const q = query(
      collection(db, 'football_matches'),
      where('utcDate', '>=', agora),
      orderBy('utcDate', 'asc'),
      limit(120)
    );

    const snapshot = await getDocs(q);
    let firebaseMatches = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    console.log(`📥 Firebase retornou ${firebaseMatches.length} jogos`);

    // Se tiver menos de 15 jogos, força o sync
    if (firebaseMatches.length < 15) {
      console.log("🔄 Poucos jogos no Firebase, chamando sync...");
      
      const syncResponse = await fetch(`${API_BASE}/sync-football`);
      if (syncResponse.ok) {
        const syncResult = await syncResponse.json();
        console.log(`✅ Sync executado: ${syncResult.syncedMatches || 0} jogos`);
      }

      // Recarrega do Firebase após sync
      const newSnapshot = await getDocs(q);
      firebaseMatches = newSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
    }

    return firebaseMatches;

  } catch (error) {
    console.error('Erro ao carregar jogos:', error);
    return [];
  }
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
  setMarketLoading(true)

  try {
    await ensureFootballCouponsLoaded()

    const fetchedMatches = await fetchMatches()

    const rawMatches = fetchedMatches.map((match) => ({
      ...match,
      teamA: cleanTeamName(match.teamA),
      teamB: cleanTeamName(match.teamB),
      ...normalizeMarketProbabilities(match)
    }))

    const baseMatches = loadCouponsForMatches(rawMatches)

    if (!state.betting) {
      state.matches = sortMatchesForDisplay(baseMatches)
      renderMatches()
      return
    }

    const hydrated = await Promise.all(
      baseMatches.map((match) => hydrateMatch(match))
    )

    state.matches = sortMatchesForDisplay(loadCouponsForMatches(hydrated))
    await refreshAllPositions()
    await reconcileLocalFootballPositionsToFirebase()
    await flushPendingFootballPositionsToFirebase()
    renderMatches()
  } catch (error) {
    console.error(error)
    showAlert('Erro', 'Não foi possível carregar os mercados.')
  } finally {
    setMarketLoading(false)
    renderMatches()
  }
}

async function refreshAllPositions() {
  if (!state.userAddress || !state.betting) return

  const nextPositions = {}
  const requests = []

  for (const match of state.matches) {
    if (!Array.isArray(match.userCoupons)) continue

    for (const couponId of match.userCoupons) {
      requests.push(
        state.betting.getPosition(
          BigInt(match.fixtureId),
          state.userAddress,
          BigInt(couponId)
        )
          .then((position) => ({
            ok: true,
            match,
            couponId,
            position
          }))
          .catch(() => ({
            ok: false
          }))
      )
    }
  }

  const results = await Promise.all(requests)

  for (const result of results) {
    if (!result.ok) continue

    const { match, couponId, position } = result

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

function upsertLocalFootballPosition(match, payload) {
  const fixtureId = String(match?.fixtureId || '').trim()
  const couponId = String(payload?.couponId || '').trim()

  if (!fixtureId || !couponId) {
    return
  }

  const items = readLocalFootballPositions()
  const docId = getFootballPositionDocId(fixtureId, couponId)
  const existing = items.find((item) => String(item?.docId || '') === docId)

  const nextItem = {
    docId,
    fixtureId,
    couponId,
    walletAddress: String(state.userAddress || '').trim().toLowerCase(),
    league: String(match?.league || 'Futebol'),
    teamA: String(match?.teamA || ''),
    teamB: String(match?.teamB || ''),
    outcome: Number(payload?.outcome),
    amountUi: String(payload?.amountUi || '0'),
    txHash: String(payload?.txHash || ''),
    claimed: Boolean(payload?.claimed || false),
    statusCache: String(payload?.statusCache || 'open'),
    createdAt: existing?.createdAt || Date.now(),
    updatedAt: Date.now()
  }

  const filtered = items.filter((item) => String(item?.docId || '') !== docId)
  filtered.push(nextItem)
  writeLocalFootballPositions(filtered)
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

function savePendingFootballPositionLocally(match, payload) {
  const fixtureId = String(match?.fixtureId || '').trim()
  const couponId = String(payload?.couponId || '').trim()

  if (!fixtureId || !couponId) {
    return
  }

  const items = readPendingFootballPositions()
  const docId = getFootballPositionDocId(fixtureId, couponId)
  const existing = items.find((item) => String(item?.docId || '') === docId)

  const nextItem = {
    docId,
    fixtureId,
    couponId,
    walletAddress: String(state.userAddress || '').trim().toLowerCase(),
    league: String(match?.league || 'Futebol'),
    teamA: String(match?.teamA || ''),
    teamB: String(match?.teamB || ''),
    outcome: Number(payload?.outcome),
    amountUi: String(payload?.amountUi || '0'),
    txHash: String(payload?.txHash || ''),
    retryCount: Number(existing?.retryCount || 0),
    lastAttemptAt: Number(existing?.lastAttemptAt || 0),
    createdAt: Number(existing?.createdAt || Date.now())
  }

  const filtered = items.filter((item) => String(item?.docId || '') !== docId)
  filtered.push(nextItem)
  writePendingFootballPositions(filtered)
}

function markPendingFootballPositionAttempt(fixtureId, couponId) {
  const docId = getFootballPositionDocId(fixtureId, couponId)
  const items = readPendingFootballPositions()

  const nextItems = items.map((item) => {
    if (String(item?.docId || '') !== docId) {
      return item
    }

    return {
      ...item,
      retryCount: Number(item?.retryCount || 0) + 1,
      lastAttemptAt: Date.now()
    }
  })

  writePendingFootballPositions(nextItems)
}

function removePendingFootballPositionLocally(fixtureId, couponId) {
  const docId = getFootballPositionDocId(fixtureId, couponId)
  const items = readPendingFootballPositions()
  const filtered = items.filter((item) => String(item?.docId || '') !== docId)
  writePendingFootballPositions(filtered)
}

function removeCouponId(fixtureId, couponId) {
  if (!state.userAddress) {
    return
  }

  const key = `wala_coupons_${state.userAddress.toLowerCase()}`
  const current = JSON.parse(localStorage.getItem(key) || '{}')

  if (!Array.isArray(current[fixtureId])) {
    return
  }

  current[fixtureId] = current[fixtureId].filter((item) => String(item) !== String(couponId))

  if (!current[fixtureId].length) {
    delete current[fixtureId]
  }

  localStorage.setItem(key, JSON.stringify(current))
}

async function deleteFootballPositionFromFirebase(fixtureId, couponId) {
  return
}

async function finalizeFootballPositionCleanup(fixtureId, couponId) {
  removePendingFootballPositionLocally(fixtureId, couponId)
  removeLocalFootballPosition(fixtureId, couponId)
  removeCouponId(fixtureId, couponId)

  delete state.positions[`${fixtureId}:${couponId}`]
}

function restoreCouponsFromLocalFootballPositions() {
  if (!state.userAddress) {
    return
  }

  const walletAddress = String(state.userAddress || '').trim().toLowerCase()
  const items = readLocalFootballPositions().filter(
    (item) => String(item?.walletAddress || '').trim().toLowerCase() === walletAddress
  )

  if (!items.length) {
    return
  }

  const key = `wala_coupons_${walletAddress}`
  const current = JSON.parse(localStorage.getItem(key) || '{}')

  for (const item of items) {
    const fixtureId = String(item?.fixtureId || '').trim()
    const couponId = String(item?.couponId || '').trim()

    if (!fixtureId || !couponId) {
      continue
    }

    if (!Array.isArray(current[fixtureId])) {
      current[fixtureId] = []
    }

    if (!current[fixtureId].includes(couponId)) {
      current[fixtureId].push(couponId)
    }
  }

  localStorage.setItem(key, JSON.stringify(current))
}

async function flushPendingFootballPositionsToFirebase() {
  if (!currentGoogleUser?.uid || !state.userAddress) {
    return
  }

  const items = readPendingFootballPositions()

  if (!items.length) {
    return
  }

  for (const item of items) {
    try {
      await saveFootballPositionToFirebase(
        {
          fixtureId: item.fixtureId,
          league: item.league,
          teamA: item.teamA,
          teamB: item.teamB
        },
        {
          couponId: item.couponId,
          outcome: item.outcome,
          amountUi: item.amountUi,
          txHash: item.txHash
        }
      )

      upsertLocalFootballPosition(
        {
          fixtureId: item.fixtureId,
          league: item.league,
          teamA: item.teamA,
          teamB: item.teamB
        },
        {
          couponId: item.couponId,
          outcome: item.outcome,
          amountUi: item.amountUi,
          txHash: item.txHash,
          statusCache: 'open'
        }
      )

      removePendingFootballPositionLocally(item.fixtureId, item.couponId)
    } catch (error) {
      markPendingFootballPositionAttempt(item.fixtureId, item.couponId)
      console.error('Erro ao sincronizar pendência local de futebol:', error)
    }
  }
}

async function reconcileLocalFootballPositionsToFirebase() {
  if (!currentGoogleUser?.uid || !state.userAddress) {
    return
  }

  const walletAddress = String(state.userAddress || '').trim().toLowerCase()
  const items = readLocalFootballPositions().filter(
    (item) => String(item?.walletAddress || '').trim().toLowerCase() === walletAddress
  )

  if (!items.length) {
    return
  }

  for (const item of items) {
    try {
      await saveFootballPositionToFirebase(
        {
          fixtureId: item.fixtureId,
          league: item.league,
          teamA: item.teamA,
          teamB: item.teamB
        },
        {
          couponId: item.couponId,
          outcome: item.outcome,
          amountUi: item.amountUi,
          txHash: item.txHash
        }
      )
    } catch (error) {
      console.error('Erro ao reconciliar posição local de futebol com Firebase:', error)
    }
  }
}

async function saveFootballPositionToFirebase(match, payload) {
  if (!currentGoogleUser?.uid || !state.userAddress) {
    return
  }

  const fixtureId = String(match?.fixtureId || '').trim()
  const couponId = String(payload?.couponId || '').trim()

  if (!fixtureId || !couponId) {
    return
  }

  const positionRef = doc(
    db,
    'users',
    currentGoogleUser.uid,
    'football_positions',
    getFootballPositionDocId(fixtureId, couponId)
  )

  const currentSnap = await getDoc(positionRef)
  const currentData = currentSnap.exists() ? currentSnap.data() || {} : {}

  await setDoc(
    positionRef,
    {
      fixtureId,
      couponId,
      walletAddress: String(state.userAddress || '').trim().toLowerCase(),
      league: String(match?.league || 'Futebol'),
      teamA: String(match?.teamA || ''),
      teamB: String(match?.teamB || ''),
      outcome: Number(payload?.outcome),
      amount: String(payload?.amountUi || '0'),
      txHash: String(payload?.txHash || ''),
      claimed: Boolean(currentData.claimed || false),
      statusCache: String(currentData.statusCache || 'open'),
      updatedAt: serverTimestamp(),
      createdAt: currentData.createdAt || serverTimestamp()
    },
    { merge: true }
  )
}

function getFootballCouponsStorageKey() {
  const walletAddress = String(state.userAddress || '').trim().toLowerCase()
  return `wala_coupons_${walletAddress}`
}

function getSavedFootballCouponEntriesFromLocal() {
  if (!state.userAddress) {
    return []
  }

  try {
    const saved = JSON.parse(localStorage.getItem(getFootballCouponsStorageKey()) || '{}')
    const entries = []

    for (const [fixtureId, coupons] of Object.entries(saved)) {
      if (!Array.isArray(coupons)) continue

      for (const couponId of coupons) {
        entries.push({
          fixtureId: String(fixtureId),
          couponId: String(couponId)
        })
      }
    }

    return entries.sort((a, b) => Number(b.fixtureId) - Number(a.fixtureId))
  } catch (error) {
    console.error('Erro ao ler bilhetes locais de futebol:', error)
    return []
  }
}

function restoreFootballCouponsToLocalStorage(entries = []) {
  if (!state.userAddress || !entries.length) {
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

  localStorage.setItem(getFootballCouponsStorageKey(), JSON.stringify(next))
}

async function getSavedFootballCouponEntriesFromFirebase() {
  if (!currentGoogleUser?.uid) {
    return []
  }

  try {
    const snapshot = await getDocs(
      collection(db, 'users', currentGoogleUser.uid, 'football_positions')
    )

    const walletAddress = String(state.userAddress || '').trim().toLowerCase()
    const entries = []
    const dedupe = new Set()

    snapshot.forEach((docSnap) => {
      const data = docSnap.data() || {}
      const fixtureId = String(data.fixtureId || '').trim()
      const couponId = String(data.couponId || '').trim()
      const positionWallet = String(data.walletAddress || '').trim().toLowerCase()
      const uniqueKey = `${fixtureId}:${couponId}`

      if (!fixtureId || !couponId) return
      if (walletAddress && positionWallet && positionWallet !== walletAddress) return
      if (dedupe.has(uniqueKey)) return

      dedupe.add(uniqueKey)
      entries.push({
        fixtureId,
        couponId
      })
    })

    return entries.sort((a, b) => Number(b.fixtureId) - Number(a.fixtureId))
  } catch (error) {
    console.error('Erro ao ler bilhetes do Firebase:', error)
    return []
  }
}

async function ensureFootballCouponsLoaded() {
  restoreCouponsFromLocalFootballPositions()

  const localEntries = getSavedFootballCouponEntriesFromLocal()
  if (localEntries.length) {
    return localEntries
  }

  const firebaseEntries = await getSavedFootballCouponEntriesFromFirebase()

  if (firebaseEntries.length) {
    restoreFootballCouponsToLocalStorage(firebaseEntries)
  }

  return firebaseEntries
}

function loadCouponsForMatches(matches) {
  if (!state.userAddress) {
    return matches.map((match) => ({ ...match, userCoupons: [] }))
  }

  const saved = JSON.parse(localStorage.getItem(getFootballCouponsStorageKey()) || '{}')

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

async function ensureMarketExists(match) {
  if (match.exists) return

  const normalized = normalizeMarketProbabilities(match)

  const response = await fetch(`${API_BASE}/create-football-market`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      fixtureId: String(match.fixtureId),
      league: String(match.league || 'Futebol'),
      teamA: String(match.teamA || 'Time A'),
      teamB: String(match.teamB || 'Time B'),
      feeBps: 0,
      homeProbBps: Number(normalized.probHomeBps),
      drawProbBps: Number(normalized.probDrawBps),
      awayProbBps: Number(normalized.probAwayBps)
    })
  })

  let result = {}

  try {
    result = await response.json()
  } catch {
    result = {}
  }

  if (!response.ok || result?.ok === false) {
    throw new Error(result?.error || 'Não foi possível criar o mercado.')
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

  const receipt = await tx.wait()
  const confirmedTxHash = String(receipt?.hash || tx?.hash || '')

  if (!confirmedTxHash) {
    throw new Error('Previsão confirmada sem tx hash.')
  }

  if (currentGoogleUser?.uid) {
    await saveConfirmedSpendVWalaToFirebase({
      userId: currentGoogleUser.uid,
      walletAddress: await signer.getAddress(),
      amount: amountUi,
      txHash: confirmedTxHash,
      historyType: 'football_bet'
    })
  }

  saveCouponId(match.fixtureId, couponId.toString())

  return {
    couponId: couponId.toString(),
    txHash: confirmedTxHash
  }
}

function createPositionBlock() {
  return ''
}

function createCard(match) {
  const card = document.createElement('div')
  card.className = 'match-card inline-market-card'

  const displayProbabilities = normalizeMarketProbabilities(match)

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

      <div class="match-time">${getKickoffLabel(match)}</div>
    </div>

    <div class="stats-grid inline-stats-grid">
      <div class="stat-box">
  <span class="stat-label">${match.teamA}</span>
  <strong class="stat-value">${bpsToPercentText(displayProbabilities.probHomeBps)}</strong>
</div>

<div class="stat-box">
  <span class="stat-label">Empate</span>
  <strong class="stat-value">${bpsToPercentText(displayProbabilities.probDrawBps)}</strong>
</div>

<div class="stat-box">
  <span class="stat-label">${match.teamB}</span>
  <strong class="stat-value">${bpsToPercentText(displayProbabilities.probAwayBps)}</strong>
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
  ${match.exists ? 'Abrir posição' : 'Criar mercado e prever'}
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
        showAlert('Carteira necessária', 'Configure a carteira interna antes de enviar a previsão.')
        return
      }

      const signer = await getInternalWalletSigner()

      if (!signer) {
        showAlert('PIN necessário', 'Digite o PIN da carteira interna para confirmar a previsão.')
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
        await ensureMarketExists(match)
        createdNow = true
      }

      showLoadingModal('Abrindo posição', 'Aguarde enquanto sua previsão é enviada para a Polygon.')

      const positionResult = await buyPosition(match, selectedOutcome, amountUi, signer)

upsertLocalFootballPosition(match, {
  couponId: positionResult.couponId,
  outcome: selectedOutcome,
  amountUi,
  txHash: positionResult.txHash,
  statusCache: 'open'
})

hideLoadingModal()

try {
  await saveFootballPositionToFirebase(match, {
    couponId: positionResult.couponId,
    outcome: selectedOutcome,
    amountUi,
    txHash: positionResult.txHash
  })

  removePendingFootballPositionLocally(match.fixtureId, positionResult.couponId)
} catch (firebaseError) {
  console.error('Erro ao salvar posição de futebol no Firebase:', firebaseError)

  savePendingFootballPositionLocally(match, {
    couponId: positionResult.couponId,
    outcome: selectedOutcome,
    amountUi,
    txHash: positionResult.txHash
  })
}

showAlert(
  'Sucesso',
  createdNow
    ? 'Mercado criado e posição aberta com sucesso.'
    : 'Posição aberta com sucesso.'
)

await ensureFootballCouponsLoaded()
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

function setMarketLoading(isLoading) {
  state.loading = Boolean(isLoading)

  if (marketLoadingCard) {
    marketLoadingCard.style.display = state.loading ? 'block' : 'none'
  }

  if (marketSearchCard) {
    marketSearchCard.style.display = state.loading ? 'none' : 'block'
  }

  if (marketEmpty) {
    marketEmpty.classList.remove('show')
  }
}

function renderMatches() {
  if (state.loading) {
    marketCount.textContent = '...'
    marketGrid.innerHTML = ''
    marketEmpty.classList.remove('show')
    return
  }

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
  setMarketLoading(true)
  marketGrid.innerHTML = ''
  menuBtn.addEventListener('click', openSidebar)
  sidebarOverlay.addEventListener('click', closeSidebar)

  connectBtn.addEventListener('click', async () => {
    await loadUserTokenBalance()
  })

  searchInput.addEventListener('input', renderMatches)
  closeAppNoticeBtn.addEventListener('click', closeAlert)
  appNoticeConfirmBtn.addEventListener('click', closeAlert)
  appNoticeOverlay.addEventListener('click', closeAlert)

  closeAppPinBtn.addEventListener('click', () => {})
  appPinConfirmBtn.addEventListener('click', () => closePinModal(appPinInput.value))
  appPinOverlay.addEventListener('click', () => {})

  appPinInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      closePinModal(appPinInput.value)
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
    }
  })

  await initFirebaseSession()
  await initWalletSession()
  await loadMatches()
}

boot()