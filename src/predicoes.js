import './style/style.css'
import { auth, db } from './firebase'
import {
  browserLocalPersistence,
  onAuthStateChanged,
  setPersistence
} from 'firebase/auth'
import { deleteDoc, doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { JsonRpcProvider, Wallet, Contract, Interface, formatUnits, parseUnits } from 'ethers'

const POLYGON_CHAIN_ID = Number(import.meta.env.VITE_POLYGON_CHAIN_ID || 137)
const POLYGON_RPC_PRIMARY_URL = new URL('/api/rpc', window.location.origin).toString()
const POLYGON_RPC_FALLBACK_URL = new URL('/api/rpc-fallback', window.location.origin).toString()

const DEVICE_WALLET_STORAGE_KEY = 'vwala_device_wallet'
const TOKEN_SYMBOL = import.meta.env.VITE_TOKEN_SYMBOL || 'vWALA'
const VWALA_TOKEN = import.meta.env.VITE_VWALA_TOKEN || '0x7bD1f6f4F5CEf026b643758605737CB48b4B7D83'
const BINARY_PREDICTIONS_ADDRESS =
  import.meta.env.VITE_BINARY_PREDICTIONS_ADDRESS || '0x798474EC1C9f32ca2537bCD4f88d7b422baEE23d'
const API_BASE = '/.netlify/functions'
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

const ERC20_ABI = [
  'function approve(address spender, uint256 value) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)'
]

const PREDICTIONS_ABI = [
  'function previewPayout(uint64 marketId, uint8 side, uint256 amount) external view returns (uint256 payout, uint256 netProfit)',
  'function createMarket(uint64 marketId, string assetSymbol, string question, uint64 closeAt, int256 referencePriceE8, uint16 feeBps, uint16 yesProbBps, uint16 noProbBps) external',
  'function buyPosition(uint64 marketId, uint64 couponId, uint8 side, uint256 amount) external',
  'function claimPosition(uint64 marketId, uint64 couponId) external',
  'function getMarketState(uint64 marketId) external view returns (bool exists, address authority, uint64 storedMarketId, uint8 status, bool hasWinner, uint8 winningSide, uint256 createdAt, uint256 resolvedAt, uint256 closeAt)',
  'function getMarketMeta(uint64 marketId) external view returns (string assetSymbol, string question, int256 referencePriceE8)',
  'function getMarketPools(uint64 marketId) external view returns (uint256 poolYes, uint256 poolNo, uint256 totalPool, uint256 marketDistributed)',
  'function getMarketProbabilities(uint64 marketId) external view returns (uint16 probYesBps, uint16 probNoBps, uint16 feeBps, uint256 feeAmount)',
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
  markets: [],
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
            <span>Predições</span>
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
            <h1>Mercado Binário de Cripto</h1>
            <p class="hero-text">
  Mercados abertos 24h em janelas de 4 horas. Cada ciclo fecha no próximo bloco de 4h.
</p>
          </div>

          <div class="hero-stats">
            <div class="stat-box">
              <span>Mercado</span>
              <strong>Sim / Não</strong>
            </div>

            <div class="stat-box">
              <span>Fechamento</span>
              <strong>4 em 4h</strong>
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
            <p class="market-loading-text">Buscando mercados de cripto e preparando as previsões para você.</p>
          </div>
        </section>

        <section id="marketSearchCard" class="card" style="display:none;">
          <div class="section-head">
            <div>
              <p class="section-kicker">BUSCA</p>
              <h2>Mercados de cripto</h2>
            </div>
            <span class="section-count" id="marketCount">0</span>
          </div>

          <input
            id="searchInput"
            class="input"
            type="text"
            placeholder="Buscar por ativo ou pergunta"
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
        <p id="appPinText" class="notice-modal-text">Digite o PIN da carteira para abrir posição.</p>
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

async function showPinModal(
  title = 'Confirmar PIN',
  text = 'Digite o PIN da carteira para abrir posição.'
) {
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

function formatNumber(value, digits = 2) {
  const num = Number(value || 0)

  if (!Number.isFinite(num)) return '0'

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
    `predicoes_vwala_migration_${userId}`
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
  historyType = 'prediction_buy'
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

function formatUsd(value) {
  const num = Number(value || 0)

  if (!Number.isFinite(num)) return '--'

  return num.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
}

function formatUnixDateTime(timestamp) {
  const value = Number(timestamp || 0)

  if (!value) return '--'

  return new Date(value * 1000).toLocaleString('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short'
  })
}

function formatCountdown(closeAt) {
  const now = Math.floor(Date.now() / 1000)
  const diff = Number(closeAt || 0) - now

  if (diff <= 0) return 'Fechado'

  const hours = Math.floor(diff / 3600)
  const minutes = Math.floor((diff % 3600) / 60)

  return `${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m`
}

function getCloseStatus(status, hasWinner, closeAt) {
  if (Number(status) === MarketStatus.RESOLVED && hasWinner) return 'RESOLVIDO'
  if (Number(status) === MarketStatus.CLOSED) return 'FECHADO'

  const now = Math.floor(Date.now() / 1000)
  if (Number(closeAt || 0) <= now) return 'FECHADO'

  return 'ABERTO'
}

function getBinaryStatusLabel(market) {
  return getCloseStatus(market.status, market.hasWinner, market.closeAt)
}

function getSideLabel(side) {
  return Number(side) === Side.YES ? 'SIM' : 'NÃO'
}

function getFriendlyError(error) {
  const text = String(error?.shortMessage || error?.message || error || '').toLowerCase()
  const errorName = getPredictionsErrorName(error)

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
  if (errorName === 'InvalidProbabilityConfig') {
    return 'O contrato rejeitou a configuração das probabilidades do mercado.'
  }
  if (errorName === 'PositionAlreadyExists') return 'Essa posição já existe para esse cupom.'
  if (errorName === 'PositionNotFound') return 'Posição não encontrada.'
  if (errorName === 'PositionAlreadyClaimed') return 'Essa posição já foi resgatada.'
  if (errorName === 'NotWinner') return 'Essa posição não venceu.'
  if (errorName === 'MarketNotResolved') return 'Esse mercado ainda não foi resolvido.'
  if (errorName === 'TreasuryInactive') return 'A tesouraria ainda não foi iniciada.'
  if (errorName === 'TreasuryInsufficient') return 'A tesouraria está sem liquidez suficiente.'

  return error?.shortMessage || error?.message || 'Erro ao processar transação.'
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

function setConnectButtonText(text) {
  if (connectBtn) connectBtn.textContent = text
}

function createRpcProbeUrl(baseUrl, label = 'predicoes_runtime') {
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

  console.groupCollapsed(`[PREDICOES_VWALA_RPC_PROBES] ${label} round=${round}`)
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

function isPredictionsConfigured() {
  return Boolean(
    BINARY_PREDICTIONS_ADDRESS &&
    BINARY_PREDICTIONS_ADDRESS !== ZERO_ADDRESS
  )
}

const MARKET_WINDOW_HOURS = 4
const MARKET_ENTRY_BUFFER_MINUTES = 5

function getDailyMarketSchedule(baseDate = new Date()) {
  const base = new Date(baseDate)
  const currentUtcHour = base.getUTCHours()
  const blockStartHour = Math.floor(currentUtcHour / MARKET_WINDOW_HOURS) * MARKET_WINDOW_HOURS
  const blockEndHour = blockStartHour + MARKET_WINDOW_HOURS

  const openAt = new Date(Date.UTC(
    base.getUTCFullYear(),
    base.getUTCMonth(),
    base.getUTCDate(),
    blockStartHour,
    0,
    0,
    0
  ))

  const resolveAt = new Date(Date.UTC(
    base.getUTCFullYear(),
    base.getUTCMonth(),
    base.getUTCDate(),
    blockEndHour,
    0,
    0,
    0
  ))

  const betCloseAt = new Date(resolveAt.getTime() - MARKET_ENTRY_BUFFER_MINUTES * 60 * 1000)

  return {
    openAt,
    betCloseAt,
    resolveAt
  }
}

function getDailyMarketCloseTimestamp(baseDate = new Date()) {
  return Math.floor(getDailyMarketSchedule(baseDate).resolveAt.getTime() / 1000)
}

function getReferencePriceE8(value) {
  const numeric = Number(value || 0)

  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0n
  }

  const targetPrice = numeric * 1.001
  return BigInt(Math.round(targetPrice * 100000000))
}

function generateCouponId(market) {
  const marketPart = BigInt(String(market.marketId || '0'))
  const timePart = BigInt(Date.now())
  const randomPart = BigInt(Math.floor(Math.random() * 1000000))

  const raw = (marketPart << 32n) ^ (timePart << 8n) ^ randomPart
  const couponId = BigInt.asUintN(64, raw)

  return couponId === 0n ? 1n : couponId
}

const MARKET_RULE_VERSION = 'H4_V1'

function buildBinaryMarketId(symbol, closeAt) {
  const seed = `${String(symbol || 'CRYPTO')}_${MARKET_RULE_VERSION}`
    .split('')
    .reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) % 100000, 17)

  return (BigInt(closeAt) * 100000n + BigInt(seed)).toString()
}

function normalizeBinaryProbabilities(market = {}) {
  const rawYes = market.probYesBps ?? market.yesProbBps ?? 5000
  const rawNo = market.probNoBps ?? market.noProbBps ?? 5000

  const yes = Math.round(Number(rawYes))
  const no = Math.round(Number(rawNo))
  const total = yes + no

  if (
    Number.isInteger(yes) &&
    Number.isInteger(no) &&
    yes > 0 &&
    no > 0 &&
    total === 10000
  ) {
    return {
      probYesBps: yes,
      probNoBps: no
    }
  }

  return {
    probYesBps: 5000,
    probNoBps: 5000
  }
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

async function loadUserTokenBalance() {
  const readId = ++balanceReadCounter
  const groupLabel = `[PREDICOES_VWALA_FIREBASE_BALANCE_READ_${readId}]`

  console.groupCollapsed(groupLabel)

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
  } finally {
    console.groupEnd()
  }
}

function getLocalDeviceWalletForPredictions() {
  try {
    const raw = localStorage.getItem(DEVICE_WALLET_STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch (error) {
    console.error('Erro ao ler carteira local da predição:', error)
    return null
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
      console.error('Erro ao resolver wallet pelo keystore cloud na página de predições:', error)
    }
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
          console.error('Erro ao sincronizar Firebase na página de predições:', error)
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
    console.error('Erro ao iniciar Firebase na página de predições:', error)
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

  const pin = await showPinModal('Confirmar PIN', 'Digite o PIN da carteira para abrir posição.')
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
    state.markets = loadCouponsForMarkets(state.markets)
    renderMarkets()
  } catch (error) {
    console.error('Erro ao iniciar carteira da página de predições:', error)
    setConnectButtonText('Sem carteira')
  }
}

async function refreshWalletBalance() {
  await loadUserTokenBalance()
}

function buildFallbackMarkets() {
  const closeAt = getDailyMarketCloseTimestamp()

  const fallbackAssets = [
    { assetSymbol: 'BTC', imageUrl: '/logo.png', referencePriceUsd: 94500, currentPriceUsd: 94500 },
    { assetSymbol: 'ETH', imageUrl: '/logo.png', referencePriceUsd: 3100, currentPriceUsd: 3100 },
    { assetSymbol: 'SOL', imageUrl: '/logo.png', referencePriceUsd: 182, currentPriceUsd: 182 },
    { assetSymbol: 'BNB', imageUrl: '/logo.png', referencePriceUsd: 610, currentPriceUsd: 610 },
    { assetSymbol: 'XRP', imageUrl: '/logo.png', referencePriceUsd: 2.15, currentPriceUsd: 2.15 },
    { assetSymbol: 'ADA', imageUrl: '/logo.png', referencePriceUsd: 0.72, currentPriceUsd: 0.72 },
    { assetSymbol: 'DOGE', imageUrl: '/logo.png', referencePriceUsd: 0.18, currentPriceUsd: 0.18 },
    { assetSymbol: 'TRX', imageUrl: '/logo.png', referencePriceUsd: 0.12, currentPriceUsd: 0.12 },
    { assetSymbol: 'LINK', imageUrl: '/logo.png', referencePriceUsd: 14.5, currentPriceUsd: 14.5 },
    { assetSymbol: 'AVAX', imageUrl: '/logo.png', referencePriceUsd: 27, currentPriceUsd: 27 },
    { assetSymbol: 'DOT', imageUrl: '/logo.png', referencePriceUsd: 6.8, currentPriceUsd: 6.8 },
    { assetSymbol: 'POL', imageUrl: '/logo.png', referencePriceUsd: 0.95, currentPriceUsd: 0.95 },
    { assetSymbol: 'LTC', imageUrl: '/logo.png', referencePriceUsd: 84, currentPriceUsd: 84 },
    { assetSymbol: 'BCH', imageUrl: '/logo.png', referencePriceUsd: 460, currentPriceUsd: 460 },
    { assetSymbol: 'SHIB', imageUrl: '/logo.png', referencePriceUsd: 0.000025, currentPriceUsd: 0.000025 }
  ]

  return fallbackAssets.map((asset) => ({
    marketId: buildBinaryMarketId(asset.assetSymbol, closeAt),
    assetSymbol: asset.assetSymbol,
    imageUrl: asset.imageUrl,
    question: `${asset.assetSymbol} fechará 0,1% acima da referência no fechamento desta janela de 4 horas?`,
    referencePriceUsd: asset.referencePriceUsd,
    currentPriceUsd: asset.currentPriceUsd,
    closeAt,
    ...normalizeBinaryProbabilities({ yesProbBps: 5000, noProbBps: 5000 })
  }))
}

async function fetchMarkets() {
  try {
    const response = await fetch(`${API_BASE}/crypto-markets`, {
      method: 'GET',
      headers: {
        accept: 'application/json'
      }
    })

    if (!response.ok) {
      throw new Error(`Falha ao carregar mercados: ${response.status}`)
    }

    const payload = await response.json()
    const source = Array.isArray(payload.markets) ? payload.markets : []

return source.slice(0, 15).map((market) => {
  const assetSymbol = String(market.assetSymbol || market.symbol || 'CRYPTO').toUpperCase()
  const closeAt = getDailyMarketCloseTimestamp()

  return {
    marketId: String(
      market.marketId || buildBinaryMarketId(assetSymbol, closeAt)
    ),
    assetSymbol,
    imageUrl: String(market.imageUrl || market.logo || market.image || '/logo.png').trim(),
    question: String(
      market.question || `${assetSymbol} fechará 0,1% acima da referência no fechamento desta janela de 4 horas?`
    ),
    referencePriceUsd: Number(market.referencePriceUsd || market.referencePrice || 0),
    currentPriceUsd: Number(market.currentPriceUsd || market.priceUsd || market.referencePriceUsd || 0),
    closeAt,
    ...normalizeBinaryProbabilities(market)
  }
})
  } catch (error) {
    console.error('Erro ao carregar API de mercados cripto:', error)
    return buildFallbackMarkets()
  }
}

async function hydrateMarket(market) {
  if (!state.predictions) {
    return {
      ...market,
      exists: false,
      status: MarketStatus.OPEN,
      hasWinner: false,
      winningSide: null,
      poolYes: '0',
      poolNo: '0',
      totalPool: '0'
    }
  }

  try {
    const [marketState, probs, pools, meta] = await Promise.all([
      state.predictions.getMarketState(BigInt(market.marketId)),
      state.predictions.getMarketProbabilities(BigInt(market.marketId)),
      state.predictions.getMarketPools(BigInt(market.marketId)),
      state.predictions.getMarketMeta(BigInt(market.marketId))
    ])

    const referencePriceFromChain = Number(meta[2]) / 100000000

    return {
      ...market,
      exists: marketState[0],
      status: Number(marketState[3]),
      hasWinner: marketState[4],
      winningSide: Number(marketState[5]),
      closeAt: Number(marketState[8] || market.closeAt),
      assetSymbol: meta[0] || market.assetSymbol,
      question: meta[1] || market.question,
      imageUrl: market.imageUrl || '/logo.png',
      referencePriceUsd: referencePriceFromChain || market.referencePriceUsd,
      probYesBps: Number(probs[0]),
      probNoBps: Number(probs[1]),
      poolYes: formatUnits(pools[0], state.decimals || 18),
      poolNo: formatUnits(pools[1], state.decimals || 18),
      totalPool: formatUnits(pools[2], state.decimals || 18)
    }
  } catch {
    return {
      ...market,
      exists: false,
      status: MarketStatus.OPEN,
      hasWinner: false,
      winningSide: null,
      poolYes: '0',
      poolNo: '0',
      totalPool: '0'
    }
  }
}

async function loadMarkets() {
  setMarketLoading(true)

  try {
    const fetchedMarkets = await fetchMarkets()
    const baseMarkets = loadCouponsForMarkets(fetchedMarkets)

    if (!state.predictions) {
      state.markets = baseMarkets
      renderMarkets()
      return
    }

    const hydrated = await Promise.all(
      baseMarkets.map((market) => hydrateMarket(market))
    )

    state.markets = loadCouponsForMarkets(hydrated)
    renderMarkets()
  } catch (error) {
    console.error(error)
    showAlert('Erro', 'Não foi possível carregar os mercados de predição.')
  } finally {
    setMarketLoading(false)
    renderMarkets()
  }
}

async function refreshAllPositions() {
  if (!state.userAddress || !state.predictions) return

  const nextPositions = {}

  for (const market of state.markets) {
    if (!Array.isArray(market.userCoupons)) continue

    for (const couponId of market.userCoupons) {
      try {
        const position = await state.predictions.getPosition(
          BigInt(market.marketId),
          state.userAddress,
          BigInt(couponId)
        )

        if (position[0]) {
          nextPositions[`${market.marketId}:${couponId}`] = {
            exists: position[0],
            marketId: position[1].toString(),
            couponId: position[3].toString(),
            side: Number(position[4]),
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

function saveCouponId(marketId, couponId) {
  const key = `wala_binary_coupons_${state.userAddress.toLowerCase()}`
  const current = JSON.parse(localStorage.getItem(key) || '{}')

  if (!Array.isArray(current[marketId])) {
    current[marketId] = []
  }

  if (!current[marketId].includes(String(couponId))) {
    current[marketId].push(String(couponId))
  }

  localStorage.setItem(key, JSON.stringify(current))
}

function getBinaryPositionDocId(marketId, couponId) {
  return `${String(marketId).trim()}_${String(couponId).trim()}`
}

async function saveBinaryPositionToFirebase(market, payload) {
  if (!currentGoogleUser?.uid || !state.userAddress) {
    return
  }

  const marketId = String(market?.marketId || '').trim()
  const couponId = String(payload?.couponId || '').trim()

  if (!marketId || !couponId) {
    return
  }

  await setDoc(
    doc(
      db,
      'users',
      currentGoogleUser.uid,
      'binary_positions',
      getBinaryPositionDocId(marketId, couponId)
    ),
    {
      marketId,
      couponId,
      walletAddress: String(state.userAddress || '').trim().toLowerCase(),
      assetSymbol: String(market?.assetSymbol || 'CRYPTO'),
      question: String(market?.question || ''),
      side: Number(payload?.side),
      amount: String(payload?.amountUi || '0'),
      txHash: String(payload?.txHash || ''),
      claimed: false,
      statusCache: 'open',
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp()
    },
    { merge: true }
  )
}

function loadCouponsForMarkets(markets) {
  if (!state.userAddress) {
    return markets.map((market) => ({ ...market, userCoupons: [] }))
  }

  const key = `wala_binary_coupons_${state.userAddress.toLowerCase()}`
  const saved = JSON.parse(localStorage.getItem(key) || '{}')

  return markets.map((market) => ({
    ...market,
    userCoupons: Array.isArray(saved[market.marketId]) ? saved[market.marketId] : []
  }))
}

async function previewPayout(marketId, side, amountUi, market = null) {
  const numericAmount = Number(String(amountUi).replace(',', '.'))

  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return null
  }

  if (market && (!market.exists || !state.predictions)) {
    const normalized = normalizeBinaryProbabilities(market)
    const sideProbBps = Number(
      Number(side) === Side.YES ? normalized.probYesBps : normalized.probNoBps
    )

    const profit = numericAmount * ((10000 - sideProbBps) / 10000)
    const payout = numericAmount + profit

    return {
      payout: String(payout),
      profit: String(profit)
    }
  }

  const amount = parseUnits(String(amountUi).replace(',', '.'), state.decimals)
  const result = await state.predictions.previewPayout(
    BigInt(marketId),
    Number(side),
    amount
  )

  return {
    payout: formatUnits(result[0], state.decimals),
    profit: formatUnits(result[1], state.decimals)
  }
}

function marketIsClosedByTime(market) {
  const now = Math.floor(Date.now() / 1000)
  return Number(market.closeAt || 0) <= now
}

function canEnterMarketNow(market) {
  const now = new Date()
  const { openAt, betCloseAt } = getDailyMarketSchedule(now)


  if (marketIsClosedByTime(market)) return false
  if (now.getTime() < openAt.getTime()) return false
  if (now.getTime() >= betCloseAt.getTime()) return false

  if (market?.exists && Number(market.status) !== MarketStatus.OPEN) {
    return false
  }

  return true
}

function getMarketEntryMessage(market) {
  const now = new Date()
  const { openAt, betCloseAt, resolveAt } = getDailyMarketSchedule(now)

  if (now.getTime() < openAt.getTime()) {
    return 'Mercado ainda não abriu para o ciclo atual.'
  }

  if (now.getTime() >= betCloseAt.getTime() && now.getTime() < resolveAt.getTime()) {
    return 'As apostas para esta janela foram encerradas. Aguarde o fechamento do bloco atual.'
  }

  if (marketIsClosedByTime(market)) {
    return 'Mercado fechado. Aguarde a resolução e o próximo ciclo.'
  }

  if (!market?.exists) {
    return 'Mercado será publicado automaticamente na primeira entrada desta janela.'
  }

  if (Number(market.status) === MarketStatus.RESOLVED) {
    return 'Mercado já resolvido.'
  }

  if (Number(market.status) !== MarketStatus.OPEN) {
    return 'Mercado indisponível no momento.'
  }

  return 'Apostas liberadas até os últimos 5 minutos de cada janela de 4 horas.'
}

async function ensureMarketExists(market, signer) {
  if (!state.predictions) {
    throw new Error('Contrato binário ainda não configurado.')
  }

  if (market.exists) return

  if (marketIsClosedByTime(market)) {
    throw new Error('Esse mercado já fechou.')
  }

  const predictionsContract = state.predictions.connect(signer)
  const normalized = normalizeBinaryProbabilities(market)

  try {
    console.log('[BINARY_CREATE_MARKET_PAYLOAD]', {
      contractAddress: BINARY_PREDICTIONS_ADDRESS,
      marketId: String(market.marketId),
      assetSymbol: market.assetSymbol,
      question: market.question,
      closeAt: Number(market.closeAt),
      referencePriceUsd: Number(market.referencePriceUsd),
      referencePriceE8: getReferencePriceE8(market.referencePriceUsd).toString(),
      probYesBps: Number(normalized.probYesBps),
      probNoBps: Number(normalized.probNoBps),
      feeBps: 0,
      totalBps: Number(normalized.probYesBps) + Number(normalized.probNoBps)
    })

    const tx = await predictionsContract.createMarket(
  BigInt(market.marketId),
  market.assetSymbol,
  market.question,
  BigInt(market.closeAt),
  getReferencePriceE8(market.referencePriceUsd),
  0,
  normalized.probYesBps,
  normalized.probNoBps
)

    await tx.wait()
  } catch (error) {
    const text = String(error?.shortMessage || error?.message || error || '').toLowerCase()

    if (!text.includes('marketalreadyexists')) {
      throw error
    }
  }

  market.exists = true
  market.status = MarketStatus.OPEN
  market.hasWinner = false
  market.poolYes = market.poolYes || '0'
  market.poolNo = market.poolNo || '0'
  market.totalPool = market.totalPool || '0'
}

async function approveIfNeeded(amountUi, signer) {
  const amount = parseUnits(String(amountUi).replace(',', '.'), state.decimals)
  const ownerAddress = await signer.getAddress()
  const tokenContract = state.token.connect(signer)
  const allowance = await tokenContract.allowance(ownerAddress, BINARY_PREDICTIONS_ADDRESS)

  if (allowance >= amount) return

  const tx = await tokenContract.approve(BINARY_PREDICTIONS_ADDRESS, amount)
  await tx.wait()
}

async function buyPosition(market, side, amountUi, signer) {
  const couponId = generateCouponId(market)
  const amount = parseUnits(String(amountUi).replace(',', '.'), state.decimals)
  const predictionsContract = state.predictions.connect(signer)

  await approveIfNeeded(amountUi, signer)

  const tx = await predictionsContract.buyPosition(
    BigInt(market.marketId),
    couponId,
    Number(side),
    amount
  )

  const receipt = await tx.wait()
  const confirmedTxHash = String(receipt?.hash || tx?.hash || '')

  if (!confirmedTxHash) {
    throw new Error('Posição confirmada sem tx hash.')
  }

  if (currentGoogleUser?.uid) {
    await saveConfirmedSpendVWalaToFirebase({
      userId: currentGoogleUser.uid,
      walletAddress: await signer.getAddress(),
      amount: amountUi,
      txHash: confirmedTxHash,
      historyType: 'prediction_buy'
    })
  }

  console.log('Binary market position opened:', {
    marketId: market.marketId,
    couponId: couponId.toString(),
    side: Number(side),
    amountUi,
    txHash: confirmedTxHash
  })

  saveCouponId(market.marketId, couponId.toString())

  return {
    couponId: couponId.toString(),
    txHash: confirmedTxHash
  }
}

function createCard(market) {
  const card = document.createElement('div')
  card.className = 'match-card inline-market-card'

  card.innerHTML = `
    <div class="match-box inline-match-box">
      <div class="match-league">${market.assetSymbol}</div>

      <div class="match-teams">
        <div class="team-block">
  <div class="team-badge crypto-badge">
    <img src="${market.imageUrl || '/logo.png'}" alt="${market.assetSymbol}" />
  </div>
  <strong>${market.question}</strong>
</div>
      </div>

      <div class="match-time">
  Fecha em ${formatCountdown(market.closeAt)}
  <br />
  <small>ID ${market.marketId}</small>
</div>
    </div>

    <div class="stats-grid inline-stats-grid">
      <div class="stat-box">
        <span class="stat-label">Preço de referência</span>
        <strong class="stat-value">${formatUsd(market.referencePriceUsd)}</strong>
      </div>

      <div class="stat-box">
        <span class="stat-label">Preço atual</span>
        <strong class="stat-value">${formatUsd(market.currentPriceUsd)}</strong>
      </div>

      <div class="stat-box">
        <span class="stat-label">Fechamento</span>
        <strong class="stat-value">${formatUnixDateTime(market.closeAt)}</strong>
      </div>
    </div>

    <div class="market-question inline-market-question force-show">
      <div class="market-mini-status">
        <span class="market-chip pending">${getBinaryStatusLabel(market)}</span>
        <span class="market-total">Pool ${formatNumber(market.totalPool)} ${TOKEN_SYMBOL}</span>
      </div>

      <div class="market-mini-pools">
        <span>SIM ${formatNumber(market.poolYes)} · ${formatNumber(market.probYesBps / 100)}%</span>
        <span>NÃO ${formatNumber(market.poolNo)} · ${formatNumber(market.probNoBps / 100)}%</span>
      </div>
    </div>

    <div class="bet-panel">
      <div class="bet-top">
        <div class="selected-outcome-chip js-selected-side-chip">Selecione um lado</div>
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
  Apostas abertas em ciclos de 4 horas.
</div>
    </div>

    <div class="modal-footer inline-modal-footer">
      <button class="trade js-pick-btn" data-side="0" type="button">SIM</button>
      <button class="launch js-pick-btn" data-side="1" type="button">NÃO</button>
    </div>

    <button
  class="launch confirm-bet-btn js-confirm-bet-btn"
  type="button"
  ${!canEnterMarketNow(market) ? 'disabled' : ''}
>
  ${canEnterMarketNow(market) ? 'Abrir posição' : 'Indisponível agora'}
</button>
  `

  const amountInputEl = card.querySelector('.js-bet-amount-input')
  const hintEl = card.querySelector('.js-bet-hint-text')
  const payoutEl = card.querySelector('.js-estimated-payout-text')
  const sideChipEl = card.querySelector('.js-selected-side-chip')
  const confirmBtn = card.querySelector('.js-confirm-bet-btn')
  const pickButtons = [...card.querySelectorAll('.js-pick-btn')]

  let selectedSide = null

  async function updateInlinePreview() {
    if (selectedSide == null) {
      payoutEl.textContent = 'Retorno estimado: --'
      confirmBtn.disabled = true
      return
    }

    if (!state.userAddress) {
      hintEl.textContent = 'Faça login para usar a carteira interna.'
      confirmBtn.disabled = true
      return
    }

    if (!canEnterMarketNow(market)) {
  hintEl.textContent = getMarketEntryMessage(market)
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
      const projected = await previewPayout(market.marketId, selectedSide, amountUi, market)

      payoutEl.textContent = `Retorno estimado: ${formatNumber(projected.payout)} ${TOKEN_SYMBOL}`
      hintEl.textContent = `Lucro estimado: ${formatNumber(projected.profit)} ${TOKEN_SYMBOL}`
      confirmBtn.disabled = !canEnterMarketNow(market)
    } catch (error) {
      payoutEl.textContent = 'Retorno estimado: --'
      hintEl.textContent = getFriendlyError(error)
      confirmBtn.disabled = true
    }
  }

  pickButtons.forEach((btn) => {
    btn.addEventListener('click', async () => {
      selectedSide = Number(btn.dataset.side)
      sideChipEl.textContent = getSideLabel(selectedSide)

      pickButtons.forEach((item) => {
        item.classList.toggle('active-pick', item === btn)
      })

      await updateInlinePreview()
    })
  })

  amountInputEl.addEventListener('input', updateInlinePreview)

  confirmBtn.addEventListener('click', async () => {
    try {
      if (!isPredictionsConfigured()) {
        showAlert('Contrato pendente', 'Defina VITE_BINARY_PREDICTIONS_ADDRESS para ativar esse mercado.')
        return
      }

      if (!state.userAddress) {
        showAlert('Carteira necessária', 'Configure a carteira interna antes de abrir posição.')
        return
      }

      const signer = await getInternalWalletSigner()

      if (!signer) {
        showAlert('PIN necessário', 'Digite o PIN da carteira interna para abrir posição.')
        return
      }

      const amountUi = Number(String(amountInputEl.value || '').replace(',', '.'))

      if (!Number.isFinite(amountUi) || amountUi <= 0) {
        showAlert('Valor inválido', 'Digite um valor válido.')
        return
      }

      if (selectedSide == null) {
        showAlert('Previsão obrigatória', 'Selecione SIM ou NÃO antes de continuar.')
        return
      }

      if (!canEnterMarketNow(market)) {
  showAlert('Mercado indisponível', getMarketEntryMessage(market))
  return
}

      confirmBtn.disabled = true

      let createdNow = false

      showLoadingModal(
        'Abrindo posição',
        market.exists
          ? 'Aguarde enquanto sua posição é enviada para a Polygon.'
          : 'Publicando o mercado e enviando sua posição para a Polygon.'
      )

      if (!market.exists) {
        await ensureMarketExists(market, signer)
        createdNow = true
      }

      const positionResult = await buyPosition(market, selectedSide, amountUi, signer)

      await saveBinaryPositionToFirebase(market, {
        couponId: positionResult.couponId,
        side: selectedSide,
        amountUi,
        txHash: positionResult.txHash
      })

      hideLoadingModal()

      showAlert(
  'Sucesso',
  createdNow
    ? `Mercado criado e posição aberta com sucesso.\n\nMarket ID: ${market.marketId}`
    : `Posição aberta com sucesso.\n\nMarket ID: ${market.marketId}`
)

      await refreshWalletBalance()
      state.markets = loadCouponsForMarkets(state.markets)
      await refreshAllPositions()
      renderMarkets()
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

function renderMarkets() {
  if (state.loading) {
    marketCount.textContent = '...'
    marketGrid.innerHTML = ''
    marketEmpty.classList.remove('show')
    return
  }

  const term = searchInput.value.trim().toLowerCase()

  const filtered = state.markets.filter((market) => {
    const text = `${market.assetSymbol} ${market.question}`.toLowerCase()
    return text.includes(term)
  })

  marketGrid.innerHTML = ''
  filtered.forEach((market) => {
    marketGrid.appendChild(createCard(market))
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

  searchInput.addEventListener('input', renderMarkets)
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
  await loadMarkets()
}

boot()