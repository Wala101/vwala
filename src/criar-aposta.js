import { auth, db } from './firebase'
import {
  browserLocalPersistence,
  onAuthStateChanged,
  setPersistence
} from 'firebase/auth'
import { 
  doc, 
  getDoc, 
  setDoc, 
  serverTimestamp,
  collection,
  query,
  getDocs,
  orderBy 
} from 'firebase/firestore'
import { JsonRpcProvider, Wallet, Contract } from 'ethers'

const POLYGON_CHAIN_ID = Number(import.meta.env.VITE_POLYGON_CHAIN_ID || 137)
const POLYGON_RPC_PRIMARY_URL = new URL('/api/rpc', window.location.origin).toString()

const CONTRACT_ADDRESS = '0x25F9007ef8E62796C1ed0259B6266d097577e133'
const VWALA_TOKEN = '0x7bD1f6f4F5CEf026b643758605737CB48b4B7D83'
const TOKEN_SYMBOL = 'vWALA'

// ==================== ABI ATUALIZADO ====================
const USER_PREDICTIONS_ABI = [
  'function createMarket(string title, string optionA, string optionB, uint256 closeAt, uint16 feeBps, uint16 probA, uint16 probB) external returns (uint256)',
  'function resolveMarket(uint256 marketId, bool outcomeA) external',
  'function markets(uint256 marketId) view returns (tuple(uint256 id, string title, string optionA, string optionB, uint256 closeAt, uint16 feeBps, uint16 probA, uint16 probB, bool resolved, bool outcomeA, uint256 totalVolume))',
  'event MarketCreated(uint256 indexed marketId, address indexed creator)'
]

let currentGoogleUser = null

const state = {
  provider: null,
  signer: null,
  userAddress: ''
}

