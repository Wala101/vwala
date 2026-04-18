import { db } from './firebase'
import { doc, setDoc, serverTimestamp } from 'firebase/firestore'
import { Contract, JsonRpcProvider, Wallet } from 'ethers'

const app = document.querySelector('#app')

const POLYGON_RPC_URL = new URL('/api/rpc', window.location.origin).toString()
const TOKEN_FACTORY_ADDRESS = '0xf47F70A3CdA8cA0e474571D64562d6F508aE3005'
const DEVICE_WALLET_STORAGE_KEY = 'vwala_device_wallet'
const CREATED_TOKENS_STORAGE_KEY = 'vwala_created_tokens'

const TOKEN_FACTORY_ABI = [
  'event TokenCreated(address indexed creator, address indexed owner, address indexed token, string name, string symbol, uint256 wholeSupply, string metadataURI)',
  'function createToken(string name_, string symbol_, uint256 wholeSupply_, address owner_, string metadataURI_) external returns (address token)',
  'function getTokensByCreator(address creator_) external view returns (address[] memory)'
]

if (!app) {
  throw new Error('Elemento #app não encontrado.')
}

const DEFAULT_TOKEN_SUPPLY = '70000000'
const TOKEN_DRAFT_STORAGE_KEY = 'vwala_token_draft'
const CREATED_ON_LABEL = 'WALA'
const METADATA_STORAGE_PROVIDER = 'irys'

const tokenState = {
  modalResolve: null,
  modalMode: 'message',
  currentWallet: readWalletProfile(),
  currentUser: readUserProfile(),
  selectedImageDataUrl: '',
  selectedImageName: ''
}



function readWalletProfile() {
  try {
    const raw = localStorage.getItem('vwala_wallet_profile')
    return raw ? JSON.parse(raw) : null
  } catch (error) {
    console.error('Erro ao ler perfil da carteira:', error)
    return null
  }
}

function readUserProfile() {
  try {
    const raw = localStorage.getItem('vwala_user')
    return raw ? JSON.parse(raw) : null
  } catch (error) {
    console.error('Erro ao ler usuário local:', error)
    return null
  }
}

function getCurrentUserUid() {
  return String(tokenState.currentUser?.uid || '').trim()
}

async function saveCreatedTokenInFirestore(payload) {
  const uid = getCurrentUserUid()
  const tokenAddress = String(payload?.tokenAddress || '').trim()

  if (!uid || !tokenAddress) {
    return false
  }

  const tokenId = tokenAddress.toLowerCase()
  const tokenRef = doc(db, 'users', uid, 'createdTokens', tokenId)

  await setDoc(
  tokenRef,
  {
    uid,
    tokenId,
    tokenAddress,
    tokenAddressLower: tokenId,
    ownerAddress: payload.ownerAddress || '',
    name: payload.name || '',
    symbol: payload.symbol || '',
    supply: payload.supply || '',
    website: payload.website || '',
    x: payload.x || '',
    telegram: payload.telegram || '',
    description: payload.description || '',
    imageName: payload.imageName || '',
    imageDataUrl: payload.imageDataUrl || '',
    metadataURI: payload.metadataURI || '',
    txHash: payload.txHash || '',
    chainId: payload.chainId || 137,
    status: payload.status || 'active',
    factoryAddress: payload.factoryAddress || TOKEN_FACTORY_ADDRESS,
    createdOn: payload.createdOn || CREATED_ON_LABEL,
    createdOnUrl: payload.createdOnUrl || window.location.origin,
    metadataStorage: payload.metadataStorage || METADATA_STORAGE_PROVIDER,
    isFromWala: true,
    source: 'wala_token_factory',
    createdAtClient: payload.createdAt || new Date().toISOString(),
    updatedAt: serverTimestamp(),
    createdAt: serverTimestamp()
  },
  { merge: true }
)

  return true
}



