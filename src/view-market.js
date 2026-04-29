import { auth, db } from './firebase'
import { doc, getDoc } from 'firebase/firestore'
import { onAuthStateChanged, setPersistence, browserLocalPersistence } from 'firebase/auth'
import { JsonRpcProvider, Contract, Wallet, parseUnits, formatUnits } from 'ethers'

const POLYGON_CHAIN_ID = Number(import.meta.env.VITE_POLYGON_CHAIN_ID || 137)
const POLYGON_RPC_PRIMARY_URL = new URL('/api/rpc', window.location.origin).toString()

const CONTRACT_ADDRESS = '0xb6b57B6146e535d2D850B0Ea086D29EdBacB5A0C'
const VWALA_TOKEN = '0x7bD1f6f4F5CEf026b643758605737CB48b4B7D83'

const USER_PREDICTIONS_ABI = [
  'function getMarket(uint256 marketId) view returns (tuple(bool exists,address creator,uint256 closeAt,uint16 feeBps,uint16 probA,uint16 probB,uint256 poolA,uint256 poolB,uint256 totalPool,bool resolved,uint8 winningOption,uint256 resolvedAt))',
  'function buyPosition(uint256 marketId, uint8 option, uint256 amount) external'
]

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)'
]

let currentGoogleUser = null
let currentMarket = null
let state = { provider: null, signer: null, userAddress: '' }

window.showAlert = (title, message, type = 'success') => {
  const existing = document.getElementById('premium-modal')
  if (existing) existing.remove()

  const modal = document.createElement('div')
  modal.id = 'premium-modal'
  modal.className = `modal-overlay ${type}`
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-icon">${type === 'success' ? '🎉' : '⚠️'}</div>
      <h2 class="modal-title">${title}</h2>
      <p class="modal-message">${message}</p>
      <button class="modal-btn" onclick="this.closest('.modal-overlay').remove()">FECHAR</button>
    </div>
  `
  document.body.appendChild(modal)
  modal.style.display = 'flex'
}

window.showLoadingModal = (title = 'Processando', message = '') => {
  const existing = document.getElementById('loading-modal')
  if (existing) return

  const modal = document.createElement('div')
  modal.id = 'loading-modal'
  modal.className = 'modal-overlay loading'
  modal.innerHTML = `<div class="modal-content"><div class="premium-spinner"></div><h2>${title}</h2><p>${message}</p></div>`
  document.body.appendChild(modal)
  modal.style.display = 'flex'
}

window.hideLoadingModal = () => {
  const modal = document.getElementById('loading-modal')
  if (modal) modal.remove()
}

window.showPinModal = () => new Promise(resolve => {
  const existing = document.getElementById('pin-modal')
  if (existing) existing.remove()

  const modal = document.createElement('div')
  modal.id = 'pin-modal'
  modal.className = 'modal-overlay'
  modal.innerHTML = `
    <div class="modal-content pin-modal">
      <div class="modal-icon">🔑</div>
      <h2>Confirmar PIN</h2>
      <p>Digite seu PIN para apostar</p>
      <input type="password" id="pin-input" class="input pin-input" maxlength="6" autocomplete="off">
      <div class="pin-buttons">
        <button class="modal-btn cancel-btn" id="cancel-pin-btn">Cancelar</button>
        <button class="modal-btn confirm-btn" id="confirm-pin-btn">Confirmar</button>
      </div>
    </div>
  `

  document.body.appendChild(modal)
  modal.style.display = 'flex'

  setTimeout(() => document.getElementById('pin-input')?.focus(), 150)

  document.getElementById('cancel-pin-btn').onclick = () => {
    modal.remove()
    resolve(null)
  }

  document.getElementById('confirm-pin-btn').onclick = () => {
    const pin = document.getElementById('pin-input').value.trim()
    modal.remove()
    resolve(pin)
  }
})

async function syncWalletProfileFromFirebase() {
  if (!currentGoogleUser?.uid) return

  try {
    const snap = await getDoc(doc(db, 'users', currentGoogleUser.uid))
    if (!snap.exists()) return

    const data = snap.data()
    let addr = String(data.walletAddress || '').trim()

    if (!addr && data.walletKeystoreCloud) {
      const unlocked = await Wallet.fromEncryptedJson(
        data.walletKeystoreCloud,
        `vwala_google_device_pin_v1:${currentGoogleUser.uid}`
      )
      addr = unlocked.address
    }

    if (addr) state.userAddress = addr
  } catch (error) {
    console.error(error)
  }
}

async function getInternalWalletSigner() {
  if (state.signer) return state.signer

  const vault = JSON.parse(localStorage.getItem('vwala_device_wallet') || 'null')
  if (!vault?.walletKeystoreLocal) {
    showAlert('Carteira não encontrada', 'Crie um PIN na página de Swap primeiro.', 'error')
    return null
  }

  if (state.userAddress.toLowerCase() !== String(vault.walletAddress || '').toLowerCase()) {
    showAlert('Carteira incompatível', 'A carteira local não pertence a este usuário.', 'error')
    return null
  }

  while (true) {
    const pin = await window.showPinModal()
    if (!pin) return null

    try {
      const wallet = await Wallet.fromEncryptedJson(vault.walletKeystoreLocal, pin)
      state.signer = wallet.connect(state.provider)
      return state.signer
    } catch {
      showAlert('PIN inválido', 'Tente novamente.', 'error')
    }
  }
}

async function getUserVWalaBalance() {
  if (!state.userAddress) return '0.00'

  try {
    const token = new Contract(VWALA_TOKEN, ERC20_ABI, state.provider)
    const balance = await token.balanceOf(state.userAddress)
    return formatUnits(balance, 18)
  } catch (error) {
    console.error('Erro ao buscar saldo:', error)
    return '0.00'
  }
}

async function loadMarket() {
  const marketIdStr = document.getElementById('marketId').value.trim()
  const content = document.getElementById('marketContent')

  if (!marketIdStr) {
    showAlert('ID obrigatório', 'Digite o Market ID.', 'error')
    return
  }

  content.style.display = 'block'
  content.innerHTML = '<p class="loading-text">Carregando aposta...</p>'

  try {
    const marketId = BigInt(marketIdStr)
    const contract = new Contract(CONTRACT_ADDRESS, USER_PREDICTIONS_ABI, state.provider)
    const onChain = await contract.getMarket(marketId)

    if (!onChain.exists) throw new Error('Mercado não encontrado')

    let title = `Mercado #${marketIdStr}`
    let optionA = 'Opção A'
    let optionB = 'Opção B'

    const fbSnap = await getDoc(doc(db, 'markets', marketIdStr))
    if (fbSnap.exists()) {
      const fb = fbSnap.data()
      title = fb.title || title
      optionA = fb.optionA || optionA
      optionB = fb.optionB || optionB
    }

    currentMarket = { id: marketIdStr, ...onChain, title, optionA, optionB }

    const closeDate = new Date(Number(onChain.closeAt) * 1000)
    const userBalance = await getUserVWalaBalance()

    content.innerHTML = `
      <div class="market-detail-card">
        <h2>${title}</h2>

        <div class="market-status">
          ${onChain.resolved
            ? '<span class="status resolved">🔴 Resolvido</span>'
            : `<span class="status active">🟢 Ativo • Fecha: ${closeDate.toLocaleDateString('pt-BR')}</span>`}
        </div>

        <div class="options-bet">
          <div class="option-card a"><strong>A:</strong> ${optionA}</div>
          <div class="option-card b"><strong>B:</strong> ${optionB}</div>
        </div>

        ${!onChain.resolved ? `
          <div class="bet-section">
            <div class="user-balance">
              Seu saldo: <strong>${Number(userBalance).toFixed(2)} vWALA</strong>
            </div>

            <input
              type="number"
              id="betAmount"
              class="input"
              placeholder="Quantidade vWALA"
              min="0.1"
              step="0.1"
              value="2"
            />

            <div class="bet-buttons">
              <button id="betA" class="bet-btn a">APOSTAR EM A</button>
              <button id="betB" class="bet-btn b">APOSTAR EM B</button>
            </div>
          </div>
        ` : ''}
      </div>
    `

    if (!onChain.resolved) {
      document.getElementById('betA').onclick = () => placeBet(0)
document.getElementById('betB').onclick = () => placeBet(1)
    }
  } catch (error) {
    console.error(error)
    content.innerHTML = `<p class="error-text">Aposta não encontrada.<br><small>${error.message}</small></p>`
  }
}