// ==================== MODAIS PREMIUM ====================
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
      <p class="modal-message break-text">${message}</p>
      <button class="modal-btn" onclick="this.closest('.modal-overlay').remove()">FECHAR</button>
    </div>
  `
  document.body.appendChild(modal)
  modal.style.display = 'flex'
}

window.showLoadingModal = (title = 'Processando', message = 'Enviando transação...') => {
  const existing = document.getElementById('loading-modal')
  if (existing) return

  const modal = document.createElement('div')
  modal.id = 'loading-modal'
  modal.className = 'modal-overlay loading'

  modal.innerHTML = `
    <div class="modal-content">
      <div class="premium-spinner"></div>
      <h2 class="modal-title">${title}</h2>
      <p class="modal-message">${message}</p>
    </div>
  `
  document.body.appendChild(modal)
  modal.style.display = 'flex'
}

window.hideLoadingModal = () => {
  const modal = document.getElementById('loading-modal')
  if (modal) modal.remove()
}


// ==================== MODAL DE PIN (Premium) ====================
window.showPinModal = (title = 'Confirmar PIN', message = 'Digite seu PIN para continuar') => {
  return new Promise((resolve) => {
    const existing = document.getElementById('pin-modal')
    if (existing) existing.remove()

    const modal = document.createElement('div')
    modal.id = 'pin-modal'
    modal.className = 'modal-overlay'

    modal.innerHTML = `
      <div class="modal-content pin-modal">
        <div class="modal-icon">🔑</div>
        <h2 class="modal-title">${title}</h2>
        <p class="modal-message">${message}</p>
        
        <input type="password" id="pin-input" class="input pin-input" 
               placeholder="••••••" maxlength="6" autocomplete="off" autofocus>
        
        <div class="pin-buttons">
          <button class="modal-btn cancel-btn" onclick="this.closest('.modal-overlay').remove(); resolve(null)">Cancelar</button>
          <button class="modal-btn confirm-btn" id="confirm-pin-btn">Confirmar</button>
        </div>
      </div>
    `

    document.body.appendChild(modal)
    modal.style.display = 'flex'

    const pinInput = document.getElementById('pin-input')
    const confirmBtn = document.getElementById('confirm-pin-btn')

    setTimeout(() => pinInput.focus(), 150)

    pinInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') confirmBtn.click()
    })

    confirmBtn.addEventListener('click', () => {
      const pin = pinInput.value.trim()
      modal.remove()
      resolve(pin)
    })
  })
}

// ==================== CARTEIRA INTERNA ====================
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
  let walletAddress = String(userData.walletAddress || '').trim()

  if (!walletAddress && userData.walletKeystoreCloud) {
    try {
      const unlocked = await Wallet.fromEncryptedJson(
        userData.walletKeystoreCloud,
        `vwala_google_device_pin_v1:${currentGoogleUser.uid}`
      )
      walletAddress = unlocked.address
    } catch (e) {
      console.error('Erro ao descriptografar keystore cloud:', e)
    }
  }

  if (walletAddress) {
    localStorage.setItem('vwala_wallet_profile', JSON.stringify({
      uid: currentGoogleUser.uid,
      walletAddress,
      chainId: POLYGON_CHAIN_ID,
      network: 'polygon'
    }))
    state.userAddress = walletAddress
  }
}

async function initFirebaseSession() {
  try {
    await setPersistence(auth, browserLocalPersistence)

    await new Promise(resolve => {
      const unsubscribe = onAuthStateChanged(auth, async (user) => {
        currentGoogleUser = user
        if (user) await syncWalletProfileFromFirebase()
        unsubscribe()
        resolve()
      })
    })
  } catch (error) {
    console.error('Erro initFirebaseSession:', error)
  }
}

async function getInternalWalletSigner() {
  if (state.signer) return state.signer

  const deviceVault = JSON.parse(localStorage.getItem('vwala_device_wallet') || 'null')

  if (!deviceVault?.walletKeystoreLocal) {
    showAlert('Carteira não encontrada', 'Crie um PIN na página de Swap primeiro.', 'error')
    return null
  }

  const expectedAddress = state.userAddress.toLowerCase()
  const vaultAddress = String(deviceVault.walletAddress || '').toLowerCase()

  if (expectedAddress !== vaultAddress) {
    showAlert('Carteira incompatível', 'A carteira local não bate com a logada.', 'error')
    return null
  }

  while (true) {
    const pin = await new Promise(resolve => {
      if (typeof window.showPinModal === 'function') {
        window.showPinModal('Confirmar PIN', 'Digite o PIN para criar a aposta').then(resolve)
      } else {
        const p = prompt('Digite o PIN da carteira:')
        resolve(p)
      }
    })

    if (!pin) return null

    try {
      const unlockedWallet = await Wallet.fromEncryptedJson(deviceVault.walletKeystoreLocal, pin.trim())
      const signer = unlockedWallet.connect(state.provider)
      state.signer = signer
      return signer
    } catch (error) {
      showAlert('PIN Inválido', 'PIN incorreto. Tente novamente.', 'error')
    }
  }
}

// ==================== SALDO ====================
async function loadUserTokenBalance() {
  if (!currentGoogleUser?.uid || !state.userAddress) return '0'

  try {
    const balanceRef = doc(db, 'users', currentGoogleUser.uid, 'swap_balances', 'vwala')
    const snap = await getDoc(balanceRef)

    if (snap.exists()) {
      const data = snap.data()
      return String(data.balanceFormatted || data.balance || '0')
    }
    return '0'
  } catch (e) {
    console.error(e)
    return '0'
  }
}

// ==================== CARREGAR MINHAS APOSTAS ====================
async function loadMyMarkets() {
  if (!currentGoogleUser?.uid) {
    console.log("Usuário ainda não carregado, pulando lista de mercados");
    return;
  }

  const container = document.getElementById('myMarketsList')
  if (!container) return;

  container.innerHTML = '<p class="loading-text">Carregando suas apostas...</p>';

  try {
    const marketsRef = collection(db, 'users', currentGoogleUser.uid, 'myMarkets');
    const snapshot = await getDocs(marketsRef);

    if (snapshot.empty) {
      container.innerHTML = `<p class="empty-state">Você ainda não criou nenhuma aposta.</p>`;
      return;
    }

    const markets = [];
    snapshot.forEach((docSnap) => {
      if (docSnap.exists()) {
        markets.push({ id: docSnap.id, ...docSnap.data() });
      }
    });

    markets.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

    let html = '';
    markets.forEach((m) => {
      const date = m.closeAtDate 
        ? new Date(m.closeAtDate.seconds * 1000).toLocaleDateString('pt-BR')
        : '—';

      const isActive = m.status === 'active';

      html += `
