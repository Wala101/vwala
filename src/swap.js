import './style/swap.css'

import { auth, db, googleProvider } from './firebase'
import {
  browserLocalPersistence,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signInWithRedirect
} from 'firebase/auth'
import { deleteDoc, doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import {
  Contract,
  JsonRpcProvider,
  Wallet,
  formatEther,
  formatUnits,
  parseEther,
  parseUnits
} from 'ethers'

const app = document.querySelector('#app')

if (!app) {
  throw new Error('Elemento #app não encontrado.')
}

const POLYGON_RPC_PRIMARY_URL = new URL('/api/rpc', window.location.origin).toString()
const POLYGON_RPC_FALLBACK_URL = new URL('/api/rpc-fallback', window.location.origin).toString()
const POLYGON_CHAIN_ID = Number(import.meta.env.VITE_POLYGON_CHAIN_ID || 137)
const DEVICE_WALLET_STORAGE_KEY = 'vwala_device_wallet'
const CLOUD_PASSWORD_SALT = 'vwala_google_device_pin_v1'

const VWALA_TOKEN_ADDRESS = '0x7bD1f6f4F5CEf026b643758605737CB48b4B7D83'
const VWALA_POOL_ADDRESS = '0x5c950A2FA20A48DDcb4952910e550Ac59fd21AF7'
const POL_GAS_RESERVE = '0.05'

const swapState = {
  mode: 'buy',
  polBalance: '0',
  vwalaBalance: '0',
  poolReserve: '0',
  poolInventory: '0',
  redeemableNow: '0',
  tokenDecimals: 18,
  isSubmitting: false
}

let currentGoogleUser = null
let currentWalletAddress = ''
let swapDataLoadCounter = 0
let vwalaBalanceReadCounter = 0

const modalState = {
  resolve: null,
  mode: 'message'
}

const VWALA_POOL_ABI = [
  'function buy() payable',
  'function sell(uint256 amount)',
  'function reservePOL() view returns (uint256)',
  'function tokenInventory() view returns (uint256)',
  'function maxRedeemable(address account) view returns (uint256)'
]

const ERC20_TOKEN_ABI = [
  'function decimals() view returns (uint8)',
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)'
]

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

