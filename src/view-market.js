import { auth, db } from './firebase'
import { doc, getDoc, collection, query, orderBy, getDocs, setDoc } from 'firebase/firestore'
import { onAuthStateChanged, setPersistence, browserLocalPersistence } from 'firebase/auth'
import { JsonRpcProvider, Contract, Wallet, parseUnits, formatUnits } from 'ethers'

const POLYGON_CHAIN_ID = Number(import.meta.env.VITE_POLYGON_CHAIN_ID || 137)
const POLYGON_RPC_PRIMARY_URL = new URL('/api/rpc', window.location.origin).toString()

const CONTRACT_ADDRESS = '0xb6b57B6146e535d2D850B0Ea086D29EdBacB5A0C'
const VWALA_TOKEN = '0x7bD1f6f4F5CEf026b643758605737CB48b4B7D83'

const USER_PREDICTIONS_ABI = [
  'function getMarket(uint256 marketId) view returns (tuple(bool exists,address creator,uint256 closeAt,uint16 feeBps,uint16 probA,uint16 probB,uint256 poolA,uint256 poolB,uint256 totalPool,bool resolved,uint8 winningOption,uint256 resolvedAt))',
  'function buyPosition(uint256 marketId, uint8 option, uint256 amount) external',
  'function redeemWinnings(uint256 marketId) external'
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

// ==================== MODAIS ====================
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
      <div class="modal-icon">🎲</div>
      <h2>Confirmar PIN</h2>
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

  document.getElementById('cancel-pin-btn').onclick = () => { modal.remove(); resolve(null) }
  document.getElementById('confirm-pin-btn').onclick = () => {
    const pin = document.getElementById('pin-input').value.trim()
    modal.remove()
    resolve(pin)
  }
})