<div class="market-item">
  <div class="market-header">
    <div class="market-title">${m.title || 'Sem título'}</div>
    <span class="status ${m.status || 'active'}">
      ${isActive ? '🟢 Ativa' : '🔴 Resolvida'}
    </span>
  </div>

  <div class="market-options">
    <span>A: ${m.optionA || '?'} (${m.probA || 50}%)</span>
    <span>B: ${m.optionB || '?'} (${m.probB || 50}%)</span>
  </div>

  <div class="market-info">
    <span>Fecha: ${date}</span>
    ${m.winningOption ? `<br><span class="winner">🏆 Vencedor: ${m.winningOption === 'A' ? m.optionA : m.optionB}</span>` : ''}
  </div>

  <div class="market-actions">
    <button class="copy-market-btn" onclick="navigator.clipboard.writeText('${m.txHash || m.marketId || ''}'); showAlert('ID Copiado', 'ID da aposta copiado!', 'success')">
      📋 Copiar ID
    </button>
    
    ${isActive ? `
    <button class="resolve-btn" onclick="resolveUserMarket('${m.marketId}', '${(m.title || '').replace(/'/g, "\\'")}')">
      🔧 Resolver Aposta
    </button>` : ''}
  </div>

  <div class="market-hash">
    TX: ${String(m.txHash || m.marketId || '').slice(0, 12)}...${String(m.txHash || m.marketId || '').slice(-8)}
  </div>
