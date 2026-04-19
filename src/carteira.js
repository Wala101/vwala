import { auth, db, googleProvider } from './firebase'
import {
  browserLocalPersistence,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signInWithRedirect
} from 'firebase/auth'
import { collection, doc, getDoc, getDocs, setDoc, serverTimestamp } from 'firebase/firestore'
import { Contract, JsonRpcProvider, Wallet, formatEther, formatUnits, isAddress, parseEther, parseUnits } from 'ethers'
import QRCode from 'qrcode'

const app = document.querySelector('#app')

if (!app) {
  throw new Error('Elemento #app não encontrado.')
}

const walletState = {
  polBalance: '12.85',
  vwalaBalance: '0.00',
  userTokens: []
}

let currentGoogleUser = null
let currentWalletAddress = ''
let polygonBalanceLoadCounter = 0
let vwalaBalanceLoadCounter = 0

const modalState = {
  resolve: null,
  mode: 'message',
  addressText: ''
}

const POLYGON_RPC_URL =
  String(import.meta.env.VITE_POLYGON_RPC_URL || '').trim() ||
  new URL(`/api/rpc?ts=${Date.now()}`, window.location.origin).toString()
const POLYGON_CHAIN_ID = Number(import.meta.env.VITE_POLYGON_CHAIN_ID || 137)
const DEVICE_WALLET_STORAGE_KEY = 'vwala_device_wallet'
const CREATED_TOKENS_STORAGE_KEY = 'vwala_created_tokens'
const CLOUD_PASSWORD_SALT = 'vwala_google_device_pin_v1'

const VWALA_TOKEN_ADDRESS = '0x7bD1f6f4F5CEf026b643758605737CB48b4B7D83'
const VWALA_POOL_ADDRESS = '0x5c950A2FA20A48DDcb4952910e550Ac59fd21AF7'
const POL_GAS_RESERVE = '0.05'
const CARTEIRA_BUILD_TAG = 'carteira-debug-2026-04-18-01'

console.log('[CARTEIRA BUILD]', CARTEIRA_BUILD_TAG)