async function placeBet(option) {
  const amountStr = document.getElementById('betAmount').value.trim()
  const amount = parseFloat(amountStr)

  if (!amount || amount <= 0) {
    showAlert('Valor inválido', 'Digite uma quantidade maior que zero.', 'error')
    return
  }

  const signer = await getInternalWalletSigner()
  if (!signer) return

  try {
    const amountWei = parseUnits(amount.toString(), 18)
    const now = Math.floor(Date.now() / 1000)
    const userBalance = await getUserVWalaBalance()

    if (currentMarket.resolved) {
      throw new Error('Mercado já resolvido')
    }

    if (now >= Number(currentMarket.closeAt)) {
      throw new Error('Mercado encerrado')
    }

    if (Number(userBalance) < amount) {
      throw new Error('Saldo insuficiente de vWALA')
    }

    showLoadingModal('Aprovando vWALA...')

    const vWala = new Contract(VWALA_TOKEN, ERC20_ABI, signer)
    const predictions = new Contract(CONTRACT_ADDRESS, USER_PREDICTIONS_ABI, signer)

    const allowance = await vWala.allowance(state.userAddress, CONTRACT_ADDRESS)
    if (allowance < amountWei) {
      const approveTx = await vWala.approve(CONTRACT_ADDRESS, amountWei)
      await approveTx.wait()
    }

    hideLoadingModal()
    showLoadingModal('Enviando aposta...')

    const marketId = BigInt(currentMarket.id)

    await predictions.buyPosition.staticCall(marketId, option, amountWei)

const tx = await predictions.buyPosition(marketId, option, amountWei)
    await tx.wait()

    state.signer = null
    hideLoadingModal()

    showAlert('✅ Aposta realizada!', `Você apostou ${amount} vWALA.`, 'success')
    setTimeout(loadMarket, 3000)
  } catch (error) {
    state.signer = null
    hideLoadingModal()
    console.error(error)
    showAlert('Erro na transação', error.shortMessage || error.reason || error.message, 'error')
  }
}

async function boot() {
  await setPersistence(auth, browserLocalPersistence)

  await new Promise(resolve => {
    onAuthStateChanged(auth, async user => {
      currentGoogleUser = user
      if (user) await syncWalletProfileFromFirebase()
      resolve()
    })
  })

  state.provider = new JsonRpcProvider(POLYGON_RPC_PRIMARY_URL, POLYGON_CHAIN_ID)

  document.getElementById('searchBtn').addEventListener('click', loadMarket)
  document.getElementById('marketId').addEventListener('keypress', e => {
    if (e.key === 'Enter') loadMarket()
  })

  console.log('📄 Página Ver Aposta v2.14 ✅')
}

boot()