// ==================== WALLET ====================
async function syncWalletProfileFromFirebase() {
  if (!currentGoogleUser?.uid) return
  try {
    const snap = await getDoc(doc(db, 'users', currentGoogleUser.uid))
    if (!snap.exists()) return
    const data = snap.data()
    let addr = String(data.walletAddress || '').trim()
    if (!addr && data.walletKeystoreCloud) {
      const unlocked = await Wallet.fromEncryptedJson(data.walletKeystoreCloud, `vwala_google_device_pin_v1:${currentGoogleUser.uid}`)
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
    showAlert('Carteira incompatível', '', 'error')
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

// ==================== SALDO ====================
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

// ==================== TABS ====================
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'))
  document.querySelectorAll('.tab-content').forEach(content => content.style.display = 'none')

  if (tab === 'search') {
    document.getElementById('tabSearch').classList.add('active')
    document.getElementById('searchTab').style.display = 'block'
  } else {
    document.getElementById('tabHistory').classList.add('active')
    document.getElementById('historyTab').style.display = 'block'
    loadUserHistory()
  }
}

// ==================== CARREGAR MERCADO ====================
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
            <div class="user-balance">Seu saldo: <strong>${Number(userBalance).toFixed(2)} vWALA</strong></div>
            <input type="number" id="betAmount" class="input" placeholder="Quantidade vWALA" min="0.1" step="0.1" value="2"/>
            <div class="bet-buttons">
              <button id="betA" class="bet-btn a">A</button>
              <button id="betB" class="bet-btn b">B</button>
            </div>
          </div>` : ''}
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

// ==================== SALVAR APOSTA NO FIRESTORE ====================
async function saveBetToFirestore(marketId, option, amount, title, closeAt) {
  if (!currentGoogleUser?.uid) return
  try {
    await setDoc(doc(db, 'users', currentGoogleUser.uid, 'myBets', marketId.toString()), {
      marketId: marketId.toString(),
      option: Number(option),
      amount: Number(amount),
      title: title,
      closeAt: Number(closeAt),
      timestamp: Date.now(),
      resolved: false,
      redeemed: false
    })
  } catch (e) {
    console.error('Erro ao salvar aposta no Firestore:', e)
  }
}

// ==================== APOSTAR ====================
async function placeBet(option) {
  const deviceVault = JSON.parse(localStorage.getItem('vwala_device_wallet') || 'null')
  if (!deviceVault?.walletKeystoreLocal) {
    showAlert('Carteira não configurada', 'Você precisa criar um PIN na página de Swap antes de apostar.', 'error')
    setTimeout(() => { window.location.href = '/carteira' }, 1800)
    return
  }

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

    if (currentMarket.resolved) throw new Error('Mercado já resolvido')
    if (now >= Number(currentMarket.closeAt)) throw new Error('Mercado encerrado')
    if (Number(userBalance) < amount) throw new Error('Saldo insuficiente de vWALA')

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
    const tx = await predictions.buyPosition(marketId, option, amountWei)
    await tx.wait()

    hideLoadingModal()
    showAlert('✅ Aposta realizada!', `Você apostou ${amount} vWALA.`, 'success')

    // Salva no Firestore
    await saveBetToFirestore(marketId, option, amount, currentMarket.title, currentMarket.closeAt)

    setTimeout(loadMarket, 3000)

  } catch (error) {
    hideLoadingModal()
    console.error(error)
    showAlert('Erro na transação', error.shortMessage || error.reason || error.message, 'error')
  }
}

// ==================== HISTÓRICO DO USUÁRIO ====================
async function loadUserHistory() {
  const container = document.getElementById('historyList')
  container.innerHTML = '<div class="loading-history">Carregando seu histórico...</div>'

  if (!currentGoogleUser?.uid || !state.userAddress) {
    container.innerHTML = `<div class="empty-history">Faça login e configure sua carteira para ver o histórico.</div>`
    return
  }

  try {
    const betsRef = collection(db, 'users', currentGoogleUser.uid, 'myBets')
    const q = query(betsRef, orderBy('timestamp', 'desc'))
    const snapshot = await getDocs(q)

    if (snapshot.empty) {
      container.innerHTML = `
        <div class="empty-history">
          <p>Você ainda não fez nenhuma aposta.</p>
          <small>Suas apostas aparecerão aqui automaticamente.</small>
        </div>`
      return
    }

    let html = ''
    for (const docSnap of snapshot.docs) {
      const bet = docSnap.data()
      const marketId = bet.marketId

      const isResolved = bet.resolved === true
      const isRedeemed = bet.redeemed === true
      const won = bet.winningOption !== undefined && Number(bet.option) === Number(bet.winningOption)

      let statusHTML = ''
      if (!isResolved) {
        statusHTML = `<span class="history-status status-active">🟢 Ativo</span>`
      } else if (isRedeemed) {
        statusHTML = `<span class="history-status status-redeemed">✅ Resgatado</span>`
      } else if (won) {
        statusHTML = `<span class="history-status status-resolved">🏆 Você ganhou!</span>`
      } else {
        statusHTML = `<span class="history-status status-resolved">🔴 Não foi dessa vez</span>`
      }

      html += `
        <div class="history-item">
          <div class="history-item-header">
            <div class="history-market-title">${bet.title || `Mercado #${marketId}`}</div>
            ${statusHTML}
          </div>
          <div class="history-bet-info">
            Apostou <strong>${Number(bet.amount || 0).toFixed(2)} vWALA</strong> na opção 
            <strong>${bet.option === 0 ? 'A' : 'B'}</strong><br>
            ${isResolved 
              ? `Resultado: Opção ${bet.winningOption === 0 ? 'A' : 'B'}` 
              : `Fecha em: ${new Date(bet.closeAt * 1000).toLocaleDateString('pt-BR')}`}
          </div>

          ${isResolved && !isRedeemed && won ? `
            <button class="redeem-btn" onclick="redeemWinnings('${marketId}')">
              🎁 Resgatar Prêmio
            </button>` : ''}
        </div>
      `
    }

    container.innerHTML = html

  } catch (error) {
    console.error('Erro ao carregar histórico:', error)
    container.innerHTML = `<div class="empty-history">Erro ao carregar histórico.</div>`
  }
}

window.redeemWinnings = async function(marketId) {
  const signer = await getInternalWalletSigner()
  if (!signer) return

  try {
    showLoadingModal('Resgatando prêmio...', 'Aguarde a confirmação na blockchain')

    const contract = new Contract(CONTRACT_ADDRESS, USER_PREDICTIONS_ABI, signer)
    const tx = await contract.redeemWinnings(BigInt(marketId))
    await tx.wait()

    hideLoadingModal()
    showAlert('✅ Prêmio resgatado!', 'Os vWALA foram enviados para sua carteira.', 'success')

    setTimeout(loadUserHistory, 3000)

  } catch (error) {
    hideLoadingModal()
    console.error(error)
    showAlert('Erro ao resgatar', error.shortMessage || error.message, 'error')
  }
}

// ==================== BOOT ====================
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

  // Tabs
  document.getElementById('tabSearch').addEventListener('click', () => switchTab('search'))
  document.getElementById('tabHistory').addEventListener('click', () => switchTab('history'))

  // Busca por Tx Hash
  document.getElementById('searchBtn').addEventListener('click', loadMarket)
  document.getElementById('marketId').addEventListener('keypress', e => {
    if (e.key === 'Enter') loadMarket()
  })

  // Refresh do histórico
  const refreshBtn = document.getElementById('refreshHistoryBtn')
  if (refreshBtn) refreshBtn.addEventListener('click', loadUserHistory)

  // Inicia na aba de busca
  switchTab('search')

  console.log('📄 Página Ver Aposta + Histórico v2.3 ✅')
}

boot()