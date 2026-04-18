import { auth, db, googleProvider } from './firebase'
import {
  browserLocalPersistence,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signInWithRedirect
} from 'firebase/auth'
import { collection, doc, getDoc, getDocs, setDoc, serverTimestamp } from 'firebase/firestore'
import { JsonRpcProvider, Wallet, formatEther, isAddress, parseEther } from 'ethers'
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

const modalState = {
  resolve: null,
  mode: 'message',
  addressText: ''
}

const POLYGON_RPC_URL = new URL('/api/rpc', window.location.origin).toString()
const POLYGON_CHAIN_ID = Number(import.meta.env.VITE_POLYGON_CHAIN_ID || 137)
const DEVICE_WALLET_STORAGE_KEY = 'vwala_device_wallet'
const CREATED_TOKENS_STORAGE_KEY = 'vwala_created_tokens'
const CLOUD_PASSWORD_SALT = 'vwala_google_device_pin_v1'

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

async function loadPolygonBalance(walletAddress) {
  try {
    if (!walletAddress) return

    const provider = new JsonRpcProvider(POLYGON_RPC_URL)
    const balanceWei = await provider.getBalance(walletAddress)
    const balanceFormatted = formatEther(balanceWei)

    updatePolygonBalanceUI(balanceFormatted)
  } catch (error) {
    console.error('Erro ao carregar saldo POL:', error)
    updatePolygonBalanceUI('0')
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

    const provider = new JsonRpcProvider(POLYGON_RPC_URL)
    const unlockedWallet = await Wallet.fromEncryptedJson(
      deviceVault.walletKeystoreLocal,
      pin.trim()
    )
    const signer = unlockedWallet.connect(provider)

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
    await showMessageModal(
      'Swap',
      'O swap interno 1 POL = 1 vWALA será ligado ao sistema.'
    )
  }
}

function buildLiquidityPageUrl(tokenAddress = '') {
  const url = new URL('/liquidez.html', window.location.origin)
  url.searchParams.set('token', tokenAddress)
  return url.toString()
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
    text: `
      <strong>Símbolo:</strong><br>${escapeHtml(token.symbol || 'TOKEN')}
      <br><br><strong>Mint do token:</strong>
      <br><br>Use este endereço para o contrato de swap e para a futura tela de liquidez.
    `,
    mode: 'token_actions',
    confirmText: 'Copiar mint',
    cancelText: 'Adicionar liquidez',
    showCancel: true,
    addressText: token.tokenAddress
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

      <div class="wallet-auth-badge wallet-modal-token-badge">
        <img src="/Polygon-MATIC.webp" alt="Polygon" />
      </div>
      <h2 id="uiModalTitle">Aviso</h2>
      <p id="uiModalText"></p>

      <div id="uiModalAddressBox" class="wallet-modal-address-box hidden"></div>

      <img
        id="uiModalQr"
        class="wallet-modal-qr hidden"
        alt="QR Code da carteira"
      />

      <input
        id="uiModalInput"
        class="wallet-modal-input hidden"
        type="password"
        placeholder=""
        autocomplete="off"
      />

      <div class="wallet-modal-actions">
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
  qrDataUrl = ''
} = {}) {
  return new Promise((resolve) => {
    modalState.resolve = resolve
    modalState.mode = mode
    modalState.addressText = addressText || ''

uiModalTitle.textContent = title
uiModalText.innerHTML = text
uiModalConfirmBtn.textContent = confirmText
    uiModalCancelBtn.textContent = cancelText
    uiModalCancelBtn.style.display = showCancel ? 'flex' : 'none'
uiModalCloseBtn.classList.toggle('hidden', !['address', 'token_actions'].includes(mode))

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
    text: '<strong>Envie apenas Polygon para este endereço.</strong>',
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

    currentWalletAddress = userData.walletAddress || ''
    updateWalletAddressUI(currentWalletAddress)

    localStorage.setItem(
      'vwala_wallet_profile',
      JSON.stringify({
        uid: user.uid,
        walletAddress: currentWalletAddress,
        chainId: userData.chainId || POLYGON_CHAIN_ID,
        network: userData.network || 'polygon'
      })
    )

    await ensureDeviceWalletAccess(user, userData)

    return userData
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

          if (walletProfile?.walletAddress) {
            await loadPolygonBalance(walletProfile.walletAddress)
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