function getLocalDeviceWallet() {
  try {
    const raw = localStorage.getItem(DEVICE_WALLET_STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch (error) {
    console.error('Erro ao ler carteira local do aparelho:', error)
    return null
  }
}

function getMatchingLocalDeviceWallet(walletAddress = '') {
  const localVault = getLocalDeviceWallet()

  if (!localVault?.walletKeystoreLocal) return null

  const localAddress = String(localVault.walletAddress || '').toLowerCase()
  const targetAddress = String(walletAddress || '').toLowerCase()

  if (!localAddress || !targetAddress || localAddress !== targetAddress) {
    return null
  }

  return localVault
}

function buildMetadataUri(values) {
  const url = new URL('/token.html', window.location.origin)

  url.searchParams.set('symbol', values.symbol)
  url.searchParams.set('name', values.name)
  url.searchParams.set('createdOn', values.createdOn)

  if (values.website) {
    url.searchParams.set('website', values.website)
  }

  if (values.x) {
    url.searchParams.set('x', values.x)
  }

  if (values.telegram) {
    url.searchParams.set('telegram', values.telegram)
  }

  return url.toString()
}

function saveCreatedTokenLocally(payload) {
  try {
    const raw = localStorage.getItem(CREATED_TOKENS_STORAGE_KEY)
    const current = raw ? JSON.parse(raw) : []
    const next = [payload, ...current].slice(0, 50)

    localStorage.setItem(
      CREATED_TOKENS_STORAGE_KEY,
      JSON.stringify(next)
    )
  } catch (error) {
    console.error('Erro ao salvar token criado localmente:', error)
  }
}

function getCreateTokenErrorMessage(error) {
  const rawMessage = String(error?.shortMessage || error?.message || '').toLowerCase()

  if (
    rawMessage.includes('invalid password') ||
    rawMessage.includes('wrong password') ||
    rawMessage.includes('incorrect password')
  ) {
    return 'PIN incorreto. Tente novamente.'
  }

  if (rawMessage.includes('insufficient funds')) {
    return 'Saldo insuficiente para pagar o gás da criação.'
  }

  if (
    rawMessage.includes('network error') ||
    rawMessage.includes('failed to fetch') ||
    rawMessage.includes('timeout')
  ) {
    return 'Falha de rede ao criar o token. Tente novamente.'
  }

  return 'Não foi possível concluir a criação do token agora.'
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function formatWalletAddress(address = '') {
  if (!address) return 'Carteira não encontrada'
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function normalizeSymbol(value = '') {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 10)
}

function normalizeSupply(value = '') {
  return String(value || '')
    .replace(/[^\d]/g, '')
    .replace(/^0+(?=\d)/, '')
}

function normalizeWebsite(value = '') {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (/^https:\/\//i.test(raw)) return raw
  return raw
}

function normalizeX(value = '') {
  let raw = String(value || '').trim()
  if (!raw) return ''

  raw = raw.replace(/^@/, '')

  if (/^https?:\/\//i.test(raw)) {
    return raw.replace(/^http:\/\//i, 'https://')
  }

  raw = raw.replace(/^x\.com\//i, '')
  raw = raw.replace(/^twitter\.com\//i, '')

  return `https://x.com/${raw}`
}

function normalizeTelegram(value = '') {
  let raw = String(value || '').trim()
  if (!raw) return ''

  raw = raw.replace(/^@/, '')

  if (/^https?:\/\//i.test(raw)) {
    return raw.replace(/^http:\/\//i, 'https://')
  }

  raw = raw.replace(/^t\.me\//i, '')

  return `https://t.me/${raw}`
}

function formatWholeNumber(value = '') {
  const raw = String(value || '0').replace(/[^\d]/g, '')
  if (!raw) return '0'
  return raw.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => {
      resolve(String(reader.result || ''))
    }

    reader.onerror = () => {
      reject(new Error('Não foi possível ler a imagem.'))
    }

    reader.readAsDataURL(file)
  })
}

function getFormValues() {
  const owner = tokenState.currentWallet?.walletAddress || ''
  const name = document.getElementById('tokenName')?.value?.trim() || ''
  const symbol = normalizeSymbol(document.getElementById('tokenSymbol')?.value || '')
  const supply = normalizeSupply(document.getElementById('tokenSupply')?.value || '')
  const website = normalizeWebsite(document.getElementById('tokenWebsite')?.value || '')
  const x = normalizeX(document.getElementById('tokenX')?.value || '')
  const telegram = normalizeTelegram(document.getElementById('tokenTelegram')?.value || '')
  const description = document.getElementById('tokenDescription')?.value?.trim() || ''

  return {
    name,
    symbol,
    supply,
    decimals: 18,
    owner,
    website,
    x,
    telegram,
    description,
    imageDataUrl: tokenState.selectedImageDataUrl,
    imageName: tokenState.selectedImageName,
    createdOn: CREATED_ON_LABEL,
    createdOnUrl: window.location.origin,
    metadataStorage: METADATA_STORAGE_PROVIDER,
    paymentSource: 'carteira-interna-do-site'
  }
}

function getValidationError(values) {
  if (!values.owner) {
    return 'Carteira interna não encontrada. Entre na carteira antes de criar o token.'
  }

  if (!values.imageDataUrl) {
    return 'Selecione a imagem do token.'
  }

  if (values.name.length < 3 || values.name.length > 32) {
    return 'O nome do token deve ter entre 3 e 32 caracteres.'
  }

  if (values.symbol.length < 2 || values.symbol.length > 10) {
    return 'O símbolo do token deve ter entre 2 e 10 caracteres.'
  }

  if (!/^[A-Z0-9]+$/.test(values.symbol)) {
    return 'O símbolo do token deve usar apenas letras e números.'
  }

  if (!values.supply) {
    return 'Informe o supply total do token.'
  }

  if (!/^\d+$/.test(values.supply)) {
    return 'O supply total deve ser inteiro.'
  }

  try {
    if (BigInt(values.supply) <= 0n) {
      return 'O supply total deve ser maior que zero.'
    }

    if (BigInt(values.supply) > 1000000000000000000n) {
      return 'Use um supply menor. Esse valor ficou exageradamente alto.'
    }
  } catch (error) {
    return 'O supply informado é inválido.'
  }

  if (values.website && !/^https:\/\//i.test(values.website)) {
    return 'Quando informar site, use https:// no começo.'
  }

  if (values.x && !/^https:\/\//i.test(values.x)) {
    return 'O campo X precisa virar um link https:// válido.'
  }

  if (values.telegram && !/^https:\/\//i.test(values.telegram)) {
    return 'O campo Telegram precisa virar um link https:// válido.'
  }

  if (values.description.length > 280) {
    return 'A descrição curta deve ter no máximo 280 caracteres.'
  }

  return ''
}

function setFormError(message = '') {
  const box = document.getElementById('tokenFormError')
  if (!box) return

  box.textContent = message
  box.classList.toggle('hidden', !message)
}

function renderImageBoxes() {
  const uploadPreview = document.getElementById('tokenImagePreview')
  const previewCircle = document.getElementById('previewTokenImage')

  const imageHtml = tokenState.selectedImageDataUrl
    ? `<img src="${tokenState.selectedImageDataUrl}" alt="Imagem do token" />`
    : `<div class="token-image-placeholder">Sem imagem</div>`

  if (uploadPreview) {
    uploadPreview.innerHTML = imageHtml
  }

  if (previewCircle) {
    previewCircle.innerHTML = imageHtml
  }

  const fileNameEl = document.getElementById('tokenImageFileName')
  if (fileNameEl) {
    fileNameEl.textContent = tokenState.selectedImageName || 'Nenhum arquivo selecionado.'
  }
}

function renderPreview() {
  const values = getFormValues()

  const previewName = document.getElementById('previewName')
  const previewSymbol = document.getElementById('previewSymbol')
  const previewSupply = document.getElementById('previewSupply')
  const previewOwner = document.getElementById('previewOwner')
  const previewWebsite = document.getElementById('previewWebsite')
  const previewX = document.getElementById('previewX')
  const previewTelegram = document.getElementById('previewTelegram')
  const previewCreatedOn = document.getElementById('previewCreatedOn')

  if (previewName) previewName.textContent = values.name || 'Nome do token'
  if (previewSymbol) previewSymbol.textContent = values.symbol || 'SYMBOL'
  if (previewSupply) previewSupply.textContent = formatWholeNumber(values.supply || '0')
  if (previewOwner) previewOwner.textContent = values.owner ? formatWalletAddress(values.owner) : 'Sem carteira'
  if (previewWebsite) previewWebsite.textContent = values.website || 'Não informado'
  if (previewX) previewX.textContent = values.x || 'Não informado'
  if (previewTelegram) previewTelegram.textContent = values.telegram || 'Não informado'
  if (previewCreatedOn) previewCreatedOn.textContent = `${values.createdOn} • metadata ${values.metadataStorage}`

  renderImageBoxes()
}

function openModal({
  title = 'Aviso',
  text = '',
  mode = 'message',
  confirmText = 'OK',
  cancelText = 'Cancelar',
  placeholder = '',
  showCancel = false,
  closeVisible = false
} = {}) {
  const modal = document.getElementById('tokenModal')
  const titleEl = document.getElementById('tokenModalTitle')
  const textEl = document.getElementById('tokenModalText')
  const inputEl = document.getElementById('tokenModalInput')
  const cancelBtn = document.getElementById('tokenModalCancelBtn')
  const confirmBtn = document.getElementById('tokenModalConfirmBtn')
  const closeBtn = document.getElementById('tokenModalCloseBtn')

  return new Promise((resolve) => {
    tokenState.modalResolve = resolve
    tokenState.modalMode = mode

    titleEl.textContent = title
    textEl.innerHTML = text
    confirmBtn.textContent = confirmText
    cancelBtn.textContent = cancelText
    cancelBtn.style.display = showCancel ? 'block' : 'none'
    closeBtn.classList.toggle('hidden', !closeVisible)

    if (mode === 'prompt') {
      inputEl.classList.remove('hidden')
      inputEl.value = ''
      inputEl.placeholder = placeholder
      setTimeout(() => inputEl.focus(), 0)
    } else {
      inputEl.classList.add('hidden')
      inputEl.value = ''
      inputEl.placeholder = ''
    }

    modal.classList.remove('hidden')
  })
}

function closeModal(result = null) {
  const modal = document.getElementById('tokenModal')
  modal?.classList.add('hidden')

  const resolve = tokenState.modalResolve
  tokenState.modalResolve = null
  tokenState.modalMode = 'message'

  if (resolve) {
    resolve(result)
  }
}

async function showMessageModal(title, text, confirmText = 'OK') {
  await openModal({
    title,
    text,
    confirmText,
    showCancel: false,
    closeVisible: false
  })
}

async function showPromptModal(
  title,
  text,
  confirmText = 'Continuar',
  cancelText = 'Cancelar',
  placeholder = ''
) {
  return openModal({
    title,
    text,
    mode: 'prompt',
    confirmText,
    cancelText,
    placeholder,
    showCancel: true,
    closeVisible: false
  })
}

async function showPinModal(title, text, confirmText = 'Confirmar') {
  return showPromptModal(
    title,
    text,
    confirmText,
    'Cancelar',
    'Digite seu PIN'
  )
}

async function showConfirmModal(
  title,
  text,
  confirmText = 'Confirmar',
  cancelText = 'Cancelar'
) {
  return openModal({
    title,
    text,
    confirmText,
    cancelText,
    showCancel: true,
    closeVisible: false
  })
}

function showLoadingModal(
  title = 'Processando',
  text = 'Aguarde enquanto concluímos sua solicitação.'
) {
  const gate = document.getElementById('tokenLoadingGate')
  const titleEl = document.getElementById('tokenLoadingTitle')
  const textEl = document.getElementById('tokenLoadingText')

  if (titleEl) titleEl.textContent = title
  if (textEl) textEl.textContent = text

  gate?.classList.remove('hidden')
  document.body.style.overflow = 'hidden'
}

function hideLoadingModal() {
  const gate = document.getElementById('tokenLoadingGate')
  gate?.classList.add('hidden')
  document.body.style.overflow = ''
}

function buildMetadataDraft(values) {
  return {
    standard: 'ERC20',
    chain: 'polygon',
    contractProfile: 'fixed-supply-no-extra-mint',
    createdAt: new Date().toISOString(),
    paymentSource: values.paymentSource,
    ownerAddress: values.owner,
    initialSupply: values.supply,
    decimals: values.decimals,
    metadataStorage: values.metadataStorage,
    createdOn: values.createdOn,
    createdOnUrl: values.createdOnUrl,
    metadata: {
      name: values.name,
      symbol: values.symbol,
      description:
        values.description ||
        `${values.name} (${values.symbol}) criado no ${values.createdOn}.`,
      image: values.imageDataUrl,
      imageFileName: values.imageName || 'token-image',
      external_url: values.website || values.createdOnUrl,
      extensions: {
        website: values.website || '',
        x: values.x || '',
        telegram: values.telegram || '',
        createdOn: values.createdOn,
        createdOnUrl: values.createdOnUrl,
        displaySource: 'WALA Token Factory',
        paymentWallet: values.owner
      }
    }
  }
}

function buildSummaryHtml(values) {
  return `
    <strong>Confira os dados do token.</strong>
    <br><br><strong>Nome:</strong><br>${escapeHtml(values.name)}
    <br><br><strong>Símbolo:</strong><br>${escapeHtml(values.symbol)}
    <br><br><strong>Supply total:</strong><br>${escapeHtml(formatWholeNumber(values.supply))}
    <br><br><strong>Decimals:</strong><br>18
    <br><br><strong>Wallet pagadora e inicial:</strong><br>${escapeHtml(values.owner)}
    <br><br><strong>Website:</strong><br>${escapeHtml(values.website || 'Não informado')}
    <br><br><strong>X:</strong><br>${escapeHtml(values.x || 'Não informado')}
    <br><br><strong>Telegram:</strong><br>${escapeHtml(values.telegram || 'Não informado')}
    <br><br><strong>Metadata:</strong><br>Imagem + site + X + Telegram + selo “Feito no ${escapeHtml(values.createdOn)}”
    <br><br><strong>Storage preparado para:</strong><br>${escapeHtml(values.metadataStorage)}
    <br><br><strong>Contrato alvo:</strong><br>ERC-20 fixed supply, sem mint extra depois do deploy.
  `
}

async function handleImageSelected(event) {
  const file = event.target.files?.[0]

  if (!file) {
    return
  }

  if (!file.type.startsWith('image/')) {
    await showMessageModal(
      'Imagem inválida',
      'Escolha um arquivo de imagem válido.'
    )
    event.target.value = ''
    return
  }

  if (file.size > 4 * 1024 * 1024) {
    await showMessageModal(
      'Imagem muito grande',
      'Use uma imagem de até 4MB.'
    )
    event.target.value = ''
    return
  }

  try {
    const dataUrl = await readFileAsDataURL(file)
    tokenState.selectedImageDataUrl = dataUrl
    tokenState.selectedImageName = file.name
    setFormError('')
    renderPreview()
  } catch (error) {
    console.error('Erro ao ler imagem do token:', error)

    await showMessageModal(
      'Erro na imagem',
      'Não foi possível carregar a imagem escolhida.'
    )
  } finally {
    event.target.value = ''
  }
}

function clearSelectedImage() {
  tokenState.selectedImageDataUrl = ''
  tokenState.selectedImageName = ''
  renderPreview()
}

async function handleValidateForm() {
  const values = getFormValues()
  const error = getValidationError(values)

  if (error) {
    setFormError(error)
    await showMessageModal('Dados inválidos', error)
    return
  }

  setFormError('')

  await showMessageModal(
    'Padrão validado',
    buildSummaryHtml(values)
  )
}

async function handleCreateToken() {
  const values = getFormValues()
  const error = getValidationError(values)

  if (error) {
    setFormError(error)
    await showMessageModal('Dados inválidos', error)
    return
  }

  setFormError('')

  const metadataURI = buildMetadataUri(values)

  const confirmed = await showConfirmModal(
    'Confirmar criação',
    `
      ${buildSummaryHtml(values)}
      <br><br><strong>Factory:</strong><br>${escapeHtml(TOKEN_FACTORY_ADDRESS)}
      <br><br><strong>Metadata URI inicial:</strong><br>${escapeHtml(metadataURI)}
    `,
    'Criar token',
    'Cancelar'
  )

  if (!confirmed) {
    return
  }

  const pin = await showPinModal(
    'Confirmar PIN',
    'Digite seu PIN para autorizar a criação do token.',
    'Criar token'
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
    const deviceVault = getMatchingLocalDeviceWallet(values.owner)

    if (!deviceVault?.walletKeystoreLocal) {
      await showMessageModal(
        'Carteira não pronta',
        'Abra a página da carteira nesta mesma sessão para garantir que o PIN deste aparelho esteja configurado.'
      )
      return
    }

    showLoadingModal(
      'Criando token',
      'Aguarde enquanto sua carteira assina a transação da factory.'
    )

    const provider = new JsonRpcProvider(POLYGON_RPC_URL)
    const unlockedWallet = await Wallet.fromEncryptedJson(
      deviceVault.walletKeystoreLocal,
      pin.trim()
    )
    const signer = unlockedWallet.connect(provider)

    if (signer.address.toLowerCase() !== values.owner.toLowerCase()) {
      throw new Error('A carteira desbloqueada não corresponde à carteira do usuário.')
    }

    const tokenFactory = new Contract(
      TOKEN_FACTORY_ADDRESS,
      TOKEN_FACTORY_ABI,
      signer
    )

    const tx = await tokenFactory.createToken(
      values.name,
      values.symbol,
      BigInt(values.supply),
      values.owner,
      metadataURI
    )

    showLoadingModal(
      'Confirmando na rede',
      'Aguarde a confirmação da criação do token na Polygon.'
    )

    const receipt = await tx.wait()

    let createdTokenAddress = ''

    for (const log of receipt.logs) {
      try {
        const parsedLog = tokenFactory.interface.parseLog(log)

        if (parsedLog?.name === 'TokenCreated') {
          createdTokenAddress = parsedLog.args.token
          break
        }
      } catch (error) {
        // ignora logs que não pertencem à factory
      }
    }

    const draft = buildMetadataDraft(values)

    const createdTokenPayload = {
  tokenAddress: createdTokenAddress,
  ownerAddress: values.owner,
  name: values.name,
  symbol: values.symbol,
  supply: values.supply,
  website: values.website,
  x: values.x,
  telegram: values.telegram,
  description: values.description,
  imageName: values.imageName,
  imageDataUrl: values.imageDataUrl,
  metadataURI,
  txHash: tx.hash,
  chainId: 137,
  createdAt: new Date().toISOString(),
  draft,
  status: 'active',
  factoryAddress: TOKEN_FACTORY_ADDRESS,
  createdOn: values.createdOn,
  createdOnUrl: values.createdOnUrl,
  metadataStorage: values.metadataStorage
}

    let savedInCloud = false

    try {
      savedInCloud = await saveCreatedTokenInFirestore(createdTokenPayload)
    } catch (saveError) {
      console.error('Erro ao salvar token no Firestore:', saveError)
    }

    saveCreatedTokenLocally(createdTokenPayload)

    localStorage.setItem(TOKEN_DRAFT_STORAGE_KEY, JSON.stringify(draft))

    hideLoadingModal()

    await showMessageModal(
      'Token criado com sucesso',
      `
        <strong>Seu token foi criado na Polygon com sucesso.</strong>
        <br><br><strong>Contrato:</strong><br>${escapeHtml(createdTokenAddress || 'Não encontrado no evento')}
        <br><br><strong>Hash:</strong><br>${escapeHtml(tx.hash)}
        <br><br><strong>Supply:</strong><br>${escapeHtml(formatWholeNumber(values.supply))}
        <br><br><strong>Dono inicial:</strong><br>${escapeHtml(values.owner)}
        <br><br><strong>Registro na conta:</strong><br>${savedInCloud ? 'Salvo no Firestore com sucesso.' : 'Token criado, mas o registro em nuvem falhou.'}
      `
    )
  } catch (error) {
    hideLoadingModal()
    console.error('Erro ao criar token:', error)

    await showMessageModal(
      'Erro ao criar token',
      getCreateTokenErrorMessage(error)
    )
  }
}

function renderPage() {
  const ownerAddress = tokenState.currentWallet?.walletAddress || ''
  const ownerAddressText = ownerAddress || 'Entre primeiro na carteira para usar esta página.'
  const userName =
    tokenState.currentUser?.name ||
    tokenState.currentUser?.email ||
    'Usuário'

  app.innerHTML = `
    <div class="token-page">
      <div class="token-shell">
        <header class="token-topbar">
          <div class="token-brand">
            <div class="token-brand-badge">T</div>
            <div class="token-brand-text">
              <strong>vWALA</strong>
              <span>Criar token</span>
            </div>
          </div>

          <div class="token-chip">ERC-20 Fixed</div>
        </header>



        <section class="token-content-card">
          <div class="token-layout">
            <section>
            <div class="token-card">
              <div class="token-label-top">Dados do token</div>

              <div class="token-grid">
                <div class="token-field">
                  <label>Imagem do token</label>

                  <div class="token-image-upload-box">
                    <div id="tokenImagePreview" class="token-image-preview">
                      <div class="token-image-placeholder">Sem imagem</div>
                    </div>

                    <div class="token-image-upload-content">
                      <div class="token-image-upload-title">Logo do token</div>
                      <div class="token-image-upload-subtitle">
                        Esta imagem entra no metadata do token para depois subir no Irys e ser usada no ecossistema WALA.
                      </div>

                      <div id="tokenImageFileName" class="token-image-upload-subtitle">
                        Nenhum arquivo selecionado.
                      </div>

                      <div class="token-image-upload-actions">
                        <button id="pickTokenImageBtn" class="token-btn-secondary" type="button">Escolher imagem</button>
                        <button id="clearTokenImageBtn" class="token-btn-secondary" type="button">Remover</button>
                      </div>

                      <input
                        id="tokenImageInput"
                        class="token-image-input-hidden"
                        type="file"
                        accept="image/*"
                      />
                    </div>
                  </div>
                </div>

                <div class="token-field">
                  <label for="tokenName">Nome do token</label>
                  <input id="tokenName" class="token-input" type="text" placeholder="Ex: Wala Reserve" maxlength="32" />
                  <span class="token-help">Use um nome claro e profissional.</span>
                </div>

                <div class="token-inline-grid">
                  <div class="token-field">
                    <label for="tokenSymbol">Símbolo</label>
                    <input id="tokenSymbol" class="token-input" type="text" placeholder="WALA" maxlength="10" />
                    <span class="token-help">Só letras e números.</span>
                  </div>

                  <div class="token-field">
                    <label>Decimals</label>
                    <div class="token-locked-chip">18 fixo</div>
                    <span class="token-help">Padrão aceito em ERC-20.</span>
                  </div>
                </div>

                <div class="token-field">
                  <label for="tokenSupply">Supply total</label>
                  <input id="tokenSupply" class="token-input" type="text" inputmode="numeric" value="${DEFAULT_TOKEN_SUPPLY}" placeholder="Ex: 70000000" />
                  <span class="token-help">Agora já começa em 70 milhões, mas continua dinâmico para qualquer usuário.</span>
                </div>

                <div class="token-field">
                  <label>Carteira inicial e pagadora</label>
                  <div class="token-readonly" id="tokenOwnerAddress">${escapeHtml(ownerAddressText)}</div>
                  <span class="token-help">O deploy deve ser pago pela carteira interna do site ligada a este usuário.</span>
                </div>

                <div class="token-field">
                  <label for="tokenWebsite">Website oficial</label>
                  <input id="tokenWebsite" class="token-input" type="text" placeholder="https://seusite.com" />
                  <span class="token-help">Opcional, mas recomendado.</span>
                </div>

                <div class="token-social-grid">
                  <div class="token-field">
                    <label for="tokenX">X</label>
                    <input id="tokenX" class="token-input" type="text" placeholder="@seuprojeto ou https://x.com/seuprojeto" />
                    <span class="token-help">Pode digitar @usuario ou o link completo.</span>
                  </div>

                  <div class="token-field">
                    <label for="tokenTelegram">Telegram</label>
                    <input id="tokenTelegram" class="token-input" type="text" placeholder="@seucanal ou https://t.me/seucanal" />
                    <span class="token-help">Pode digitar @canal ou o link completo.</span>
                  </div>
                </div>

                <div class="token-field">
                  <label for="tokenDescription">Descrição curta</label>
                  <textarea id="tokenDescription" class="token-textarea" maxlength="280" placeholder="Descreva o objetivo do token de forma séria e objetiva."></textarea>
                </div>
              </div>

              <div id="tokenFormError" class="token-form-error hidden"></div>

              <div class="token-actions" style="margin-top:18px;">
                <button id="validateTokenBtn" class="token-btn-secondary" type="button">Validar padrão</button>
                <button id="createTokenBtn" class="token-btn" type="button">Criar token</button>
              </div>
            </div>

            <div class="token-security-card">
              <div class="token-label-top">Regras do padrão</div>
              <div class="token-security-list">
                <div class="token-security-item">
                  <div class="token-security-icon">✓</div>
                  <div>
                    <strong>Fixed supply</strong>
                    <span>O supply nasce no deploy e não deve existir função pública para criar mais tokens depois.</span>
                  </div>
                </div>

                <div class="token-security-item">
                  <div class="token-security-icon">✓</div>
                  <div>
                    <strong>Sem mint administrativo</strong>
                    <span>Nada de owner criando supply novo depois.</span>
                  </div>
                </div>

                <div class="token-security-item">
                  <div class="token-security-icon">✓</div>
                  <div>
                    <strong>Metadata do WALA</strong>
                    <span>Imagem, site, X, Telegram e selo “Feito no WALA” ficam preparados no metadata.</span>
                  </div>
                </div>

                <div class="token-security-item">
                  <div class="token-security-icon">✓</div>
                  <div>
                    <strong>Pagamento interno</strong>
                    <span>O deploy deve sair da carteira interna do usuário dentro do site.</span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <aside class="token-sticky">
            <div class="token-preview-card">
              <div class="token-label-top">Prévia</div>

              <div class="token-preview-image-card">
                <div id="previewTokenImage" class="token-preview-image-circle">
                  <div class="token-image-placeholder">Sem imagem</div>
                </div>

                <div class="token-preview-image-text">
                  <strong>Visual do token</strong>
                  <span>Esta prévia acompanha o metadata que vamos subir depois.</span>
                </div>
              </div>

              <div class="token-preview-grid">
                <div class="token-preview-row">
                  <div>
                    <span class="token-preview-label">Criador</span>
                  </div>
                  <div class="token-preview-value">${escapeHtml(userName)}</div>
                </div>

                <div class="token-preview-row">
                  <div>
                    <span class="token-preview-label">Nome</span>
                  </div>
                  <div class="token-preview-value" id="previewName">Nome do token</div>
                </div>

                <div class="token-preview-row">
                  <div>
                    <span class="token-preview-label">Símbolo</span>
                  </div>
                  <div class="token-preview-value" id="previewSymbol">SYMBOL</div>
                </div>

                <div class="token-preview-row">
                  <div>
                    <span class="token-preview-label">Supply</span>
                  </div>
                  <div class="token-preview-value" id="previewSupply">70.000.000</div>
                </div>

                <div class="token-preview-row">
                  <div>
                    <span class="token-preview-label">Wallet inicial</span>
                  </div>
                  <div class="token-preview-value" id="previewOwner">${escapeHtml(ownerAddress ? formatWalletAddress(ownerAddress) : 'Sem carteira')}</div>
                </div>

                <div class="token-preview-row">
                  <div>
                    <span class="token-preview-label">Website</span>
                  </div>
                  <div class="token-preview-value break" id="previewWebsite">Não informado</div>
                </div>

                <div class="token-preview-row">
                  <div>
                    <span class="token-preview-label">X</span>
                  </div>
                  <div class="token-preview-value break" id="previewX">Não informado</div>
                </div>

                <div class="token-preview-row">
                  <div>
                    <span class="token-preview-label">Telegram</span>
                  </div>
                  <div class="token-preview-value break" id="previewTelegram">Não informado</div>
                </div>

                <div class="token-preview-row">
                  <div>
                    <span class="token-preview-label">Origem</span>
                  </div>
                  <div class="token-preview-value break" id="previewCreatedOn">${CREATED_ON_LABEL} • metadata ${METADATA_STORAGE_PROVIDER}</div>
                </div>
              </div>
            </div>


          </aside>
          </div>
        </section>
      </div>
    </div>

    <div id="tokenModal" class="token-auth-gate hidden">
      <div class="token-auth-modal token-ui-modal-box">
        <button id="tokenModalCloseBtn" class="token-modal-close-btn hidden" type="button" aria-label="Fechar modal">×</button>
        <div class="token-auth-badge">T</div>
        <h2 id="tokenModalTitle">Aviso</h2>
        <p id="tokenModalText"></p>
        <input id="tokenModalInput" class="token-modal-input hidden" type="text" placeholder="" autocomplete="off" />
        <div class="token-modal-actions">
          <button id="tokenModalCancelBtn" class="token-modal-secondary-btn" type="button">Cancelar</button>
          <button id="tokenModalConfirmBtn" class="token-btn" type="button">OK</button>
        </div>
      </div>
    </div>

    <div id="tokenLoadingGate" class="token-auth-gate hidden">
      <div class="token-auth-modal token-loading-modal">
        <div class="token-loading-spinner" aria-hidden="true"></div>
        <h2 id="tokenLoadingTitle">Processando</h2>
        <p id="tokenLoadingText">Aguarde enquanto concluímos sua solicitação.</p>
      </div>
    </div>
  `

  bindEvents()
  renderPreview()
}

function bindEvents() {
  const nameInput = document.getElementById('tokenName')
  const symbolInput = document.getElementById('tokenSymbol')
  const supplyInput = document.getElementById('tokenSupply')
  const websiteInput = document.getElementById('tokenWebsite')
  const xInput = document.getElementById('tokenX')
  const telegramInput = document.getElementById('tokenTelegram')
  const descriptionInput = document.getElementById('tokenDescription')
  const imageInput = document.getElementById('tokenImageInput')

  nameInput?.addEventListener('input', () => {
    setFormError('')
    renderPreview()
  })

  symbolInput?.addEventListener('input', () => {
    symbolInput.value = normalizeSymbol(symbolInput.value)
    setFormError('')
    renderPreview()
  })

  supplyInput?.addEventListener('input', () => {
    supplyInput.value = normalizeSupply(supplyInput.value)
    setFormError('')
    renderPreview()
  })

  websiteInput?.addEventListener('input', () => {
    setFormError('')
    renderPreview()
  })

  xInput?.addEventListener('input', () => {
    setFormError('')
    renderPreview()
  })

  telegramInput?.addEventListener('input', () => {
    setFormError('')
    renderPreview()
  })

  descriptionInput?.addEventListener('input', () => {
    setFormError('')
  })

  document.getElementById('pickTokenImageBtn')?.addEventListener('click', () => {
    imageInput?.click()
  })

  document.getElementById('clearTokenImageBtn')?.addEventListener('click', () => {
    clearSelectedImage()
    setFormError('')
  })

  imageInput?.addEventListener('change', handleImageSelected)

  document.getElementById('validateTokenBtn')?.addEventListener('click', handleValidateForm)
  document.getElementById('createTokenBtn')?.addEventListener('click', handleCreateToken)

  document.getElementById('tokenModalConfirmBtn')?.addEventListener('click', () => {
    if (tokenState.modalMode === 'prompt') {
      const inputEl = document.getElementById('tokenModalInput')
      closeModal(inputEl?.value || '')
      return
    }

    closeModal(true)
  })

  document.getElementById('tokenModalCancelBtn')?.addEventListener('click', () => {
    closeModal(null)
  })

  document.getElementById('tokenModalCloseBtn')?.addEventListener('click', () => {
    closeModal(null)
  })

  document.getElementById('tokenModal')?.addEventListener('click', (event) => {
    if (event.target.id === 'tokenModal') {
      closeModal(null)
    }
  })

  document.getElementById('tokenModalInput')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      const inputEl = document.getElementById('tokenModalInput')
      closeModal(inputEl?.value || '')
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      closeModal(null)
    }
  })
}

renderPage()