function maskRpcUrl(url = '') {
  return String(url || '')
    .replace(/(\/v2\/)[^/?#]+/i, '$1***')
    .replace(/([?&](?:api[-_]?key|key)=)[^&]+/i, '$1***')
}

function createRpcProbeUrl(label = 'carteira_runtime') {
  const url = new URL(POLYGON_RPC_URL, window.location.origin)
  url.searchParams.set('_ts', String(Date.now()))
  url.searchParams.set('_probe', label)
  return url.toString()
}

function getRpcProvider(label = 'carteira_runtime') {
  return new JsonRpcProvider(createRpcProbeUrl(label))
}

const VWALA_POOL_ABI = [
  
  'function buy() payable returns (uint256)',
  'function sell(uint256 vwalaAmount) returns (uint256)',
  'function quoteBuy(uint256 polAmountWei) view returns (uint256)',
  'function quoteSell(uint256 vwalaAmount) view returns (uint256)'
]

const ERC20_TOKEN_ABI = [
  'function decimals() view returns (uint8)',
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transfer(address to, uint256 amount) returns (bool)'
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

function updateWalletAddressUI(address = '') {
  const walletAddressText = document.getElementById('walletAddressText')
  if (walletAddressText) {
    walletAddressText.textContent = formatWalletAddress(address)
  }
}

function updatePolygonBalanceUI(value = '0') {
  walletState.polBalance = value

  const mainBalanceValue = document.querySelector('.wallet-balance-value')
  if (mainBalanceValue) {
    mainBalanceValue.innerHTML = `
      ${Number(value || 0).toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 6
      })}
      <span class="wallet-balance-symbol">POL</span>
    `
  }

  const polBalanceStrong = document.querySelector(
    '.wallet-token-list .wallet-token-card:first-child .wallet-token-balance strong'
  )

  if (polBalanceStrong) {
    polBalanceStrong.textContent = formatAmount(value, 'POL')
  }
}

function updateVWalaBalanceUI(value = '0') {
  walletState.vwalaBalance = value

  console.log('[vWALA UI UPDATE]', {
    build: CARTEIRA_BUILD_TAG,
    value
  })

  const vwalaChip = document.querySelector('.wallet-vwala-chip')
  if (vwalaChip) {
    vwalaChip.textContent = formatAmount(value, 'vWALA')
  }

  const vwalaBalanceStrong = document.querySelector(
    '.wallet-token-list .wallet-token-card:nth-child(2) .wallet-token-balance strong'
  )

  if (vwalaBalanceStrong) {
    vwalaBalanceStrong.textContent = formatAmount(value, 'vWALA')
  }
}

async function loadPolygonBalance(walletAddress) {
  const requestId = ++polygonBalanceLoadCounter

  try {
    if (!walletAddress) return

    const provider = getRpcProvider(`carteira_pol_balance_${requestId}`)
    const balanceWei = await provider.getBalance(walletAddress)
    const balanceFormatted = formatEther(balanceWei)

    if (requestId !== polygonBalanceLoadCounter) {
      return
    }

    updatePolygonBalanceUI(balanceFormatted)

    console.log('[POL BALANCE READ]', {
      build: CARTEIRA_BUILD_TAG,
      walletAddress,
      balanceFormatted
    })
  } catch (error) {
    console.error('Erro ao carregar saldo POL:', error)

    if (requestId === polygonBalanceLoadCounter) {
      updatePolygonBalanceUI('0')
    }
  }
}

async function loadVWalaBalance(walletAddress) {
  const requestId = ++vwalaBalanceLoadCounter
  const groupLabel = `[CARTEIRA_VWALA_BALANCE_READ_${requestId}]`

  console.groupCollapsed(groupLabel)

  try {
    if (!walletAddress) return

    const provider = getRpcProvider(`carteira_vwala_balance_${requestId}`)
    const network = await provider.getNetwork()
    const chainId = Number(network.chainId)

    if (chainId !== 137) {
      throw new Error(`RPC fora da Polygon Mainnet. chainId atual: ${chainId}`)
    }

    const tokenContract = new Contract(
      VWALA_TOKEN_ADDRESS,
      ERC20_TOKEN_ABI,
      provider
    )

    const [blockNumber, decimalsRaw, balanceRaw] = await Promise.all([
      provider.getBlockNumber(),
      tokenContract.decimals().catch(() => 18),
      tokenContract.balanceOf(walletAddress)
    ])

    if (requestId !== vwalaBalanceLoadCounter) {
      console.warn('Leitura antiga descartada.', { requestId, activeRequestId: vwalaBalanceLoadCounter })
      return
    }

    const decimals = Number(decimalsRaw || 18)
    const balanceFormatted = formatUnits(balanceRaw, decimals)

    console.log('selected_balance_read', {
      build: CARTEIRA_BUILD_TAG,
      source: `ethers_provider_${requestId}`,
      rpcUrl: maskRpcUrl(createRpcProbeUrl(`carteira_vwala_balance_${requestId}`)),
      chainId,
      blockNumber: Number(blockNumber),
      walletAddress,
      tokenAddress: VWALA_TOKEN_ADDRESS,
      decimals,
      balanceRaw: balanceRaw.toString(),
      balanceFormatted
    })

    updateVWalaBalanceUI(balanceFormatted)
  } catch (error) {
    console.error('Erro ao carregar saldo vWALA:', error)

    if (requestId === vwalaBalanceLoadCounter) {
      updateVWalaBalanceUI('0')
    }
  } finally {
    console.groupEnd()
  }
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function formatTxHash(hash = '') {
  if (!hash) return ''
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`
}

function normalizeAmountInput(value = '') {
  return String(value || '').replace(',', '.').trim()
}

function buildCloudPassword(user) {
  if (!user?.uid) {
    throw new Error('Usuário inválido para gerar acesso da carteira.')
  }

  return `${CLOUD_PASSWORD_SALT}:${user.uid}`
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

function formatTokenSupply(value = '0', symbol = '') {
  const num = Number(value || 0)

  if (!Number.isFinite(num)) {
    return `0 ${symbol}`.trim()
  }

  return `${num.toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  })} ${symbol}`.trim()
}

function normalizeCreatedTokenForWallet(token = {}) {
  const tokenAddress = String(
    token.tokenAddress || token.tokenAddressLower || token.address || ''
  ).trim()

  if (!tokenAddress) {
    return null
  }

  return {
    tokenAddress,
    name: String(token.name || 'Token criado'),
    symbol: String(token.symbol || 'TOKEN'),
    balance: String(token.supply || token.initialSupply || '0'),
    caption: token.createdOn
      ? `Feito no ${token.createdOn}`
      : 'Token do usuário',
    createdAt: String(token.createdAtClient || token.createdAt || ''),
    imageUrl: String(
      token.imageDataUrl ||
      token.imageUrl ||
      token.logoUrl ||
      token.logo ||
      token.draft?.metadata?.image ||
      ''
    ).trim()
  }
}

function readLocalCreatedTokens() {
  try {
    const raw = localStorage.getItem(CREATED_TOKENS_STORAGE_KEY)
    if (!raw) return []

    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []

    return parsed
      .map((token) => normalizeCreatedTokenForWallet(token))
      .filter(Boolean)
  } catch (error) {
    console.error('Erro ao ler tokens locais criados:', error)
    return []
  }
}

function mergeCreatedTokens(...groups) {
  const map = new Map()

  groups
    .flat()
    .filter(Boolean)
    .forEach((token) => {
      const key = String(token.tokenAddress || '').toLowerCase()

      if (!key) return
      if (!map.has(key)) {
        map.set(key, token)
      }
    })

  return Array.from(map.values()).sort((a, b) =>
    String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
  )
}

function updateUserTokensListUI() {
  const container = document.getElementById('walletUserTokensContainer')

  if (container) {
    container.innerHTML = renderUserTokens()
  }
}

async function loadCreatedTokensFromFirestore(uid = '') {
  if (!uid) return []

  try {
    const tokensRef = collection(db, 'users', uid, 'createdTokens')
    const snapshot = await getDocs(tokensRef)

    return snapshot.docs
      .map((docSnap) => normalizeCreatedTokenForWallet(docSnap.data()))
      .filter(Boolean)
  } catch (error) {
    console.error('Erro ao carregar tokens do Firestore:', error)
    return []
  }
}

async function refreshUserCreatedTokens(uid = '') {
  const localTokens = readLocalCreatedTokens()
  const cloudTokens = uid ? await loadCreatedTokensFromFirestore(uid) : []

  walletState.userTokens = mergeCreatedTokens(cloudTokens, localTokens)
  updateUserTokensListUI()
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
  if (walletProfile?.walletKeystoreCloud) {
    try {
      const unlockedWallet = await Wallet.fromEncryptedJson(
        walletProfile.walletKeystoreCloud,
        buildCloudPassword(user)
      )

      return String(unlockedWallet.address || '').trim()
    } catch (error) {
      console.error('Erro ao resolver wallet pelo keystore cloud:', error)
    }
  }

  if (walletProfile?.walletAddress) {
    return String(walletProfile.walletAddress).trim()
  }

  try {
    const rawWalletProfile = localStorage.getItem('vwala_wallet_profile')
    if (rawWalletProfile) {
      const parsedWalletProfile = JSON.parse(rawWalletProfile)

      if (
        parsedWalletProfile?.uid === user?.uid &&
        parsedWalletProfile?.walletAddress
      ) {
        return String(parsedWalletProfile.walletAddress).trim()
      }
    }
  } catch (error) {
    console.error('Erro ao ler vwala_wallet_profile local:', error)
  }

  const localVault = getLocalDeviceWallet()

  if (localVault?.uid === user?.uid && localVault?.walletAddress) {
    return String(localVault.walletAddress).trim()
  }

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
  updateWalletAddressUI(currentWalletAddress)

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

async function promptCreateDevicePin() {
  const pin = await showPinModal(
    'Criar PIN neste aparelho',
    'Crie um novo PIN para usar sua carteira neste aparelho.',
    'Continuar'
  )

  if (pin === null) {
    return null
  }

  if (!pin || pin.trim().length < 6) {
    await showMessageModal(
      'PIN inválido',
      'Use pelo menos 6 caracteres.'
    )
    return null
  }

  const confirmPin = await showPinModal(
    'Confirmar PIN',
    'Confirme o novo PIN deste aparelho.',
    'Confirmar'
  )

  if (confirmPin === null) {
    return null
  }

  if (pin !== confirmPin) {
    await showMessageModal(
      'PIN diferente',
      'Os PINs não coincidem.'
    )
    return null
  }

  return pin.trim()
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

function getSendErrorMessage(error) {
  const rawMessage = String(error?.shortMessage || error?.message || '').toLowerCase()

  if (
    rawMessage.includes('invalid password') ||
    rawMessage.includes('wrong password') ||
    rawMessage.includes('incorrect password')
  ) {
    return 'PIN incorreto. Tente novamente.'
  }

  if (rawMessage.includes('insufficient funds')) {
    return 'Saldo insuficiente para cobrir o valor e a taxa de rede.'
  }

  if (
    rawMessage.includes('network error') ||
    rawMessage.includes('failed to fetch') ||
    rawMessage.includes('timeout')
  ) {
    return 'Falha de rede ao enviar. Tente novamente.'
  }

  return 'Não foi possível concluir o envio agora.'
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

async function handleSendPolygon() {
  if (!currentGoogleUser) {
    openAuthGate()
    return
  }

  if (!currentWalletAddress) {
    await showMessageModal(
      'Carteira',
      'Carteira ainda não carregada.'
    )
    return
  }

  const destinationInput = await showPromptModal({
    title: 'Enviar',
    text: 'Informe o endereço que vai receber Polygon.',
    confirmText: 'Continuar',
    cancelText: 'Cancelar',
    placeholder: '0x...'
  })

  if (destinationInput === null) {
    return
  }

  const destinationAddress = destinationInput.trim()

  if (!destinationAddress) {
    await showMessageModal(
      'Endereço inválido',
      'Informe o endereço de destino.'
    )
    return
  }

  if (!isAddress(destinationAddress)) {
    await showMessageModal(
      'Endereço inválido',
      'Digite um endereço Polygon válido.'
    )
    return
  }

  if (destinationAddress.toLowerCase() === currentWalletAddress.toLowerCase()) {
    await showMessageModal(
      'Endereço inválido',
      'Você não pode enviar para a sua própria carteira.'
    )
    return
  }

  const amountInput = await showPromptModal({
    title: 'Valor',
    text: 'Informe quanto Polygon deseja enviar.',
    confirmText: 'Continuar',
    cancelText: 'Cancelar',
    placeholder: '0.10'
  })

  if (amountInput === null) {
    return
  }

  const normalizedAmount = normalizeAmountInput(amountInput)

  if (!normalizedAmount) {
    await showMessageModal(
      'Valor inválido',
      'Informe um valor para enviar.'
    )
    return
  }

  let amountWei
  let amountNumber

  try {
    amountWei = parseEther(normalizedAmount)
    amountNumber = Number(normalizedAmount)
  } catch (error) {
    await showMessageModal(
      'Valor inválido',
      'Digite um valor válido em POL.'
    )
    return
  }

  if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
    await showMessageModal(
      'Valor inválido',
      'Digite um valor maior que zero.'
    )
    return
  }

  const confirmSend = await showConfirmModal(
    'Confirmar envio',
    `<strong>Confira os dados antes de enviar.</strong><br><br><strong>Destino:</strong><br>${escapeHtml(destinationAddress)}<br><br><strong>Valor:</strong><br>${escapeHtml(formatAmount(normalizedAmount, 'POL'))}`,
    'Enviar',
    'Cancelar'
  )

  if (!confirmSend) {
    return
  }

  const pin = await showPinModal(
    'Confirmar PIN',
    'Digite seu PIN para autorizar o envio.',
    'Enviar'
  )

  if (pin === null) {
    return
  }

  if (!pin || pin.trim().length < 6) {
    await showMessageModal(
      'PIN inválido',
      'Digite seu PIN para continuar.'
    )
    return
  }

  try {
    showLoadingModal(
      'Enviando Polygon',
      'Aguarde enquanto sua transação é assinada e enviada.'
    )

    const walletProfile = await getCurrentUserWalletProfile()
    const deviceVault = await ensureDeviceWalletAccess(
      currentGoogleUser,
      walletProfile
    )

    if (!deviceVault?.walletKeystoreLocal) {
      throw new Error('PIN deste aparelho ainda não configurado.')
    }

    const provider = getRpcProvider('carteira_send_pol')
    const unlockedWallet = await Wallet.fromEncryptedJson(
      deviceVault.walletKeystoreLocal,
      pin.trim()
    )
    const signer = unlockedWallet.connect(provider)
    currentWalletAddress = signer.address
    updateWalletAddressUI(currentWalletAddress)

    const liveBalanceWei = await provider.getBalance(signer.address)
    const feeData = await provider.getFeeData()
    const gasEstimate = await provider.estimateGas({
      from: signer.address,
      to: destinationAddress,
      value: amountWei
    })
    const gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas ?? 0n
    const estimatedFeeWei = gasEstimate * gasPrice

    if (liveBalanceWei < amountWei + estimatedFeeWei) {
      hideLoadingModal()

      await showMessageModal(
        'Saldo insuficiente',
        'Seu saldo não cobre o valor e a taxa de rede.'
      )
      return
    }

    const tx = await signer.sendTransaction({
      to: destinationAddress,
      value: amountWei
    })

    showLoadingModal(
      'Confirmando na rede',
      'Aguarde a confirmação da transação na Polygon.'
    )

    await tx.wait()

    hideLoadingModal()

    await showMessageModal(
      'Enviado com sucesso',
      `<strong>Transferência confirmada com sucesso.</strong><br><br><strong>Hash:</strong><br>${escapeHtml(formatTxHash(tx.hash))}`
    )

    await loadPolygonBalance(currentWalletAddress)

    if (currentGoogleUser?.uid) {
      await refreshUserCreatedTokens(currentGoogleUser.uid)
    }
  } catch (error) {
    hideLoadingModal()
    console.error('Erro ao enviar Polygon:', error)

    await showMessageModal(
      'Erro ao enviar',
      getSendErrorMessage(error)
    )
  }
}

function getSwapErrorMessage(error) {
  const rawMessage = String(error?.shortMessage || error?.message || '').toLowerCase()

  if (
    rawMessage.includes('invalid password') ||
    rawMessage.includes('wrong password') ||
    rawMessage.includes('incorrect password')
  ) {
    return 'PIN incorreto. Tente novamente.'
  }

  if (rawMessage.includes('insufficient funds')) {
    return `Saldo insuficiente. Mantenha pelo menos ${POL_GAS_RESERVE} POL livre para gás.`
  }

  if (
    rawMessage.includes('insufficienttokenliquidity') ||
    rawMessage.includes('insufficient token liquidity') ||
    rawMessage.includes('tokentransferfailed')
  ) {
    return 'O contrato de compra está sem liquidez suficiente de vWALA.'
  }

  if (
    rawMessage.includes('network error') ||
    rawMessage.includes('failed to fetch') ||
    rawMessage.includes('timeout')
  ) {
    return 'Falha de rede ao executar a compra. Tente novamente.'
  }

  return 'Não foi possível concluir a compra agora.'
}

function getSellVWalaErrorMessage(error) {
  const rawMessage = String(error?.shortMessage || error?.message || '').toLowerCase()

  if (
    rawMessage.includes('invalid password') ||
    rawMessage.includes('wrong password') ||
    rawMessage.includes('incorrect password')
  ) {
    return 'PIN incorreto. Tente novamente.'
  }

  if (rawMessage.includes('insufficient funds')) {
    return 'Você precisa de POL para pagar a taxa da aprovação e da venda.'
  }

  if (
    rawMessage.includes('insufficientpolliquidity') ||
    rawMessage.includes('insufficient pol liquidity')
  ) {
    return 'O contrato de venda está sem POL suficiente no momento.'
  }

  if (
    rawMessage.includes('network error') ||
    rawMessage.includes('failed to fetch') ||
    rawMessage.includes('timeout')
  ) {
    return 'Falha de rede ao executar a venda. Tente novamente.'
  }

  return 'Não foi possível concluir a venda agora.'
}

async function handleBuyVWala() {
  if (!currentGoogleUser) {
    openAuthGate()
    return
  }

  if (!currentWalletAddress) {
    await showMessageModal(
      'Carteira',
      'Carteira ainda não carregada.'
    )
    return
  }

  const amountInput = await showPromptModal({
    title: 'Comprar vWALA',
    text: `Informe quanto POL deseja trocar por vWALA. Será mantida uma reserva mínima de ${POL_GAS_RESERVE} POL para gás.`,
    confirmText: 'Continuar',
    cancelText: 'Cancelar',
    placeholder: '1'
  })

  if (amountInput === null) {
    return
  }

  const normalizedAmount = normalizeAmountInput(amountInput)

  if (!normalizedAmount) {
    await showMessageModal(
      'Valor inválido',
      'Informe um valor para a compra.'
    )
    return
  }

  let amountWei
  let amountNumber

  try {
    amountWei = parseEther(normalizedAmount)
    amountNumber = Number(normalizedAmount)
  } catch (error) {
    await showMessageModal(
      'Valor inválido',
      'Digite um valor válido em POL.'
    )
    return
  }

  if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
    await showMessageModal(
      'Valor inválido',
      'Digite um valor maior que zero.'
    )
    return
  }

  let quotedFormatted = '0'

  try {
    showLoadingModal(
      'Calculando compra',
      'Consultando o contrato para calcular quanto vWALA você vai receber.'
    )

    const provider = getRpcProvider('carteira_quote_buy')
    const poolContract = new Contract(
  VWALA_POOL_ADDRESS,
  VWALA_POOL_ABI,
  provider
)

    const tokenContract = new Contract(
      VWALA_TOKEN_ADDRESS,
      ERC20_TOKEN_ABI,
      provider
    )

    let decimals = 18

    try {
      decimals = Number(await tokenContract.decimals())
    } catch (error) {
      decimals = 18
    }

const quotedAmount = await poolContract.quoteBuy(amountWei)
    quotedFormatted = formatUnits(quotedAmount, decimals)

    hideLoadingModal()
  } catch (error) {
    hideLoadingModal()
    console.error('Erro ao consultar compra:', error)

    await showMessageModal(
      'Erro na compra',
      'Não foi possível consultar a cotação agora.'
    )
    return
  }

  const confirmSwap = await showConfirmModal(
    'Confirmar compra',
    `<strong>Você vai enviar:</strong><br>${escapeHtml(formatAmount(normalizedAmount, 'POL'))}<br><br><strong>Você vai receber:</strong><br>${escapeHtml(formatAmount(quotedFormatted, 'vWALA'))}<br><br><strong>Reserva mínima após a compra:</strong><br>${escapeHtml(formatAmount(POL_GAS_RESERVE, 'POL'))}`,
    'Comprar',
    'Cancelar'
  )

  if (!confirmSwap) {
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
    await showMessageModal(
      'PIN inválido',
      'Digite seu PIN para continuar.'
    )
    return
  }

  try {
    showLoadingModal(
      'Executando compra',
      'Aguarde enquanto a transação é assinada e enviada.'
    )

    const walletProfile = await getCurrentUserWalletProfile()
    const deviceVault = await ensureDeviceWalletAccess(
      currentGoogleUser,
      walletProfile
    )

    if (!deviceVault?.walletKeystoreLocal) {
      throw new Error('PIN deste aparelho ainda não configurado.')
    }

    const provider = getRpcProvider('carteira_exec_buy')
    const unlockedWallet = await Wallet.fromEncryptedJson(
      deviceVault.walletKeystoreLocal,
      pin.trim()
    )
    const signer = unlockedWallet.connect(provider)
    currentWalletAddress = signer.address
    updateWalletAddressUI(currentWalletAddress)

    localStorage.setItem(
      'vwala_wallet_profile',
      JSON.stringify({
        uid: currentGoogleUser.uid,
        walletAddress: signer.address,
        chainId: POLYGON_CHAIN_ID,
        network: 'polygon'
      })
    )

    await setDoc(
      doc(db, 'users', currentGoogleUser.uid),
      {
        walletAddress: signer.address,
        updatedAt: serverTimestamp()
      },
      { merge: true }
    )

    const poolContract = new Contract(
  VWALA_POOL_ADDRESS,
  VWALA_POOL_ABI,
  signer
)

    const liveBalanceWei = await provider.getBalance(signer.address)
    const feeData = await provider.getFeeData()
    const gasEstimate = await poolContract.buy.estimateGas({
  value: amountWei
})
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

    const tx = await poolContract.buy({
  value: amountWei
})

    showLoadingModal(
      'Confirmando na rede',
      'Aguarde a confirmação da compra na Polygon.'
    )

    await tx.wait()

    hideLoadingModal()

    currentWalletAddress = signer.address
    updateWalletAddressUI(currentWalletAddress)
    await loadPolygonBalance(signer.address)
    await loadVWalaBalance(signer.address)

    await showMessageModal(
      'Compra concluída',
      `<strong>Compra confirmada com sucesso.</strong><br><br><strong>Recebido:</strong><br>${escapeHtml(formatAmount(quotedFormatted, 'vWALA'))}<br><br><strong>Hash:</strong><br>${escapeHtml(formatTxHash(tx.hash))}`
    )
  } catch (error) {
    hideLoadingModal()
    console.error('Erro ao executar compra:', error)

    await showMessageModal(
      'Erro na compra',
      getSwapErrorMessage(error)
    )
  }
}

async function handleSellVWala() {
  if (!currentGoogleUser) {
    openAuthGate()
    return
  }

  if (!currentWalletAddress) {
    await showMessageModal(
      'Carteira',
      'Carteira ainda não carregada.'
    )
    return
  }

  const amountInput = await showPromptModal({
    title: 'Vender vWALA',
    text: 'Informe quanto vWALA deseja vender por POL.',
    confirmText: 'Continuar',
    cancelText: 'Cancelar',
    placeholder: '1'
  })

  if (amountInput === null) {
    return
  }

  const normalizedAmount = normalizeAmountInput(amountInput)

  if (!normalizedAmount) {
    await showMessageModal(
      'Valor inválido',
      'Informe um valor para a venda.'
    )
    return
  }

  let amountNumber

  try {
    amountNumber = Number(normalizedAmount)
  } catch (error) {
    amountNumber = NaN
  }

  if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
    await showMessageModal(
      'Valor inválido',
      'Digite um valor maior que zero.'
    )
    return
  }

  let decimals = 18
  let amountUnits
  let quotedFormatted = '0'

  try {
    showLoadingModal(
      'Calculando venda',
      'Consultando o contrato para calcular quanto POL você vai receber.'
    )

    const provider = getRpcProvider('carteira_quote_sell')
    const tokenContract = new Contract(
      VWALA_TOKEN_ADDRESS,
      ERC20_TOKEN_ABI,
      provider
    )

    const poolContract = new Contract(
  VWALA_POOL_ADDRESS,
  VWALA_POOL_ABI,
  provider
)

    try {
      decimals = Number(await tokenContract.decimals())
    } catch (error) {
      decimals = 18
    }

    amountUnits = parseUnits(normalizedAmount, decimals)

const quotedWei = await poolContract.quoteSell(amountUnits)
    quotedFormatted = formatEther(quotedWei)

    hideLoadingModal()
  } catch (error) {
    hideLoadingModal()
    console.error('Erro ao consultar venda:', error)

    await showMessageModal(
      'Erro na venda',
      'Não foi possível consultar a cotação da venda agora.'
    )
    return
  }

  const confirmSell = await showConfirmModal(
    'Confirmar venda',
    `<strong>Você vai vender:</strong><br>${escapeHtml(formatAmount(normalizedAmount, 'vWALA'))}<br><br><strong>Você vai receber:</strong><br>${escapeHtml(formatAmount(quotedFormatted, 'POL'))}`,
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
    await showMessageModal(
      'PIN inválido',
      'Digite seu PIN para continuar.'
    )
    return
  }

  try {
    showLoadingModal(
      'Preparando venda',
      'Aguarde enquanto validamos saldo, aprovação e envio da venda.'
    )

    const walletProfile = await getCurrentUserWalletProfile()
    const deviceVault = await ensureDeviceWalletAccess(
      currentGoogleUser,
      walletProfile
    )

    if (!deviceVault?.walletKeystoreLocal) {
      throw new Error('PIN deste aparelho ainda não configurado.')
    }

    const provider = getRpcProvider('carteira_exec_sell')
    const unlockedWallet = await Wallet.fromEncryptedJson(
      deviceVault.walletKeystoreLocal,
      pin.trim()
    )
    const signer = unlockedWallet.connect(provider)
    currentWalletAddress = signer.address
    updateWalletAddressUI(currentWalletAddress)

    localStorage.setItem(
      'vwala_wallet_profile',
      JSON.stringify({
        uid: currentGoogleUser.uid,
        walletAddress: signer.address,
        chainId: POLYGON_CHAIN_ID,
        network: 'polygon'
      })
    )

    await setDoc(
      doc(db, 'users', currentGoogleUser.uid),
      {
        walletAddress: signer.address,
        updatedAt: serverTimestamp()
      },
      { merge: true }
    )

    const tokenContract = new Contract(
      VWALA_TOKEN_ADDRESS,
      ERC20_TOKEN_ABI,
      signer
    )

    const poolContract = new Contract(
  VWALA_POOL_ADDRESS,
  VWALA_POOL_ABI,
  signer
)

    const tokenBalance = await tokenContract.balanceOf(signer.address)

    if (tokenBalance < amountUnits) {
      hideLoadingModal()

      await showMessageModal(
        'Saldo insuficiente',
        'Seu saldo de vWALA não cobre a venda informada.'
      )
      return
    }

    const allowance = await tokenContract.allowance(
      signer.address,
VWALA_POOL_ADDRESS
    )

    const feeData = await provider.getFeeData()
    const gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas ?? 0n

    let approveGasEstimate = 0n

    if (allowance < amountUnits) {
      approveGasEstimate = await tokenContract.approve.estimateGas(
  VWALA_POOL_ADDRESS,
  amountUnits
)
    }

const sellGasEstimate = await poolContract.sell.estimateGas(amountUnits)
    const estimatedFeeWei = (approveGasEstimate + sellGasEstimate) * gasPrice
    const liveBalanceWei = await provider.getBalance(signer.address)

    if (liveBalanceWei < estimatedFeeWei) {
      hideLoadingModal()

      await showMessageModal(
        'POL insuficiente',
        'Você precisa manter POL suficiente para pagar a taxa da aprovação e da venda.'
      )
      return
    }

    if (allowance < amountUnits) {
      showLoadingModal(
        'Aprovando vWALA',
        'Primeiro vamos aprovar o contrato de venda para usar seu vWALA.'
      )

      const approveTx = await tokenContract.approve(
  VWALA_POOL_ADDRESS,
  amountUnits
)

      await approveTx.wait()
    }

    showLoadingModal(
      'Vendendo vWALA',
      'Aguarde a confirmação da venda na Polygon.'
    )

const tx = await poolContract.sell(amountUnits)

    await tx.wait()

    hideLoadingModal()

    currentWalletAddress = signer.address
    updateWalletAddressUI(currentWalletAddress)
    await loadPolygonBalance(signer.address)
    await loadVWalaBalance(signer.address)

    await showMessageModal(
      'Venda concluída',
      `<strong>Venda confirmada com sucesso.</strong><br><br><strong>Recebido:</strong><br>${escapeHtml(formatAmount(quotedFormatted, 'POL'))}<br><br><strong>Hash:</strong><br>${escapeHtml(formatTxHash(tx.hash))}`
    )
  } catch (error) {
    hideLoadingModal()
    console.error('Erro ao executar venda:', error)

    await showMessageModal(
      'Erro na venda',
      getSellVWalaErrorMessage(error)
    )
  }
}

async function handleWalletAction(action) {
  if (action === 'enviar') {
    await handleSendPolygon()
    return
  }

  if (action === 'receber') {
    if (!currentWalletAddress) {
      await showMessageModal(
        'Carteira',
        'Carteira ainda não carregada.'
      )
      return
    }

    await showAddressModal(
      'Receber',
      currentWalletAddress,
      'Copiar'
    )

    return
  }

  if (action === 'swap') {
  window.location.href = buildSwapPageUrl()
  return
}
}

function buildLiquidityPageUrl(tokenAddress = '') {
  const url = new URL('/liquidez.html', window.location.origin)
  url.searchParams.set('token', tokenAddress)
  return url.toString()
}

function buildSwapPageUrl() {
  return new URL('/swap.html', window.location.origin).toString()
}

function getTokenModalBadgeHtml(token = {}) {
  const safeLabel = escapeHtml(token.symbol || token.name || 'TK')

  if (token.imageUrl) {
    return `<img src="${token.imageUrl}" alt="${safeLabel}" />`
  }

  return `<span class="wallet-modal-token-fallback">${safeLabel.slice(0, 2)}</span>`
}

function getTokenSendErrorMessage(error) {
  const rawMessage = String(error?.shortMessage || error?.message || '').toLowerCase()

  if (
    rawMessage.includes('invalid password') ||
    rawMessage.includes('wrong password') ||
    rawMessage.includes('incorrect password')
  ) {
    return 'PIN incorreto. Tente novamente.'
  }

  if (
    rawMessage.includes('insufficient funds') ||
    rawMessage.includes('transfer amount exceeds balance') ||
    rawMessage.includes('exceeds balance')
  ) {
    return 'Saldo insuficiente do token ou de POL para taxa.'
  }

  if (
    rawMessage.includes('network error') ||
    rawMessage.includes('failed to fetch') ||
    rawMessage.includes('timeout')
  ) {
    return 'Falha de rede ao enviar o token. Tente novamente.'
  }

  return 'Não foi possível concluir o envio do token agora.'
}

async function showCreatedTokenReceiveModal(token) {
  if (!currentWalletAddress) {
    await showMessageModal(
      'Carteira',
      'Carteira ainda não carregada.'
    )
    return
  }

  let qrDataUrl = ''

  try {
    qrDataUrl = await QRCode.toDataURL(currentWalletAddress, {
      width: 220,
      margin: 1
    })
  } catch (error) {
    console.error('Erro ao gerar QR Code do token:', error)
  }

  await openUiModal({
    title: `Receber ${token.symbol || 'TOKEN'}`,
    text: '',
    mode: 'address',
    confirmText: 'Copiar endereço',
    showCancel: false,
    addressText: currentWalletAddress,
    qrDataUrl,
    badgeHtml: getTokenModalBadgeHtml(token)
  })
}

async function handleSendCreatedToken(token) {
  if (!currentGoogleUser) {
    openAuthGate()
    return
  }

  if (!currentWalletAddress) {
    await showMessageModal(
      'Carteira',
      'Carteira ainda não carregada.'
    )
    return
  }

  const destinationInput = await showPromptModal({
    title: `Enviar ${token.symbol || 'TOKEN'}`,
    text: 'Informe o endereço que vai receber este token.',
    confirmText: 'Continuar',
    cancelText: 'Cancelar',
    placeholder: '0x...'
  })

  if (destinationInput === null) {
    return
  }

  const destinationAddress = destinationInput.trim()

  if (!destinationAddress) {
    await showMessageModal(
      'Endereço inválido',
      'Informe o endereço de destino.'
    )
    return
  }

  if (!isAddress(destinationAddress)) {
    await showMessageModal(
      'Endereço inválido',
      'Digite um endereço válido.'
    )
    return
  }

  if (destinationAddress.toLowerCase() === currentWalletAddress.toLowerCase()) {
    await showMessageModal(
      'Endereço inválido',
      'Você não pode enviar para a sua própria carteira.'
    )
    return
  }

  const amountInput = await showPromptModal({
    title: 'Quantidade',
    text: `Informe quanto ${token.symbol || 'TOKEN'} deseja enviar.`,
    confirmText: 'Continuar',
    cancelText: 'Cancelar',
    placeholder: '10'
  })

  if (amountInput === null) {
    return
  }

  const normalizedAmount = normalizeAmountInput(amountInput)

  if (!normalizedAmount) {
    await showMessageModal(
      'Quantidade inválida',
      'Informe uma quantidade para enviar.'
    )
    return
  }

  let amountNumber

  try {
    amountNumber = Number(normalizedAmount)
  } catch (error) {
    amountNumber = NaN
  }

  if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
    await showMessageModal(
      'Quantidade inválida',
      'Digite um valor maior que zero.'
    )
    return
  }

  const confirmSend = await showConfirmModal(
    `Confirmar envio de ${token.symbol || 'TOKEN'}`,
    `<strong>Confira os dados antes de enviar.</strong><br><br><strong>Token:</strong><br>${escapeHtml(token.name || 'Token')} (${escapeHtml(token.symbol || 'TOKEN')})<br><br><strong>Destino:</strong><br>${escapeHtml(destinationAddress)}<br><br><strong>Quantidade:</strong><br>${escapeHtml(normalizedAmount)} ${escapeHtml(token.symbol || 'TOKEN')}`,
    'Enviar',
    'Cancelar'
  )

  if (!confirmSend) {
    return
  }

  const pin = await showPinModal(
    'Confirmar PIN',
    'Digite seu PIN para autorizar o envio do token.',
    'Enviar'
  )

  if (pin === null) {
    return
  }

  if (!pin || pin.trim().length < 6) {
    await showMessageModal(
      'PIN inválido',
      'Digite seu PIN para continuar.'
    )
    return
  }

  try {
    showLoadingModal(
      `Enviando ${token.symbol || 'TOKEN'}`,
      'Aguarde enquanto sua transação é assinada e enviada.'
    )

    const walletProfile = await getCurrentUserWalletProfile()
    const deviceVault = await ensureDeviceWalletAccess(
      currentGoogleUser,
      walletProfile
    )

    if (!deviceVault?.walletKeystoreLocal) {
      throw new Error('PIN deste aparelho ainda não configurado.')
    }

    const provider = getRpcProvider('carteira_send_token')
    const unlockedWallet = await Wallet.fromEncryptedJson(
      deviceVault.walletKeystoreLocal,
      pin.trim()
    )
    const signer = unlockedWallet.connect(provider)

    const tokenContract = new Contract(
      token.tokenAddress,
      ERC20_TOKEN_ABI,
      signer
    )

    let decimals = 18

    try {
      decimals = Number(await tokenContract.decimals())
    } catch (error) {
      decimals = 18
    }

    const amountUnits = parseUnits(normalizedAmount, decimals)

    const tx = await tokenContract.transfer(
      destinationAddress,
      amountUnits
    )

    showLoadingModal(
      'Confirmando na rede',
      'Aguarde a confirmação da transação na Polygon.'
    )

    await tx.wait()

    hideLoadingModal()

    await showMessageModal(
      'Enviado com sucesso',
      `<strong>Transferência confirmada com sucesso.</strong><br><br><strong>Token:</strong><br>${escapeHtml(token.symbol || 'TOKEN')}<br><br><strong>Hash:</strong><br>${escapeHtml(formatTxHash(tx.hash))}`
    )

    await loadPolygonBalance(currentWalletAddress)
  } catch (error) {
    hideLoadingModal()
    console.error('Erro ao enviar token criado:', error)

    await showMessageModal(
      'Erro ao enviar token',
      getTokenSendErrorMessage(error)
    )
  }
}

async function openCreatedTokenActions(token) {
  if (!token?.tokenAddress) {
    await showMessageModal(
      'Token',
      'Mint do token não encontrado.'
    )
    return
  }

  const result = await openUiModal({
    title: token.name || 'Token criado',
    text: '',
    mode: 'token_actions',
    showCancel: false,
    addressText: token.tokenAddress,
    badgeHtml: getTokenModalBadgeHtml(token),
    customActionsHtml: `
      <button class="wallet-token-modal-action primary" type="button" data-token-modal-action="receive">Receber</button>
      <button class="wallet-token-modal-action primary" type="button" data-token-modal-action="send">Enviar</button>
      <button class="wallet-token-modal-action primary" type="button" data-token-modal-action="copy">Copiar mint</button>
      <button class="wallet-token-modal-action primary" type="button" data-token-modal-action="liquidity">Liquidez</button>
    `
  })

  if (result === 'copy') {
    try {
      await navigator.clipboard.writeText(token.tokenAddress)

      await showMessageModal(
        'Mint copiado',
        'O mint do token foi copiado com sucesso.'
      )
    } catch (error) {
      console.error('Erro ao copiar mint do token:', error)

      await showMessageModal(
        'Erro ao copiar',
        'Não foi possível copiar o mint agora.'
      )
    }

    return
  }

  if (result === 'receive') {
    await showCreatedTokenReceiveModal(token)
    return
  }

  if (result === 'send') {
    await handleSendCreatedToken(token)
    return
  }

  if (result === 'liquidity') {
    window.location.href = buildLiquidityPageUrl(token.tokenAddress)
  }
}

function renderUserTokens() {
  if (!walletState.userTokens.length) {
    return `
      <div class="wallet-empty">
        Nenhum token criado pelo usuário ainda.
      </div>
    `
  }

  return walletState.userTokens
    .map((token) => {
      const iconHtml = token.imageUrl
        ? `<img src="${token.imageUrl}" alt="${escapeHtml(token.symbol)}" />`
        : 'T'

      return `
  <div
    class="wallet-token-card"
    data-token-address="${escapeHtml(token.tokenAddress)}"
    role="button"
    tabindex="0"
    title="Abrir ações do token"
  >
    <div class="wallet-token-left">
      <div class="wallet-token-icon user">${iconHtml}</div>
      <div class="wallet-token-info">
        <div class="wallet-token-name">${escapeHtml(token.name)}</div>
        <div class="wallet-token-symbol">${escapeHtml(token.symbol)}</div>
      </div>
    </div>

    <div class="wallet-token-balance">
      <strong>${formatTokenSupply(token.balance, token.symbol)}</strong>
      <small>${escapeHtml(token.caption || 'Token do usuário')}</small>
    </div>
  </div>
`
    })
    .join('')
}

app.innerHTML = `
  <div class="wallet-page">
    <div class="wallet-shell">
      <header class="wallet-topbar">
        <div class="wallet-brand">
          <div class="wallet-brand-badge">W</div>
          <div class="wallet-brand-text">
            <strong>vWALA</strong>
            <span>Carteira</span>
          </div>
        </div>

        <div class="wallet-vwala-chip">
          ${formatAmount(walletState.vwalaBalance, 'vWALA')}
        </div>
      </header>

      <section class="wallet-main-card">
        <div class="wallet-balance-label">Saldo em Polygon</div>
        <div class="wallet-balance-value">
          ${Number(walletState.polBalance).toLocaleString('pt-BR', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 6
          })}
          <span class="wallet-balance-symbol">POL</span>
        </div>
        <div class="wallet-network">Polygon Mainnet</div>
        <div class="wallet-network" id="walletAddressText">
          ${formatWalletAddress(currentWalletAddress)}
        </div>
      </section>

      <section class="wallet-content-card">
        <section class="wallet-actions">
          <button class="wallet-action" data-action="enviar" type="button">
            <span class="wallet-action-icon">↗</span>
            <span class="wallet-action-label">Enviar</span>
          </button>

          <button class="wallet-action" data-action="receber" type="button">
            <span class="wallet-action-icon">↙</span>
            <span class="wallet-action-label">Receber</span>
          </button>

          <button class="wallet-action" data-action="swap" type="button">
  <span class="wallet-action-icon">⇄</span>
  <span class="wallet-action-label">Swap</span>
</button>
        </section>

        <section class="wallet-tabs">
          <button class="wallet-tab active" type="button">Tokens</button>
        </section>

        <section class="wallet-token-list">
          <div class="wallet-token-card">
            <div class="wallet-token-left">
              <div class="wallet-token-icon pol">
                <img src="/Polygon-MATIC.webp" alt="Polygon" />
              </div>
              <div class="wallet-token-info">
                <div class="wallet-token-name">Polygon</div>
                <div class="wallet-token-symbol">POL</div>
              </div>
            </div>

            <div class="wallet-token-balance">
              <strong>${formatAmount(walletState.polBalance, 'POL')}</strong>
              <small>Saldo principal</small>
            </div>
          </div>

          <div class="wallet-token-card">
            <div class="wallet-token-left">
              <div class="wallet-token-icon vwala">
                <img src="/logo.png" alt="vWALA" />
              </div>
              <div class="wallet-token-info">
                <div class="wallet-token-name">vWALA</div>
                <div class="wallet-token-symbol">vWALA</div>
              </div>
            </div>

            <div class="wallet-token-balance">
  <strong>${formatAmount(walletState.vwalaBalance, 'vWALA')}</strong>
  <small>Token da plataforma</small>
</div>
          </div>

          <div id="walletUserTokensContainer">
            ${renderUserTokens()}
          </div>
        </section>
      </section>
    </div>
  </div>

  <div id="authGate" class="wallet-auth-gate hidden">
    <div class="wallet-auth-modal">
      <div class="wallet-auth-badge">W</div>
      <h2>Crie sua carteira com Google</h2>
      <p>
        Entre com sua conta Google para ativar sua carteira interna e manter seu acesso em todas as páginas.
      </p>

      <button id="googleLoginBtn" class="wallet-auth-google-btn" type="button">
        Continuar com Google
      </button>
    </div>
  </div>

  <div id="uiModal" class="wallet-auth-gate hidden">
    <div class="wallet-auth-modal wallet-ui-modal-box">
      <button
        id="uiModalCloseBtn"
        class="wallet-modal-close-btn hidden"
        type="button"
        aria-label="Fechar modal"
      >
        ×
      </button>

      <div id="uiModalBadge" class="wallet-auth-badge wallet-modal-token-badge">
        <img src="/Polygon-MATIC.webp" alt="Polygon" />
      </div>
      <h2 id="uiModalTitle">Aviso</h2>
      <p id="uiModalText"></p>

      <img
        id="uiModalQr"
        class="wallet-modal-qr hidden"
        alt="QR Code da carteira"
      />

      <div id="uiModalAddressBox" class="wallet-modal-address-box hidden"></div>

      <input
        id="uiModalInput"
        class="wallet-modal-input hidden"
        type="password"
        placeholder=""
        autocomplete="off"
      />

      <div id="uiModalCustomActions" class="wallet-modal-custom-actions hidden"></div>

      <div id="uiModalActions" class="wallet-modal-actions">
        <button id="uiModalCancelBtn" class="wallet-modal-secondary-btn" type="button">
          Cancelar
        </button>

        <button id="uiModalConfirmBtn" class="wallet-auth-google-btn" type="button">
          OK
        </button>
      </div>
    </div>
  </div>

  <div id="loadingGate" class="wallet-auth-gate hidden">
    <div class="wallet-auth-modal wallet-loading-modal">
      <div class="wallet-loading-spinner" aria-hidden="true"></div>
      <h2 id="loadingModalTitle">Processando</h2>
      <p id="loadingModalText">Aguarde enquanto concluímos sua solicitação.</p>
    </div>
  </div>
`

const authGate = document.getElementById('authGate')
const googleLoginBtn = document.getElementById('googleLoginBtn')

const uiModal = document.getElementById('uiModal')
const uiModalTitle = document.getElementById('uiModalTitle')
const uiModalText = document.getElementById('uiModalText')
const uiModalAddressBox = document.getElementById('uiModalAddressBox')
const uiModalQr = document.getElementById('uiModalQr')
const uiModalInput = document.getElementById('uiModalInput')
const uiModalCancelBtn = document.getElementById('uiModalCancelBtn')
const uiModalConfirmBtn = document.getElementById('uiModalConfirmBtn')
const uiModalCloseBtn = document.getElementById('uiModalCloseBtn')
const uiModalBadge = document.getElementById('uiModalBadge')
const uiModalCustomActions = document.getElementById('uiModalCustomActions')
const uiModalActions = document.getElementById('uiModalActions')

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
  showCancel = false,
  addressText = '',
  qrDataUrl = '',
  badgeHtml = '',
  customActionsHtml = ''
} = {}) {
  return new Promise((resolve) => {
    modalState.resolve = resolve
    modalState.mode = mode
    modalState.addressText = addressText || ''

    uiModalTitle.textContent = title
    uiModalText.innerHTML = text
    uiModalText.classList.toggle('hidden', !String(text || '').trim())
    uiModalConfirmBtn.textContent = confirmText
    uiModalCancelBtn.textContent = cancelText
    uiModalCancelBtn.style.display = showCancel ? 'flex' : 'none'
    uiModalCloseBtn.classList.toggle('hidden', !['address', 'token_actions'].includes(mode))

    if (uiModalBadge) {
      uiModalBadge.innerHTML = badgeHtml || '<img src="/Polygon-MATIC.webp" alt="Polygon" />'
    }

    if (uiModalCustomActions) {
      uiModalCustomActions.innerHTML = customActionsHtml
      uiModalCustomActions.classList.toggle('hidden', !customActionsHtml)
    }

    if (uiModalActions) {
      uiModalActions.style.display = customActionsHtml ? 'none' : 'flex'
    }

    uiModalAddressBox.classList.add('hidden')
    uiModalAddressBox.textContent = ''

    uiModalQr.classList.add('hidden')
    uiModalQr.removeAttribute('src')

    if (addressText) {
      uiModalAddressBox.textContent = addressText
      uiModalAddressBox.classList.remove('hidden')
    }

    if (qrDataUrl) {
      uiModalQr.src = qrDataUrl
      uiModalQr.classList.remove('hidden')
    }

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
  modalState.addressText = ''

  if (resolve) {
    resolve(result)
  }
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
  initialValue = ''
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
    showCancel: true
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
    showCancel: true
  })
}

async function showPinModal(title, text, confirmText = 'Continuar') {
  return showPromptModal({
    title,
    text,
    confirmText,
    cancelText: 'Cancelar',
    placeholder: 'Digite seu PIN',
    password: true
  })
}

async function showAddressModal(title, address, confirmText = 'Copiar') {
  let qrDataUrl = ''

  try {
    qrDataUrl = await QRCode.toDataURL(address, {
      width: 220,
      margin: 1
    })
  } catch (error) {
    console.error('Erro ao gerar QR Code:', error)
  }

  await openUiModal({
    title,
    text: '',
    mode: 'address',
    confirmText,
    showCancel: false,
    addressText: address,
    qrDataUrl
  })
}

uiModalConfirmBtn?.addEventListener('click', async () => {
  if (modalState.mode === 'prompt') {
    closeUiModal(uiModalInput.value)
    return
  }

  if (modalState.mode === 'address') {
    if (!modalState.addressText) return

    const originalText = uiModalConfirmBtn.textContent

    try {
      await navigator.clipboard.writeText(modalState.addressText)
      uiModalConfirmBtn.textContent = 'Copiado'
    } catch (error) {
      console.error('Erro ao copiar endereço do modal:', error)
      uiModalConfirmBtn.textContent = 'Falhou'
    }

    setTimeout(() => {
      if (!uiModal.classList.contains('hidden') && modalState.mode === 'address') {
        uiModalConfirmBtn.textContent = originalText
      }
    }, 1200)

    return
  }

  if (modalState.mode === 'token_actions') {
    closeUiModal('copy')
    return
  }

  closeUiModal(true)
})

uiModalCancelBtn?.addEventListener('click', () => {
  if (modalState.mode === 'token_actions') {
    closeUiModal('liquidity')
    return
  }

  closeUiModal(null)
})

uiModalCloseBtn?.addEventListener('click', () => {
  closeUiModal(null)
})

uiModalCustomActions?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-token-modal-action]')

  if (!button) {
    return
  }

  const action = button.getAttribute('data-token-modal-action')

  if (!action) {
    return
  }

  closeUiModal(action)
})

uiModal?.addEventListener('click', (event) => {
  if (event.target === uiModal) {
    closeUiModal(null)
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
    closeUiModal(null)
  }
})

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

async function ensureUserWalletProfile(user) {
  if (!user?.uid) {
    throw new Error('Usuário inválido para criar carteira.')
  }

  const userRef = doc(db, 'users', user.uid)
  const userSnap = await getDoc(userRef)

  if (userSnap.exists()) {
    const userData = userSnap.data()
    return await syncResolvedWalletAddress(user, userData)
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
  updateWalletAddressUI(currentWalletAddress)

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
            currentWalletAddress ||
            walletProfile?.walletAddress ||
            ''
          ).trim()

          if (walletAddressToLoad) {
            currentWalletAddress = walletAddressToLoad
            updateWalletAddressUI(currentWalletAddress)

            console.log('[CARTEIRA LOAD ADDRESS]', {
              build: CARTEIRA_BUILD_TAG,
              currentWalletAddress,
              firestoreWalletAddress: walletProfile?.walletAddress || ''
            })

            await loadPolygonBalance(currentWalletAddress)
            await loadVWalaBalance(currentWalletAddress)
          }

          await refreshUserCreatedTokens(user.uid)
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
      walletState.userTokens = []
      localStorage.removeItem('vwala_wallet_profile')
      updatePolygonBalanceUI('0')
      updateVWalaBalanceUI('0')
      updateUserTokensListUI()
      openAuthGate()
    })
  } catch (error) {
    console.error('Erro ao iniciar autenticação Firebase:', error)
    openAuthGate()
  }
}

googleLoginBtn?.addEventListener('click', loginWithGoogle)



document.querySelectorAll('.wallet-action').forEach((button) => {
  const action = button.getAttribute('data-action')

  button.addEventListener('click', async () => {
    if (!currentGoogleUser) {
      openAuthGate()
      return
    }

    await handleWalletAction(action)
  })
})

document.getElementById('walletUserTokensContainer')?.addEventListener('click', async (event) => {
  const card = event.target.closest('[data-token-address]')

  if (!card) {
    return
  }

  const tokenAddress = String(card.getAttribute('data-token-address') || '').toLowerCase()

  const token = walletState.userTokens.find((item) =>
    String(item.tokenAddress || '').toLowerCase() === tokenAddress
  )

  if (!token) {
    return
  }

  await openCreatedTokenActions(token)
})

document.getElementById('walletUserTokensContainer')?.addEventListener('keydown', async (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') {
    return
  }

  const card = event.target.closest('[data-token-address]')

  if (!card) {
    return
  }

  event.preventDefault()

  const tokenAddress = String(card.getAttribute('data-token-address') || '').toLowerCase()

  const token = walletState.userTokens.find((item) =>
    String(item.tokenAddress || '').toLowerCase() === tokenAddress
  )

  if (!token) {
    return
  }

  await openCreatedTokenActions(token)
})

initFirebaseAuthGate()