</div>`;
    });

    container.innerHTML = html;

  } catch (error) {
    console.error("Erro ao carregar mercados:", error);
    container.innerHTML = `<p class="error-text">Erro ao carregar apostas.<br><small>Tente recarregar a página.</small></p>`;
  }
}

// ==================== CRIAR MERCADO ====================
async function createMarket() {
  const title = document.getElementById('title').value.trim()
  const optionA = document.getElementById('optionA').value.trim()
  const optionB = document.getElementById('optionB').value.trim()
  const closeAtStr = document.getElementById('closeAt').value
  const probA = parseInt(document.getElementById('probA').value)
  const probB = parseInt(document.getElementById('probB').value)

  if (!title || !optionA || !optionB || !closeAtStr) {
    showAlert('Campos incompletos', 'Preencha todos os campos obrigatórios.', 'error')
    return
  }
  if (probA + probB !== 100) {
    showAlert('Probabilidades inválidas', 'As probabilidades devem somar exatamente 100%.', 'error')
    return
  }

  const closeAtDate = new Date(closeAtStr)
  const closeAt = Math.floor(closeAtDate.getTime() / 1000)
  const now = Math.floor(Date.now() / 1000)

  // Validação importante
  if (closeAt <= now) {
    showAlert('Data inválida', 'A data de fechamento deve ser no futuro (pelo menos 1 hora à frente).', 'error')
    return
  }
  if (closeAt - now < 3600) { // menos de 1 hora
    showAlert('Data muito próxima', 'A aposta deve fechar com pelo menos 1 hora de antecedência.', 'error')
    return
  }

  const btn = document.getElementById('createBtn')
  btn.disabled = true
  btn.textContent = "Criando Mercado..."

  try {
    const internalSigner = await getInternalWalletSigner()
    if (!internalSigner) return

    const contract = new Contract(CONTRACT_ADDRESS, USER_PREDICTIONS_ABI, internalSigner)

    showLoadingModal('Criando Mercado', 'Confirmando transação na Polygon...')

    const tx = await contract.createMarket(
      title, 
      optionA, 
      optionB, 
      closeAt, 
      300, 
      probA * 100, 
      probB * 100
    )

    const receipt = await tx.wait()
hideLoadingModal()

const marketCreatedLog = receipt.logs.find(log => {
  try {
    const parsed = contract.interface.parseLog(log)
    return parsed && parsed.name === 'MarketCreated'
  } catch {
    return false
  }
})

if (!marketCreatedLog) {
  throw new Error('Evento MarketCreated não encontrado na transação.')
}

const parsedEvent = contract.interface.parseLog(marketCreatedLog)
const marketId = parsedEvent.args.marketId.toString()

if (currentGoogleUser?.uid) {
  const txHash = tx.hash

  const marketData = {
    marketId,
    title,
    optionA,
    optionB,
    closeAt,
    closeAtDate,
    probA,
    probB,
    feeBps: 300,
    creator: state.userAddress,
    txHash,
    createdAt: serverTimestamp(),
    status: 'active',
    resolved: false
  }

  await setDoc(
    doc(db, 'users', currentGoogleUser.uid, 'myMarkets', txHash),
    marketData
  )
}

showAlert(
  '✅ Mercado Criado com Sucesso!',
  `Transação confirmada!<br>Hash: <small>${tx.hash}</small>`,
  'success'
)

    // Limpar formulário
    document.getElementById('title').value = ''
    document.getElementById('optionA').value = ''
    document.getElementById('optionB').value = ''
    document.getElementById('probA').value = '50'
    document.getElementById('probB').value = '50'

    await loadMyMarkets()

  } catch (error) {
    hideLoadingModal()
    console.error(error)
    showAlert('Falha na Transação', error.shortMessage || error.message || 'Erro desconhecido', 'error')
  } finally {
    btn.disabled = false
    btn.textContent = "🚀 Criar Mercado"
  }
}



// ==================== RESOLVER MERCADO ====================
async function resolveUserMarket(marketId, title) {
  if (!currentGoogleUser?.uid) {
    showAlert('Erro', 'Usuário não identificado', 'error')
    return
  }

  const marketRef = doc(db, 'users', currentGoogleUser.uid, 'myMarkets', String(marketId))
  const snap = await getDoc(marketRef)

  if (!snap.exists()) {
    showAlert('Erro', 'Mercado não encontrado', 'error')
    return
  }

  const market = snap.data()
  if (market.status !== 'active') {
    showAlert('Já resolvido', 'Este mercado já foi resolvido.', 'error')
    return
  }

  // Modal de escolha do vencedor
  const winner = await new Promise(resolve => {
    const modal = document.createElement('div')
    modal.className = 'modal-overlay'
    modal.innerHTML = `
      <div class="modal-content resolve-modal">
        <div class="modal-icon">🔧</div>
        <h2 class="modal-title">Resolver Mercado</h2>
        <p><strong>${title}</strong></p>
        <p>Qual opção ganhou?</p>
        
        <div style="display: flex; flex-direction: column; gap: 12px; margin: 20px 0;">
          <button class="resolve-option-btn" data-winner="true" style="padding: 16px; font-size: 1.1em; background: #10b981; color: white; border: none; border-radius: 12px; cursor: pointer;">
            ✅ ${market.optionA}
          </button>
          <button class="resolve-option-btn" data-winner="false" style="padding: 16px; font-size: 1.1em; background: #ef4444; color: white; border: none; border-radius: 12px; cursor: pointer;">
            ✅ ${market.optionB}
          </button>
        </div>

        <button class="modal-btn cancel-btn" onclick="this.closest('.modal-overlay').remove(); resolve(null)">Cancelar</button>
      </div>
    `
    document.body.appendChild(modal)
    modal.style.display = 'flex'

    modal.querySelectorAll('.resolve-option-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        modal.remove()
        resolve(btn.dataset.winner === 'true')
      })
    })
  })

  if (winner === null) return

  const signer = await getInternalWalletSigner()
  if (!signer) return

  const contract = new Contract(CONTRACT_ADDRESS, USER_PREDICTIONS_ABI, signer)

  try {
    showLoadingModal('Resolvendo Mercado', 'Confirmando transação na Polygon...')

    const tx = await contract.resolveMarket(marketId, winner)
    await tx.wait()

    hideLoadingModal()

    await setDoc(marketRef, {
      status: 'resolved',
      winningOption: winner ? 'A' : 'B',
      resolvedAt: serverTimestamp(),
      resolveTxHash: tx.hash
    }, { merge: true })

    showAlert(
      '✅ Mercado Resolvido com Sucesso!',
      `Vencedor: <strong>${winner ? market.optionA : market.optionB}</strong><br>Tx: <small>${tx.hash}</small>`,
      'success'
    )

    await loadMyMarkets()

  } catch (error) {
    hideLoadingModal()
    console.error(error)
    showAlert('Erro na resolução', error.shortMessage || error.message || 'Erro desconhecido', 'error')
  }
}

// ==================== EXPOR FUNÇÕES GLOBAIS (OBRIGATÓRIO) ====================
window.resolveUserMarket = resolveUserMarket;
window.createMarket = createMarket;

// ==================== RENDER ====================
function renderPage() {
  document.querySelector('#app').innerHTML = `
    <div class="page-shell">
      <div class="app-frame">
        <header class="topbar" style="display: none !important;">
          <div class="brand-wrap">
            <div class="brand-badge premium">W</div>
            <div class="brand-text">
              <strong>Wala</strong>
              <span>Predictions</span>
            </div>
          </div>
          <button id="connectBtn" class="connect-btn">Carregando...</button>
        </header>

        <main class="app-content">
          <div class="create-page">
            <div class="create-header">
              <h1>🚀 Criar Mercado</h1>
              <p>Crie sua própria aposta • Apenas você pode resolver</p>
            </div>

            <div class="form-card">
              <input type="text" id="title" class="input" placeholder="Título da Aposta" maxlength="120" />
              <div class="options-grid">
                <input type="text" id="optionA" class="input" placeholder="Opção A (Ex: Sim)" />
                <input type="text" id="optionB" class="input" placeholder="Opção B (Ex: Não)" />
              </div>
              <input type="datetime-local" id="closeAt" class="input" />
              <div class="prob-row">
                <div><label>Probabilidade A (%)</label><input type="number" id="probA" value="50" min="1" max="99" class="input" /></div>
                <div><label>Probabilidade B (%)</label><input type="number" id="probB" value="50" min="1" max="99" class="input" /></div>
              </div>
              <button id="createBtn" class="launch-btn">🚀 Criar Mercado</button>
            </div>

            <div class="my-markets-section">
              <h2>📋 Minhas Apostas</h2>
              <div id="myMarketsList" class="markets-list"></div>
            </div>
          </div>
        </main>
      </div>
    </div>
  `

  document.getElementById('createBtn').addEventListener('click', createMarket)
  document.getElementById('connectBtn').addEventListener('click', loadUserTokenBalance)
}

// ==================== BOOT ====================
async function boot() {
  await initFirebaseSession();

  state.provider = new JsonRpcProvider(POLYGON_RPC_PRIMARY_URL, POLYGON_CHAIN_ID);

  renderPage();

  const balance = await loadUserTokenBalance();
  const connectBtn = document.getElementById('connectBtn');
  if (connectBtn) connectBtn.textContent = `${balance} ${TOKEN_SYMBOL}`;

  setTimeout(async () => {
    await loadMyMarkets();
  }, 800);
}

boot();

console.log("📄 Página Criar Aposta v2 - Premium + Minhas Apostas ✅");