function formatWalletAddress(address = '') {
  if (!address) return 'Carteira ainda não criada'
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function formatTxHash(hash = '') {
  if (!hash) return ''
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function normalizeAmountInput(value = '') {
  return String(value || '').replace(',', '.').trim()
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

function buildCloudPassword(user) {
  if (!user?.uid) {
    throw new Error('Usuário inválido para gerar acesso da carteira.')
  }

  return `${CLOUD_PASSWORD_SALT}:${user.uid}`
}

function createRpcProbeUrl(baseUrl, label = 'swap_runtime') {
  const url = new URL(baseUrl, window.location.origin)
  url.searchParams.set('_ts', String(Date.now()))
  url.searchParams.set('_probe', label)
  return url.toString()
}

function getProvider(label = 'swap_runtime', baseUrl = POLYGON_RPC_PRIMARY_URL) {
  return new JsonRpcProvider(createRpcProbeUrl(baseUrl, label))
}

function compareRawBalanceAsc(a, b) {
  const aValue = BigInt(String(a || '0'))
  const bValue = BigInt(String(b || '0'))

  if (aValue === bValue) return 0
  return aValue < bValue ? -1 : 1
}

async function readSingleVWalaBalanceProbe(walletAddress, label, baseUrl, proxyName) {
  const provider = getProvider(label, baseUrl)
  const tokenContract = getTokenContract(provider)

  const [blockNumber, rawBalance, decimals] = await Promise.all([
    provider.getBlockNumber(),
    tokenContract.balanceOf(walletAddress),
    tokenContract.decimals()
  ])

  const decimalsNumber = Number(decimals)
  const formattedBalanceText = formatUnits(rawBalance, decimalsNumber)

  return {
    source: label,
    proxyName,
    walletAddress,
    blockNumber: Number(blockNumber),
    rawBalance: rawBalance.toString(),
    decimals: decimalsNumber,
    formattedBalance: Number(formattedBalanceText),
    formattedBalanceText,
    rpcUrl: createRpcProbeUrl(baseUrl, label)
  }
}

function selectStableVWalaProbe(probes = []) {
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
  : 'majority_probe_wins'

  return {
    selectedProbe,
    selectionReason,
    groups
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function runVWalaProbeRound(walletAddress, label, round) {
  const settled = await Promise.allSettled([
    readSingleVWalaBalanceProbe(
      walletAddress,
      `${label}_r${round}_primary_a`,
      POLYGON_RPC_PRIMARY_URL,
      'primary'
    ),
    readSingleVWalaBalanceProbe(
      walletAddress,
      `${label}_r${round}_primary_b`,
      POLYGON_RPC_PRIMARY_URL,
      'primary'
    ),
    readSingleVWalaBalanceProbe(
      walletAddress,
      `${label}_r${round}_fallback_a`,
      POLYGON_RPC_FALLBACK_URL,
      'fallback'
    ),
    readSingleVWalaBalanceProbe(
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
    throw failures[0] || new Error('Nenhuma leitura de saldo vWALA foi concluída.')
  }

  const { selectedProbe, selectionReason, groups } = selectStableVWalaProbe(probes)

  console.groupCollapsed(`[SWAP_VWALA_RPC_PROBES] ${label} round=${round}`)
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

async function readVWalaBalanceViaEthers(walletAddress, label = 'swap_vwala_balance') {
  const attempts = []
  let previousRawBalance = ''

  for (let round = 1; round <= 4; round += 1) {
    const result = await runVWalaProbeRound(walletAddress, label, round)
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

function getPoolContract(providerOrSigner) {
  return new Contract(
    VWALA_POOL_ADDRESS,
    VWALA_POOL_ABI,
    providerOrSigner
  )
}


function getTokenContract(providerOrSigner) {
  return new Contract(
    VWALA_TOKEN_ADDRESS,
    ERC20_TOKEN_ABI,
    providerOrSigner
  )
}

function getLocalDeviceWallet() {
  try {
    const raw = localStorage.getItem(DEVICE_WALLET_STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch (error) {
    console.error('Erro ao ler carteira local do aparelho:', error)
    return null
  }
}

function saveLocalDeviceWallet(payload) {
  localStorage.setItem(
    DEVICE_WALLET_STORAGE_KEY,
    JSON.stringify(payload)
  )
}

function getMatchingLocalDeviceWallet(uid = '', walletAddress = '') {
  const localVault = getLocalDeviceWallet()

  if (!localVault) return null
  if (localVault.uid !== uid) return null
  if (!localVault.walletKeystoreLocal) return null

  const localAddress = String(localVault.walletAddress || '').toLowerCase()
  const targetAddress = String(walletAddress || '').toLowerCase()

  if (!localAddress || !targetAddress || localAddress !== targetAddress) {
    return null
  }

  return localVault
}

async function resolveAuthoritativeWalletAddress(user, walletProfile = {}) {
  if (walletProfile?.walletAddress) {
    const resolvedAddress = String(walletProfile.walletAddress).trim()

    console.log('[SWAP WALLET RESOLUTION]', {
      source: 'firestore_walletAddress',
      walletAddress: resolvedAddress
    })

    return resolvedAddress
  }

  if (walletProfile?.walletKeystoreCloud) {
    try {
      const unlockedWallet = await Wallet.fromEncryptedJson(
        walletProfile.walletKeystoreCloud,
        buildCloudPassword(user)
      )

      const resolvedAddress = String(unlockedWallet.address || '').trim()

      console.log('[SWAP WALLET RESOLUTION]', {
        source: 'walletKeystoreCloud',
        walletAddress: resolvedAddress
      })

      return resolvedAddress
    } catch (error) {
      console.error('Erro ao resolver wallet pelo keystore cloud:', error)
    }
  }


  console.log('[SWAP WALLET RESOLUTION]', {
    source: 'none',
    walletAddress: ''
  })

  return ''
}

async function syncResolvedWalletAddress(user, walletProfile = {}) {
  const resolvedWalletAddress = await resolveAuthoritativeWalletAddress(user, walletProfile)

  if (!resolvedWalletAddress) {
    return walletProfile
  }

  const storedWalletAddress = String(walletProfile?.walletAddress || '').trim()

  if (
    !storedWalletAddress ||
    storedWalletAddress.toLowerCase() !== resolvedWalletAddress.toLowerCase()
  ) {
    await setDoc(
      doc(db, 'users', user.uid),
      {
        walletAddress: resolvedWalletAddress,
        updatedAt: serverTimestamp()
      },
      { merge: true }
    )
  }

  currentWalletAddress = resolvedWalletAddress

  localStorage.setItem(
    'vwala_wallet_profile',
    JSON.stringify({
      uid: user.uid,
      walletAddress: resolvedWalletAddress,
      chainId: walletProfile.chainId || POLYGON_CHAIN_ID,
      network: walletProfile.network || 'polygon'
    })
  )

  return {
    ...walletProfile,
    walletAddress: resolvedWalletAddress
  }
}

function getMaxBuyAmount() {
  const userAvailable = Number(swapState.polBalance || 0) - Number(POL_GAS_RESERVE)
  const poolAvailable = Number(swapState.poolInventory || 0)
  const available = Math.min(userAvailable, poolAvailable)

  return available > 0 ? available.toFixed(6) : '0'
}

function getMaxSellAmount() {
  const available = Math.min(
    Number(swapState.vwalaBalance || 0),
    Number(swapState.redeemableNow || 0)
  )

  return available > 0 ? available.toFixed(6) : '0'
}

function getCurrentNormalizedInput() {
  return normalizeAmountInput(document.getElementById('swapAmountInput')?.value || '')
}

function getCurrentInputNumber() {
  const normalized = getCurrentNormalizedInput()
  const num = Number(normalized)
  return Number.isFinite(num) && num > 0 ? num : 0
}

function setSwapMode(mode = 'buy') {
  swapState.mode = mode === 'sell' ? 'sell' : 'buy'
  syncSwapUI()
}

function syncSwapUI() {
  const isBuy = swapState.mode === 'buy'
  const amountNumber = getCurrentInputNumber()
  const quoteValue = amountNumber > 0 ? amountNumber : 0
  const hasWallet = Boolean(currentGoogleUser && currentWalletAddress)

  document.getElementById('swapTabBuy')?.classList.toggle('active', isBuy)
  document.getElementById('swapTabSell')?.classList.toggle('active', !isBuy)

  const amountLabel = document.getElementById('swapAmountLabel')
  if (amountLabel) {
    amountLabel.textContent = isBuy ? 'Você paga em POL' : 'Você vende em vWALA'
  }

  const amountHint = document.getElementById('swapAmountHint')
if (amountHint) {
  if (isBuy) {
    amountHint.textContent = `Máximo disponível: ${formatAmount(getMaxBuyAmount(), 'POL')}`
    amountHint.classList.remove('hidden')
  } else {
    amountHint.textContent = ''
    amountHint.classList.add('hidden')
  }
}

  const payValue = document.getElementById('swapPayValue')
  const receiveValue = document.getElementById('swapReceiveValue')

  if (payValue) {
    payValue.textContent = isBuy
      ? formatAmount(amountNumber || 0, 'POL')
      : formatAmount(amountNumber || 0, 'vWALA')
  }

  if (receiveValue) {
    receiveValue.textContent = isBuy
      ? formatAmount(quoteValue || 0, 'vWALA')
      : formatAmount(quoteValue || 0, 'POL')
  }

  const submitBtn = document.getElementById('swapSubmitBtn')
  if (submitBtn) {
    submitBtn.textContent = !hasWallet
      ? 'Entrar com Google'
      : isBuy
        ? 'Comprar'
        : 'Vender'

    submitBtn.disabled = swapState.isSubmitting
  }

  const inlineMessage = document.getElementById('swapInlineMessage')
  if (inlineMessage) {
    if (!hasWallet) {
      inlineMessage.textContent = 'Entre com Google para continuar.'
      inlineMessage.classList.remove('hidden')
    } else if (!isBuy && Number(swapState.polBalance || 0) < Number(POL_GAS_RESERVE)) {
      inlineMessage.textContent = `Mantenha pelo menos ${POL_GAS_RESERVE} POL para o gás da venda.`
      inlineMessage.classList.remove('hidden')
    } else {
      inlineMessage.textContent = ''
      inlineMessage.classList.add('hidden')
    }
  }
}

function updateDashboardUI() {
  const walletAddressText = document.getElementById('swapWalletAddress')
  if (walletAddressText) {
    walletAddressText.textContent = formatWalletAddress(currentWalletAddress)
  }

  const polBalanceText = document.getElementById('swapPolBalance')
  if (polBalanceText) {
    polBalanceText.textContent = formatAmount(swapState.polBalance, 'POL')
  }

  const vwalaBalanceText = document.getElementById('swapVWalaBalance')
  if (vwalaBalanceText) {
    vwalaBalanceText.textContent = formatAmount(swapState.vwalaBalance, 'vWALA')
  }

  const reserveText = document.getElementById('swapPoolReserve')
  if (reserveText) {
    reserveText.textContent = formatAmount(swapState.poolReserve, 'POL')
  }

  const redeemableText = document.getElementById('swapRedeemableNow')
  if (redeemableText) {
    redeemableText.textContent = formatAmount(swapState.redeemableNow, 'vWALA')
  }

  syncSwapUI()
}

async function loadSwapData(walletAddress = '') {
  const requestId = ++swapDataLoadCounter
  const readId = ++vwalaBalanceReadCounter

  try {
    const provider = getProvider(`swap_data_${requestId}`, POLYGON_RPC_PRIMARY_URL)
    const poolContract = getPoolContract(provider)
    const tokenContract = getTokenContract(provider)

    const [decimalsRaw, reserveRaw, inventoryRaw] = await Promise.all([
      tokenContract.decimals(),
      poolContract.reservePOL(),
      poolContract.tokenInventory()
    ])

    if (requestId !== swapDataLoadCounter) {
      return
    }

    const tokenDecimals = Number(decimalsRaw)
    const nextState = {
      tokenDecimals,
      poolReserve: formatEther(reserveRaw),
      poolInventory: formatUnits(inventoryRaw, tokenDecimals),
      polBalance: '0',
      vwalaBalance: '0',
      redeemableNow: '0'
    }

    if (walletAddress) {
      const [polBalanceRaw, redeemableRaw, firebaseVWalaBalance] = await Promise.all([
  provider.getBalance(walletAddress),
  poolContract.maxRedeemable(walletAddress),
  currentGoogleUser?.uid
    ? readFirebaseVWalaBalance(currentGoogleUser.uid, walletAddress)
    : Promise.resolve('0')
])

      if (requestId !== swapDataLoadCounter) {
        return
      }

      nextState.polBalance = formatEther(polBalanceRaw)
nextState.vwalaBalance = String(firebaseVWalaBalance || '0')
nextState.redeemableNow = formatUnits(redeemableRaw, tokenDecimals)

console.groupCollapsed(`[SWAP_VWALA_FIREBASE_BALANCE_READ_${readId}]`)
console.log('swap_wallet_context', {
  currentWalletAddress,
  walletAddress,
  polBalance: nextState.polBalance,
  vwalaBalance: nextState.vwalaBalance,
  redeemableNow: nextState.redeemableNow
})
console.groupEnd()
    }

    if (requestId !== swapDataLoadCounter) {
      return
    }

    swapState.tokenDecimals = nextState.tokenDecimals
    swapState.poolReserve = nextState.poolReserve
    swapState.poolInventory = nextState.poolInventory
    swapState.polBalance = nextState.polBalance
    swapState.vwalaBalance = nextState.vwalaBalance
    swapState.redeemableNow = nextState.redeemableNow

    updateDashboardUI()
  } catch (error) {
    console.error('Erro ao carregar dados do swap:', error)
  }
}

function renderPage() {
  app.innerHTML = `
    <div class="swap-page">
      <div class="swap-shell">
        <header class="swap-topbar">
          <div class="swap-brand">
            <div class="swap-brand-badge">W</div>
            <div class="swap-brand-text">
              <strong>vWALA Swap</strong>
              <span>Comprar e vender</span>
            </div>
          </div>

          <div class="swap-topbar-actions">
            <button id="swapBackBtn" class="swap-topbar-btn" type="button">Voltar</button>
          </div>
        </header>

        <section class="swap-card">
          <div class="swap-card-header">
            <div>
              <h2>Swap</h2>
              <p>Troque POL por vWALA ou vWALA por POL.</p>
            </div>
          </div>

          <div class="swap-balance-row">
            <div class="swap-balance-box">
              <span>Seu saldo em POL</span>
              <strong id="swapPolBalance">${formatAmount('0', 'POL')}</strong>
            </div>

            <div class="swap-balance-box">
              <span>Seu saldo em vWALA</span>
              <strong id="swapVWalaBalance">${formatAmount('0', 'vWALA')}</strong>
            </div>
          </div>

          <div class="swap-tabs">
            <button id="swapTabBuy" class="swap-tab active" type="button">Comprar</button>
            <button id="swapTabSell" class="swap-tab" type="button">Vender</button>
          </div>

          <div class="swap-form-wrap">
            <div class="swap-field">
              <div class="swap-label-row">
                <label id="swapAmountLabel" for="swapAmountInput">Você paga em POL</label>
                <span id="swapWalletAddress" class="swap-helper-inline">${formatWalletAddress(currentWalletAddress)}</span>
              </div>

              <div class="swap-input-row">
                <input
                  id="swapAmountInput"
                  type="text"
                  inputmode="decimal"
                  placeholder="0.00"
                  autocomplete="off"
                />
                <button id="swapMaxBtn" class="swap-max-btn" type="button">MAX</button>
              </div>

              <div id="swapAmountHint" class="swap-field-hint">
                Máximo disponível: ${formatAmount('0', 'POL')}
              </div>
            </div>

            <div class="swap-preview">
              <div class="swap-preview-row">
                <span>Você paga</span>
                <strong id="swapPayValue">${formatAmount('0', 'POL')}</strong>
              </div>

              <div class="swap-preview-divider"></div>

              <div class="swap-preview-row">
                <span>Você recebe</span>
                <strong id="swapReceiveValue">${formatAmount('0', 'vWALA')}</strong>
              </div>
            </div>

            <div id="swapInlineMessage" class="swap-warning hidden"></div>

            <button id="swapSubmitBtn" class="swap-submit-btn" type="button">Entrar com Google</button>

<!-- Reservado oculto (não aparece pro usuário) -->
<div class="swap-subtext" style="display: none;">
  Reserva atual do pool: <strong id="swapPoolReserve">${formatAmount('0', 'POL')}</strong>
</div>

<div class="swap-subtext">
  Reserva atual: <strong>50 845.34 $</strong>
</div>
          </div>
        </section>
      </div>
    </div>

    <div id="authGate" class="swap-auth-gate hidden">
      <div class="swap-auth-modal">
        <div class="swap-auth-badge">W</div>
        <h2>Entre com Google</h2>
        <p>
          Faça login para usar o swap.
        </p>

        <button id="googleLoginBtn" class="swap-auth-google-btn" type="button">
          Continuar com Google
        </button>
      </div>
    </div>

    <div id="uiModal" class="swap-auth-gate hidden">
      <div class="swap-auth-modal swap-ui-modal-box">
        <button
          id="uiModalCloseBtn"
          class="swap-modal-close-btn hidden"
          type="button"
          aria-label="Fechar modal"
        >
          ×
        </button>

        <div class="swap-auth-badge">W</div>
        <h2 id="uiModalTitle">Aviso</h2>
        <p id="uiModalText"></p>

        <input
  id="uiModalInput"
  class="swap-modal-input"
  type="tel"
  inputmode="numeric"
  pattern="[0-9]*"
  maxlength="6"
  placeholder="Digite seu PIN"
  autocomplete="new-password"
  autocorrect="off"
  autocapitalize="none"
  spellcheck="false"
  enterkeyhint="done"
  data-form-type="other"
  data-lpignore="true"
  data-1p-ignore="true"
/>

        <div class="swap-modal-actions">
          <button id="uiModalCancelBtn" class="swap-modal-secondary-btn" type="button">
            Cancelar
          </button>

          <button id="uiModalConfirmBtn" class="swap-modal-primary-btn" type="button">
            OK
          </button>
        </div>
      </div>
    </div>

    <div id="loadingGate" class="swap-auth-gate hidden">
      <div class="swap-auth-modal swap-loading-modal">
        <div class="swap-loading-spinner" aria-hidden="true"></div>
        <h2 id="loadingModalTitle">Processando</h2>
        <p id="loadingModalText">Aguarde enquanto concluímos sua solicitação.</p>
      </div>
    </div>
  `
}

renderPage()

const authGate = document.getElementById('authGate')
const googleLoginBtn = document.getElementById('googleLoginBtn')

const uiModal = document.getElementById('uiModal')
const uiModalTitle = document.getElementById('uiModalTitle')
const uiModalText = document.getElementById('uiModalText')
const uiModalInput = document.getElementById('uiModalInput')
const uiModalCancelBtn = document.getElementById('uiModalCancelBtn')
const uiModalConfirmBtn = document.getElementById('uiModalConfirmBtn')
const uiModalCloseBtn = document.getElementById('uiModalCloseBtn')

const loadingGate = document.getElementById('loadingGate')
const loadingModalTitle = document.getElementById('loadingModalTitle')
const loadingModalText = document.getElementById('loadingModalText')

function openUiModal({
  title = 'Aviso',
  text = '',
  mode = 'message',
  confirmText = 'OK',
  cancelText = 'Cancelar',
  placeholder = '',
  password = false,
  initialValue = '',
  showCancel = false
} = {}) {
  return new Promise((resolve) => {
    modalState.resolve = resolve
    modalState.mode = mode

    uiModalTitle.textContent = title
    uiModalText.innerHTML = text
    uiModalConfirmBtn.textContent = confirmText
    uiModalCancelBtn.textContent = cancelText
    uiModalCancelBtn.style.display = showCancel ? 'block' : 'none'
    uiModalCloseBtn.classList.toggle('hidden', !showCancel)

    if (mode === 'prompt') {
      uiModalInput.classList.remove('hidden')
      uiModalInput.type = password ? 'password' : 'text'
      uiModalInput.placeholder = placeholder
      uiModalInput.value = initialValue
      setTimeout(() => uiModalInput.focus(), 0)
    } else {
      uiModalInput.classList.add('hidden')
      uiModalInput.value = ''
    }

    uiModal.classList.remove('hidden')
  })
}

function closeUiModal(result = null) {
  uiModal.classList.add('hidden')

  const resolve = modalState.resolve
  modalState.resolve = null
  modalState.mode = 'message'

  if (resolve) {
    resolve(result)
  }
}

function setPromptModalError({
  title = 'PIN inválido',
  text = 'Valor inválido.',
  confirmText = 'Tentar novamente',
  placeholder = 'Digite novamente'
} = {}) {
  uiModalTitle.textContent = title
  uiModalText.innerHTML = text
  uiModalConfirmBtn.textContent = confirmText
  uiModalCancelBtn.style.display = 'none'
  uiModalCloseBtn.classList.add('hidden')
  uiModalInput.classList.remove('hidden')
  uiModalInput.value = ''
  uiModalInput.placeholder = placeholder
  uiModalInput.disabled = false
  uiModalConfirmBtn.disabled = false

  setTimeout(() => uiModalInput.focus(), 0)
}

function showLoadingModal(
  title = 'Processando',
  text = 'Aguarde enquanto concluímos sua solicitação.'
) {
  if (loadingModalTitle) {
    loadingModalTitle.textContent = title
  }

  if (loadingModalText) {
    loadingModalText.textContent = text
  }

  loadingGate?.classList.remove('hidden')
  document.body.style.overflow = 'hidden'
}

function hideLoadingModal() {
  loadingGate?.classList.add('hidden')
  document.body.style.overflow = ''
}

async function showMessageModal(title, text, confirmText = 'OK') {
  await openUiModal({
    title,
    text,
    confirmText,
    showCancel: false
  })
}

async function showPromptModal({
  title = 'Aviso',
  text = '',
  confirmText = 'Continuar',
  cancelText = 'Cancelar',
  placeholder = '',
  password = false,
  initialValue = '',
  showCancel = true
} = {}) {
  return openUiModal({
    title,
    text,
    mode: 'prompt',
    confirmText,
    cancelText,
    placeholder,
    password,
    initialValue,
    showCancel
  })
}

async function showConfirmModal(
  title,
  text,
  confirmText = 'Confirmar',
  cancelText = 'Cancelar'
) {
  return openUiModal({
    title,
    text,
    confirmText,
    cancelText,
    showCancel: false
  })
}

async function showPinModal(title, text, confirmText = 'Continuar') {
  return showPromptModal({
    title,
    text,
    confirmText,
    cancelText: 'Cancelar',
    placeholder: 'Digite seu PIN',
    password: true,
    showCancel: false
  })
}

function openAuthGate() {
  authGate?.classList.remove('hidden')
}

function closeAuthGate() {
  authGate?.classList.add('hidden')
}

function saveFirebaseUser(user) {
  if (!user) {
    localStorage.removeItem('vwala_user')
    return
  }

  localStorage.setItem(
    'vwala_user',
    JSON.stringify({
      uid: user.uid,
      name: user.displayName || '',
      email: user.email || '',
      photo: user.photoURL || ''
    })
  )
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

  const migratedRead = await readVWalaBalanceViaEthers(
    walletAddress,
    `swap_vwala_migration_${userId}`
  )

  const migratedBalanceRaw = BigInt(String(migratedRead?.rawBalance || '0'))
  const migratedBalance = formatVWalaUnits(migratedBalanceRaw)

  if (migratedBalanceRaw > 0n) {
    await setDoc(
      balanceRef,
      {
        assetId: 'vwala',
        token: 'vWALA',
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
        token: 'vWALA',
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

async function saveConfirmedBuyVWalaToFirebase({
  userId,
  walletAddress,
  amount,
  txHash
}) {
  const normalizedTxHash = sanitizeTxHashForDoc(txHash)
  const amountRaw = parseVWalaUnits(amount)

  if (!userId) {
    throw new Error('userId ausente para salvar compra.')
  }

  if (!normalizedTxHash) {
    throw new Error('txHash ausente para salvar compra.')
  }

  if (amountRaw <= 0n) {
    throw new Error('amount inválido para salvar compra.')
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
      token: 'vWALA',
      tokenAddress: VWALA_TOKEN_ADDRESS,
      walletAddress,
      balanceRaw: nextBalanceRaw.toString(),
      balance: Number(nextBalanceFormatted),
      balanceFormatted: nextBalanceFormatted,
      lastType: 'buy',
      lastTxHash: normalizedTxHash,
      updatedAt: serverTimestamp()
    },
    { merge: true }
  )

  await setDoc(
    getSwapHistoryDocRef(userId, normalizedTxHash),
    {
      assetId: 'vwala',
      type: 'buy',
      token: 'vWALA',
      tokenAddress: VWALA_TOKEN_ADDRESS,
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

async function saveConfirmedSellVWalaToFirebase({
  userId,
  walletAddress,
  amount,
  txHash
}) {
  const normalizedTxHash = sanitizeTxHashForDoc(txHash)
  const amountRaw = parseVWalaUnits(amount)

  if (!userId) {
    throw new Error('userId ausente para salvar venda.')
  }

  if (!normalizedTxHash) {
    throw new Error('txHash ausente para salvar venda.')
  }

  if (amountRaw <= 0n) {
    throw new Error('amount inválido para salvar venda.')
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
        token: 'vWALA',
        tokenAddress: VWALA_TOKEN_ADDRESS,
        walletAddress,
        balanceRaw: nextBalanceRaw.toString(),
        balance: Number(nextBalanceFormatted),
        balanceFormatted: nextBalanceFormatted,
        lastType: 'sell',
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
      type: 'sell',
      token: 'vWALA',
      tokenAddress: VWALA_TOKEN_ADDRESS,
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

async function promptCreateDevicePin() {
  let pin = ''

  while (true) {
    pin = await showPinModal(
      'Criar PIN neste aparelho',
      'Crie um novo PIN para usar sua carteira neste aparelho.',
      'Continuar'
    )

    if (pin === null) {
      continue
    }

    if (!pin || pin.trim().length < 6) {
      setPromptModalError({
        title: 'PIN inválido',
        text: 'Use pelo menos 6 caracteres.',
        confirmText: 'Tentar novamente',
        placeholder: 'Digite seu novo PIN'
      })
      continue
    }

    pin = pin.trim()
    break
  }

  while (true) {
    const confirmPin = await showPinModal(
      'Confirmar PIN',
      'Confirme o novo PIN deste aparelho.',
      'Confirmar'
    )

    if (confirmPin === null) {
      continue
    }

    if (!confirmPin || confirmPin.trim().length < 6) {
      setPromptModalError({
        title: 'PIN inválido',
        text: 'Confirme usando pelo menos 6 caracteres.',
        confirmText: 'Tentar novamente',
        placeholder: 'Confirme seu PIN'
      })
      continue
    }

    if (pin !== confirmPin.trim()) {
      setPromptModalError({
        title: 'PIN diferente',
        text: 'Os PINs não coincidem. Tente novamente.',
        confirmText: 'Tentar novamente',
        placeholder: 'Confirme seu PIN'
      })
      continue
    }

    return pin
  }
}

async function ensureDeviceWalletAccess(user, walletProfile) {
  const walletAddress = walletProfile?.walletAddress || ''

  const localVault = getMatchingLocalDeviceWallet(user?.uid, walletAddress)
  if (localVault) {
    return localVault
  }

  if (walletProfile?.walletKeystoreCloud) {
    const newPin = await promptCreateDevicePin()

    if (!newPin) {
      return null
    }

    const unlockedWallet = await Wallet.fromEncryptedJson(
      walletProfile.walletKeystoreCloud,
      buildCloudPassword(user)
    )

    const walletKeystoreLocal = await unlockedWallet.encrypt(newPin)

    const deviceVault = {
      uid: user.uid,
      walletAddress: unlockedWallet.address,
      walletKeystoreLocal,
      chainId: walletProfile.chainId || POLYGON_CHAIN_ID,
      network: walletProfile.network || 'polygon'
    }

    saveLocalDeviceWallet(deviceVault)

    await showMessageModal(
      'PIN criado',
      'Novo PIN criado com sucesso neste aparelho.'
    )

    return deviceVault
  }

  if (walletProfile?.walletKeystore) {
    const legacyPin = await showPinModal(
      'Atualizar acesso',
      'Digite seu PIN atual uma única vez para ativar o novo modelo com PIN por aparelho.',
      'Continuar'
    )

    if (legacyPin === null) {
      return null
    }

    if (!legacyPin || legacyPin.trim().length < 6) {
      await showMessageModal(
        'PIN inválido',
        'Digite seu PIN atual para continuar.'
      )
      return null
    }

    try {
      const unlockedWallet = await Wallet.fromEncryptedJson(
        walletProfile.walletKeystore,
        legacyPin.trim()
      )

      const walletKeystoreCloud = await unlockedWallet.encrypt(
        buildCloudPassword(user)
      )

      const walletKeystoreLocal = await unlockedWallet.encrypt(
        legacyPin.trim()
      )

      await setDoc(
        doc(db, 'users', user.uid),
        {
          walletKeystoreCloud,
          walletModel: 'google_device_pin_v1',
          updatedAt: serverTimestamp()
        },
        { merge: true }
      )

      const deviceVault = {
        uid: user.uid,
        walletAddress: unlockedWallet.address,
        walletKeystoreLocal,
        chainId: walletProfile.chainId || POLYGON_CHAIN_ID,
        network: walletProfile.network || 'polygon'
      }

      saveLocalDeviceWallet(deviceVault)

      await showMessageModal(
        'Acesso atualizado',
        'Pronto. Nos próximos aparelhos você poderá criar um novo PIN após login com Google.'
      )

      return deviceVault
    } catch (error) {
      console.error('Erro ao migrar carteira antiga:', error)

      await showMessageModal(
        'PIN inválido',
        'Não foi possível validar seu PIN atual.'
      )

      return null
    }
  }

  throw new Error('Carteira sem dados para configurar o PIN deste aparelho.')
}

async function getCurrentUserWalletProfile() {
  if (!currentGoogleUser?.uid) {
    throw new Error('Usuário não autenticado.')
  }

  const userRef = doc(db, 'users', currentGoogleUser.uid)
  const userSnap = await getDoc(userRef)

  if (!userSnap.exists()) {
    throw new Error('Carteira do usuário não encontrada.')
  }

  return userSnap.data()
}

async function ensureUserWalletProfile(user) {
  if (!user?.uid) {
    throw new Error('Usuário inválido para criar carteira.')
  }

  const userRef = doc(db, 'users', user.uid)
  const userSnap = await getDoc(userRef)

  if (userSnap.exists()) {
    const userData = userSnap.data()
    const normalizedUserData = await syncResolvedWalletAddress(user, userData)

    await ensureDeviceWalletAccess(user, normalizedUserData)
    return normalizedUserData
  }

  const pin = await promptCreateDevicePin()

  if (!pin) {
    return null
  }

  const wallet = Wallet.createRandom()
  const walletKeystoreCloud = await wallet.encrypt(buildCloudPassword(user))
  const walletKeystoreLocal = await wallet.encrypt(pin)

  const payload = {
    uid: user.uid,
    email: user.email || '',
    name: user.displayName || '',
    photo: user.photoURL || '',
    walletAddress: wallet.address,
    walletKeystoreCloud,
    walletModel: 'google_device_pin_v1',
    chainId: POLYGON_CHAIN_ID,
    network: 'polygon',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }

  await setDoc(userRef, payload)

  saveLocalDeviceWallet({
    uid: user.uid,
    walletAddress: wallet.address,
    walletKeystoreLocal,
    chainId: POLYGON_CHAIN_ID,
    network: 'polygon'
  })

  currentWalletAddress = wallet.address

  localStorage.setItem(
    'vwala_wallet_profile',
    JSON.stringify({
      uid: user.uid,
      walletAddress: wallet.address,
      chainId: POLYGON_CHAIN_ID,
      network: 'polygon'
    })
  )

  await showMessageModal(
    'Carteira criada',
    'Carteira criada com sucesso. Neste aparelho seu PIN já ficou definido.'
  )

  return payload
}

function getSwapErrorMessage(error, mode = 'buy') {
  const rawMessage = String(error?.shortMessage || error?.message || '').toLowerCase()

  if (
    rawMessage.includes('invalid password') ||
    rawMessage.includes('wrong password') ||
    rawMessage.includes('incorrect password')
  ) {
    return 'PIN incorreto. Tente novamente.'
  }

  if (rawMessage.includes('insufficient funds')) {
    return mode === 'buy'
      ? `Saldo insuficiente. Mantenha pelo menos ${POL_GAS_RESERVE} POL livre para gás.`
      : `Você precisa manter pelo menos ${POL_GAS_RESERVE} POL para pagar o gás da venda.`
  }

  if (
    rawMessage.includes('network error') ||
    rawMessage.includes('failed to fetch') ||
    rawMessage.includes('timeout')
  ) {
    return 'Falha de rede ao executar o swap. Tente novamente.'
  }

  return mode === 'buy'
    ? 'Não foi possível concluir a compra agora.'
    : 'Não foi possível concluir a venda agora.'
}

async function loginWithGoogle() {
  if (!googleLoginBtn) return

  const originalText = googleLoginBtn.textContent

  try {
    googleLoginBtn.disabled = true
    googleLoginBtn.textContent = 'Entrando...'

    await setPersistence(auth, browserLocalPersistence)

    try {
      await signInWithPopup(auth, googleProvider)
    } catch (error) {
      if (
        error?.code === 'auth/popup-blocked' ||
        error?.code === 'auth/operation-not-supported-in-this-environment'
      ) {
        await signInWithRedirect(auth, googleProvider)
        return
      }

      throw error
    }
  } catch (error) {
    console.error('Erro ao entrar com Google:', error)

    await showMessageModal(
      'Erro de login',
      'Não foi possível entrar com Google.'
    )
  } finally {
    googleLoginBtn.disabled = false
    googleLoginBtn.textContent = originalText
  }
}

async function handleBuyVWala() {
  const normalizedAmount = getCurrentNormalizedInput()

  if (!normalizedAmount) {
    await showMessageModal('Valor inválido', 'Informe um valor para a compra.')
    return
  }

  let amountWei
  let amountNumber

  try {
    amountWei = parseEther(normalizedAmount)
    amountNumber = Number(normalizedAmount)
  } catch (error) {
    await showMessageModal('Valor inválido', 'Digite um valor válido em POL.')
    return
  }

  if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
    await showMessageModal('Valor inválido', 'Digite um valor maior que zero.')
    return
  }

  const confirmBuy = await showConfirmModal(
    'Confirmar compra',
    `<strong>Você vai enviar:</strong><br>${escapeHtml(formatAmount(normalizedAmount, 'POL'))}<br><br><strong>Você vai receber:</strong><br>${escapeHtml(formatAmount(normalizedAmount, 'vWALA'))}<br><br><strong>Reserva mínima após a compra:</strong><br>${escapeHtml(formatAmount(POL_GAS_RESERVE, 'POL'))}`,
    'Comprar',
    'Cancelar'
  )

  if (!confirmBuy) {
    return
  }

  const pin = await showPinModal(
    'Confirmar PIN',
    'Digite seu PIN para autorizar a compra.',
    'Comprar'
  )

  if (pin === null) {
    return
  }

  if (!pin || pin.trim().length < 6) {
    await showMessageModal('PIN inválido', 'Digite seu PIN para continuar.')
    return
  }

  try {
    swapState.isSubmitting = true
    syncSwapUI()

    showLoadingModal(
      'Executando compra',
      'Aguarde enquanto a transação é assinada e enviada.'
    )

    const walletProfile = await getCurrentUserWalletProfile()
    const deviceVault = await ensureDeviceWalletAccess(currentGoogleUser, walletProfile)

    if (!deviceVault?.walletKeystoreLocal) {
      throw new Error('PIN deste aparelho ainda não configurado.')
    }

    const provider = getProvider('swap_exec_buy', POLYGON_RPC_PRIMARY_URL)
    const unlockedWallet = await Wallet.fromEncryptedJson(
      deviceVault.walletKeystoreLocal,
      pin.trim()
    )
    const signer = unlockedWallet.connect(provider)
    const poolContract = getPoolContract(signer)

    const liveBalanceWei = await provider.getBalance(signer.address)
    const feeData = await provider.getFeeData()
    const gasEstimate = await poolContract.buy.estimateGas({ value: amountWei })
    const gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas ?? 0n
    const estimatedFeeWei = gasEstimate * gasPrice
    const gasReserveWei = parseEther(POL_GAS_RESERVE)

    if (liveBalanceWei < amountWei + estimatedFeeWei + gasReserveWei) {
      hideLoadingModal()

      await showMessageModal(
        'Reserva de gás',
        `Você precisa manter pelo menos ${POL_GAS_RESERVE} POL livre para gás.`
      )
      return
    }

    const tx = await poolContract.buy({ value: amountWei })

showLoadingModal(
  'Confirmando na rede',
  'Aguarde a confirmação da compra na Polygon.'
)

const receipt = await tx.wait()
const confirmedTxHash = receipt?.hash || tx?.hash || ''

if (!confirmedTxHash) {
  throw new Error('Compra confirmada sem tx hash.')
}

await saveConfirmedBuyVWalaToFirebase({
  userId: currentGoogleUser.uid,
  walletAddress: signer.address,
  amount: normalizedAmount,
  txHash: confirmedTxHash
})

hideLoadingModal()
currentWalletAddress = signer.address
await loadSwapData(signer.address)

document.getElementById('swapAmountInput').value = ''

await showMessageModal(
  'Compra concluída',
  `<strong>Compra confirmada com sucesso.</strong><br><br><strong>Recebido:</strong><br>${escapeHtml(formatAmount(normalizedAmount, 'vWALA'))}<br><br><strong>Hash:</strong><br>${escapeHtml(formatTxHash(confirmedTxHash))}`
)
  } catch (error) {
    hideLoadingModal()
    console.error('Erro ao executar compra:', error)

    await showMessageModal(
      'Erro na compra',
      getSwapErrorMessage(error, 'buy')
    )
  } finally {
    swapState.isSubmitting = false
    syncSwapUI()
  }
}

async function handleSellVWala() {
  const normalizedAmount = getCurrentNormalizedInput()

  if (!normalizedAmount) {
    await showMessageModal('Valor inválido', 'Informe um valor para a venda.')
    return
  }

  let amountNumber

  try {
    amountNumber = Number(normalizedAmount)
  } catch (error) {
    amountNumber = NaN
  }

  if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
    await showMessageModal('Valor inválido', 'Digite um valor maior que zero.')
    return
  }

  if (Number(swapState.polBalance || 0) < Number(POL_GAS_RESERVE)) {
    await showMessageModal(
      'POL insuficiente',
      `Você precisa manter pelo menos ${POL_GAS_RESERVE} POL na carteira para pagar o gás da venda.`
    )
    return
  }

  const confirmSell = await showConfirmModal(
    'Confirmar venda',
    `<strong>Você vai vender:</strong><br>${escapeHtml(formatAmount(normalizedAmount, 'vWALA'))}<br><br><strong>Você vai receber:</strong><br>${escapeHtml(formatAmount(normalizedAmount, 'POL'))}`,
    'Vender',
    'Cancelar'
  )

  if (!confirmSell) {
    return
  }

  const pin = await showPinModal(
    'Confirmar PIN',
    'Digite seu PIN para autorizar a venda.',
    'Vender'
  )

  if (pin === null) {
    return
  }

  if (!pin || pin.trim().length < 6) {
    await showMessageModal('PIN inválido', 'Digite seu PIN para continuar.')
    return
  }

  try {
    swapState.isSubmitting = true
    syncSwapUI()

    showLoadingModal(
      'Preparando venda',
      'Aguarde enquanto validamos saldo, aprovação e envio da venda.'
    )

    const walletProfile = await getCurrentUserWalletProfile()
    const deviceVault = await ensureDeviceWalletAccess(currentGoogleUser, walletProfile)

    if (!deviceVault?.walletKeystoreLocal) {
      throw new Error('PIN deste aparelho ainda não configurado.')
    }

    const provider = getProvider('swap_exec_sell', POLYGON_RPC_PRIMARY_URL)
    const unlockedWallet = await Wallet.fromEncryptedJson(
      deviceVault.walletKeystoreLocal,
      pin.trim()
    )
    const signer = unlockedWallet.connect(provider)
    const poolContract = getPoolContract(signer)
    const tokenContract = getTokenContract(signer)

    const signerAddress = String(signer.address || '').toLowerCase()
    const currentAddress = String(currentWalletAddress || '').toLowerCase()

    if (signerAddress && signerAddress !== currentAddress) {
      currentWalletAddress = signer.address
    }

    const amountUnits = parseUnits(normalizedAmount, swapState.tokenDecimals)

    const [firebaseVWalaBalance, liveRedeemable] = await Promise.all([
  currentGoogleUser?.uid
    ? readFirebaseVWalaBalance(currentGoogleUser.uid, signer.address)
    : Promise.resolve('0'),
  poolContract.maxRedeemable(signer.address)
])

const firebaseBalanceNumber = Number(firebaseVWalaBalance || 0)

console.log('[SWAP_SELL_GATE]', {
  signerAddress: signer.address,
  firebaseVWalaBalance,
  liveRedeemableRaw: liveRedeemable.toString(),
  liveRedeemableFormatted: formatUnits(liveRedeemable, swapState.tokenDecimals),
  requestedAmount: normalizedAmount,
  requestedAmountRaw: amountUnits.toString()
})

if (!Number.isFinite(firebaseBalanceNumber) || firebaseBalanceNumber < amountNumber) {
  hideLoadingModal()

  await showMessageModal(
    'Saldo insuficiente',
    'Seu saldo de vWALA salvo no app não cobre a venda informada.'
  )
  return
}

console.log('[SWAP_SELL_GATE]', {
  signerAddress: signer.address,
  firebaseVWalaBalance,
  liveRedeemable: formatUnits(liveRedeemable, swapState.tokenDecimals),
  requestedAmount: normalizedAmount
})

if (liveRedeemable < amountUnits) {
      hideLoadingModal()
      await loadSwapData(signer.address)

      await showMessageModal(
        'Limite de venda',
        `Neste momento você pode vender no máximo ${formatAmount(formatUnits(liveRedeemable, swapState.tokenDecimals), 'vWALA')}.`
      )
      return
    }

    const allowance = await tokenContract.allowance(
      signer.address,
      VWALA_POOL_ADDRESS
    )

const feeData = await provider.getFeeData()
const gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas ?? 0n
const gasReserveWei = parseEther(POL_GAS_RESERVE)

let approveGasEstimate = 0n

if (allowance < amountUnits) {
  approveGasEstimate = await tokenContract.approve.estimateGas(
    VWALA_POOL_ADDRESS,
    amountUnits
  )
}

let liveBalanceWei = await provider.getBalance(signer.address)

if (allowance < amountUnits) {
  const approveFeeWei = approveGasEstimate * gasPrice

  if (liveBalanceWei < approveFeeWei + gasReserveWei) {
    hideLoadingModal()

    await showMessageModal(
      'POL insuficiente',
      `Você precisa manter pelo menos ${POL_GAS_RESERVE} POL na carteira para pagar a aprovação e a venda.`
    )
    return
  }

  showLoadingModal(
    'Aprovando vWALA',
    'Aguarde a aprovação do token.'
  )

  const approveTx = await tokenContract.approve(
    VWALA_POOL_ADDRESS,
    amountUnits
  )

  await approveTx.wait()

  liveBalanceWei = await provider.getBalance(signer.address)
}

const sellGasEstimate = await poolContract.sell.estimateGas(amountUnits)
const sellFeeWei = sellGasEstimate * gasPrice

console.log('[SWAP_SELL_ESTIMATE]', {
  signerAddress: signer.address,
  sellGasEstimate: sellGasEstimate.toString(),
  gasPrice: gasPrice.toString(),
  sellFeeWei: sellFeeWei.toString(),
  amountUnits: amountUnits.toString(),
  amountFormatted: formatUnits(amountUnits, swapState.tokenDecimals)
})

if (liveBalanceWei < sellFeeWei + gasReserveWei) {
  hideLoadingModal()

  await showMessageModal(
    'POL insuficiente',
    `Você precisa manter pelo menos ${POL_GAS_RESERVE} POL na carteira para concluir a venda.`
  )
  return
}

showLoadingModal(
  'Vendendo vWALA',
  'Aguarde a confirmação da venda.'
)

const tx = await poolContract.sell(amountUnits)
    const receipt = await tx.wait()
    const confirmedTxHash = receipt?.hash || tx?.hash || ''

    if (!confirmedTxHash) {
      throw new Error('Venda confirmada sem tx hash.')
    }

    await saveConfirmedSellVWalaToFirebase({
      userId: currentGoogleUser.uid,
      walletAddress: signer.address,
      amount: normalizedAmount,
      txHash: confirmedTxHash
    })

    hideLoadingModal()
    currentWalletAddress = signer.address
    await loadSwapData(signer.address)

    document.getElementById('swapAmountInput').value = ''

    await showMessageModal(
      'Venda concluída',
      `<strong>Venda confirmada com sucesso.</strong><br><br><strong>Recebido:</strong><br>${escapeHtml(formatAmount(normalizedAmount, 'POL'))}<br><br><strong>Hash:</strong><br>${escapeHtml(formatTxHash(confirmedTxHash))}`
    )
  } catch (error) {
    hideLoadingModal()
    console.error('Erro ao executar venda:', {
  shortMessage: error?.shortMessage || '',
  message: error?.message || '',
  code: error?.code || '',
  reason: error?.reason || '',
  data: error?.data || error?.error?.data || error?.info?.error?.data || '',
  currentWalletAddress,
  swapState: {
    polBalance: swapState.polBalance,
    vwalaBalance: swapState.vwalaBalance,
    redeemableNow: swapState.redeemableNow,
    tokenDecimals: swapState.tokenDecimals
  }
})

    await showMessageModal(
      'Erro na venda',
      getSwapErrorMessage(error, 'sell')
    )
  } finally {
    swapState.isSubmitting = false
    syncSwapUI()
  }
}

async function handleSubmitSwap() {
  if (!currentGoogleUser) {
    openAuthGate()
    return
  }

  if (!currentWalletAddress) {
    await showMessageModal('Carteira', 'Carteira ainda não carregada.')
    return
  }

  if (swapState.mode === 'buy') {
    await handleBuyVWala()
    return
  }

  await handleSellVWala()
}


// ====================== PIN DO SWAP - TECLADO NUMÉRICO + ANTI-AUTOFILL ======================

if (uiModalInput) {
  uiModalInput.addEventListener('input', function () {
    this.value = this.value.replace(/[^0-9]/g, '').slice(0, 6)
  })

  uiModalInput.addEventListener('focus', function () {
    this.value = ''
    setTimeout(() => this.focus(), 10)
  })

  uiModalInput.addEventListener('paste', function (e) {
    e.preventDefault()
    const text = (e.clipboardData || window.clipboardData).getData('text')
    this.value = text.replace(/[^0-9]/g, '').slice(0, 6)
  })

  uiModalInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      closeUiModal(uiModalInput.value)
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      closeUiModal(null)
    }
  })
}

// Reforço ao abrir o modal de PIN
const originalShowPinModal = showPinModal
showPinModal = async function (title, text, confirmText = 'Continuar') {
  const result = await originalShowPinModal.call(this, title, text, confirmText)

  setTimeout(() => {
    if (uiModalInput) {
      uiModalInput.value = ''
      uiModalInput.type = 'tel'
      uiModalInput.setAttribute('autocomplete', 'new-password')
      uiModalInput.setAttribute('data-form-type', 'other')
      uiModalInput.focus()
    }
  }, 150)

  return result
}

async function initFirebaseAuthGate() {
  try {
    await setPersistence(auth, browserLocalPersistence)

    onAuthStateChanged(auth, async (user) => {
      currentGoogleUser = user || null
      saveFirebaseUser(user)

      if (user) {
        closeAuthGate()

        try {
          const walletProfile = await ensureUserWalletProfile(user)

          const walletAddressToLoad = String(
            walletProfile?.walletAddress ||
            currentWalletAddress ||
            ''
          ).trim()

          if (walletAddressToLoad) {
            currentWalletAddress = walletAddressToLoad

            console.log('[SWAP LOAD ADDRESS]', {
              currentWalletAddress,
              firestoreWalletAddress: walletProfile?.walletAddress || ''
            })

            await loadSwapData(currentWalletAddress)
          } else {
            await loadSwapData('')
          }
        } catch (error) {
          console.error('Erro ao preparar carteira do usuário:', error)

          await showMessageModal(
            'Erro da carteira',
            error?.message || 'Não foi possível preparar sua carteira.'
          )
        }

        return
      }

      currentWalletAddress = ''
      swapState.polBalance = '0'
      swapState.vwalaBalance = '0'
      swapState.redeemableNow = '0'
      updateDashboardUI()
      openAuthGate()
      await loadSwapData('')
    })
  } catch (error) {
    console.error('Erro ao iniciar autenticação Firebase:', error)
    openAuthGate()
  }
}

document.getElementById('swapBackBtn')?.addEventListener('click', () => {
  if (window.history.length > 1) {
    window.history.back()
    return
  }

  window.location.href = '/'
})

document.getElementById('swapTabBuy')?.addEventListener('click', () => {
  setSwapMode('buy')
})

document.getElementById('swapTabSell')?.addEventListener('click', () => {
  setSwapMode('sell')
})

document.getElementById('swapAmountInput')?.addEventListener('input', () => {
  syncSwapUI()
})

document.getElementById('swapMaxBtn')?.addEventListener('click', () => {
  const input = document.getElementById('swapAmountInput')

  if (!input) return

  input.value = swapState.mode === 'buy'
    ? getMaxBuyAmount()
    : getMaxSellAmount()

  syncSwapUI()
})

document.getElementById('swapSubmitBtn')?.addEventListener('click', async () => {
  await handleSubmitSwap()
})

googleLoginBtn?.addEventListener('click', loginWithGoogle)

uiModalConfirmBtn?.addEventListener('click', async () => {
  if (modalState.mode === 'prompt') {
    closeUiModal(uiModalInput.value)
    return
  }

  closeUiModal(true)
})

uiModalCancelBtn?.addEventListener('click', () => {
  if (modalState.mode === 'prompt') {
    return
  }

  closeUiModal(null)
})

uiModalCloseBtn?.addEventListener('click', () => {
  if (modalState.mode === 'prompt') {
    return
  }

  closeUiModal(null)
})

uiModal?.addEventListener('click', (event) => {
  if (event.target === uiModal) {
    return
  }
})

uiModalInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault()
    closeUiModal(uiModalInput.value)
    return
  }

  if (event.key === 'Escape') {
    event.preventDefault()
    return
  }
})

updateDashboardUI()
syncSwapUI()
initFirebaseAuthGate()
