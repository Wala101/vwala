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
  getDocs
} from 'firebase/firestore'
import { JsonRpcProvider, Wallet, Contract } from 'ethers'

const POLYGON_CHAIN_ID = Number(import.meta.env.VITE_POLYGON_CHAIN_ID || 137)
const POLYGON_RPC_PRIMARY_URL = new URL('/api/rpc', window.location.origin).toString()
const CONTRACT_ADDRESS = '0xb6b57B6146e535d2D850B0Ea086D29EdBacB5A0C'
const VWALA_TOKEN = '0x7bD1f6f4F5CEf026b643758605737CB48b4B7D83'
const TOKEN_SYMBOL = 'vWALA'
// ==================== ABI ATUALIZADO ====================
const USER_PREDICTIONS_ABI = [
  'function createMarket(string title, string optionA, string optionB, uint256 closeAt, uint16 feeBps, uint16 probA, uint16 probB) external returns (uint256)',
  'function resolveMarket(uint256 marketId, uint8 winningOption) external',
  'function getMarket(uint256 marketId) view returns (tuple(bool exists,address creator,uint256 closeAt,uint16 feeBps,uint16 probA,uint16 probB,uint256 poolA,uint256 poolB,uint256 totalPool,bool resolved,uint8 winningOption,uint256 resolvedAt))',
  'event MarketCreated(uint256 indexed marketId, address indexed creator)',
  'event MarketResolved(uint256 indexed marketId, uint8 winningOption)'
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


// ==================== MODAL DE PIN (PADRONIZADO - IGUAL AOS OUTROS) ====================
window.showPinModal = (title = 'Confirmar PIN', message = 'Digite seu PIN para continuar') => {
  return new Promise((resolve) => {
    // Remove modal antigo se existir
    const existing = document.getElementById('appPinModal')
    if (existing) existing.remove()

    const modalHTML = `
      <div id="appPinOverlay" class="overlay" style="display:flex;"></div>
      <div id="appPinModal" class="custom-modal" style="display:flex;">
        <div class="card modal-card notice-modal-card app-pin-modal-card">
          <div class="modal-header app-pin-modal-header">
            <div class="app-pin-modal-brand">
              <div class="app-pin-modal-badge">W</div>
              <div class="app-pin-modal-headings">
                <h3 id="appPinTitle">${title}</h3>
                <span class="app-pin-modal-subtitle">Segurança da carteira</span>
              </div>
            </div>
            <button class="modal-close app-pin-modal-close" id="closeAppPinBtn">✕</button>
          </div>

          <div class="notice-modal-body app-pin-modal-body">
            <p id="appPinText" class="notice-modal-text app-pin-modal-text">
              ${message}
            </p>

            <div class="app-pin-input-wrap">
              <input
                id="appPinInput"
                class="input app-pin-input"
                type="password"
                placeholder="Digite seu PIN"
                autocomplete="current-password"
                maxlength="6"
              />
            </div>
          </div>

          <div class="notice-modal-footer app-pin-actions app-pin-modal-footer">
            <button id="appPinConfirmBtn" class="notice-confirm-btn app-pin-confirm-btn">Confirmar</button>
          </div>
        </div>
      </div>
    `

    const tempDiv = document.createElement('div')
    tempDiv.innerHTML = modalHTML
    document.body.appendChild(tempDiv)

    // Elementos
    const pinInput = document.getElementById('appPinInput')
    const confirmBtn = document.getElementById('appPinConfirmBtn')
    const closeBtn = document.getElementById('closeAppPinBtn')
    const overlay = document.getElementById('appPinOverlay')

    setTimeout(() => pinInput.focus(), 100)

    // Eventos
    const closeModal = (result = null) => {
      tempDiv.remove()
      resolve(result)
    }

    closeBtn.onclick = () => closeModal(null)
    overlay.onclick = () => closeModal(null)
    confirmBtn.onclick = () => closeModal(pinInput.value.trim())

    pinInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') confirmBtn.click()
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
      const marketIdToCopy = m.marketId || m.id;   // ← Prioriza o marketId numérico

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
    <button class="copy-market-btn" 
            onclick="navigator.clipboard.writeText('${marketIdToCopy}'); 
                     showAlert('ID Copiado!', 'Market ID copiado com sucesso!<br>Envie este número para seus amigos.', 'success')">
      📋 Copiar Market ID
    </button>
    
    ${isActive ? `
    <button class="resolve-btn" onclick="resolveUserMarket('${m.marketId}', '${(m.title || '').replace(/'/g, "\\'")}')">
      🔧 Resolver Aposta
    </button>` : ''}
  </div>

  <div class="market-hash">
    Market ID: <strong>${marketIdToCopy}</strong><br>
    TX: ${String(m.txHash || '').slice(0, 12)}...${String(m.txHash || '').slice(-8)}
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
  // ==================== VERIFICAÇÃO DE PIN ====================
  const deviceVault = JSON.parse(localStorage.getItem('vwala_device_wallet') || 'null');
  
  if (!deviceVault?.walletKeystoreLocal) {
    showAlert(
      'Carteira não configurada', 
      'Você precisa criar um PIN na página de Swap antes de criar uma aposta.', 
      'error'
    );
    
    // Redireciona para página de carteira/swap
    setTimeout(() => {
      window.location.href = '/carteira';   // ← Altere se o caminho for diferente
    }, 1500);
    
    return;
  }
  // ============================================================

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

  if (closeAt <= now) {
    showAlert('Data inválida', 'A data de fechamento deve ser no futuro.', 'error')
    return
  }
  if (closeAt - now < 3600) {
    showAlert('Data muito próxima', 'A aposta deve fechar com pelo menos 1 hora de antecedência.', 'error')
    return
  }

  const btn = document.getElementById('createBtn')
  btn.disabled = true
  btn.textContent = "Criando Mercado..."

  try {
    const internalSigner = await getInternalWalletSigner()
if (!internalSigner) {
  btn.disabled = false
  btn.textContent = '🎲 Criar Mercado'
  return
}

    const contract = new Contract(CONTRACT_ADDRESS, USER_PREDICTIONS_ABI, internalSigner)

    showLoadingModal('Criando Mercado', 'Confirmando transação na Polygon...')



const feeData = await state.provider.getFeeData()
const signerAddress = await internalSigner.getAddress()

console.log('Signer:', signerAddress) 
console.log('Preparando envio da transação...')

const txRequest = await contract.createMarket.populateTransaction(
  title,
  optionA,
  optionB,
  closeAt,
  300,
  probA * 100,
  probB * 100
)

txRequest.gasLimit = 500000n
txRequest.maxFeePerGas = feeData.maxFeePerGas ?? undefined
txRequest.maxPriorityFeePerGas =
  feeData.maxPriorityFeePerGas ?? undefined


const tx = await internalSigner.sendTransaction(txRequest)

showLoadingModal(
  'Aguardando Confirmação',
  `Transação enviada. Hash: ${tx.hash.slice(0, 12)}...`
)

const receipt = await state.provider.waitForTransaction(tx.hash, 1, 180000)

if (!receipt) {
  throw new Error('Timeout: transação não confirmada em 3 minutos.')
}

if (receipt.status !== 1) {
  throw new Error('Transação falhou.')
}

    hideLoadingModal()

    const marketCreatedLog = receipt.logs.find(log => {
      try {
        const parsed = contract.interface.parseLog(log)
        return parsed && parsed.name === 'MarketCreated'
      } catch { return false }
    })

    if (!marketCreatedLog) throw new Error('Evento MarketCreated não encontrado.')

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

      // Salva no usuário (privado)
      await setDoc(doc(db, 'users', currentGoogleUser.uid, 'myMarkets', marketId), marketData)

      // Salva na coleção pública
      await setDoc(doc(db, 'markets', marketId), marketData)

      console.log(`✅ Mercado salvo publicamente → markets/${marketId}`)
    }

    showAlert(
      '✅ Mercado Criado com Sucesso!',
      `Market ID: <strong>${marketId}</strong><br>Hash: <small>${tx.hash}</small>`,
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
    showAlert('Falha na Transação', error.shortMessage || error.message, 'error')
  } finally {
    state.signer = null
    btn.disabled = false
    btn.textContent = "🎲 Criar Mercado"
  }
}


// ==================== RESOLVER MERCADO (ATUALIZA PARA TODO MUNDO) ====================
async function resolveUserMarket(marketId, title) {
  if (!currentGoogleUser?.uid) {
    showAlert('Erro', 'Usuário não identificado', 'error')
    return
  }

  const privateRef = doc(db, 'users', currentGoogleUser.uid, 'myMarkets', String(marketId))
  const publicRef   = doc(db, 'markets', String(marketId))   // ← COLEÇÃO PÚBLICA

  const snap = await getDoc(privateRef)
  if (!snap.exists()) {
    showAlert('Erro', 'Mercado não encontrado', 'error')
    return
  }

  const market = snap.data()

  const now = Math.floor(Date.now() / 1000)
  if (now < market.closeAt) {
    const minutes = Math.ceil((market.closeAt - now) / 60)
    showAlert('Mercado ainda aberto', `Poderá ser resolvido em ${minutes} minuto(s).`, 'error')
    return
  }


  
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

      <div style="display:flex;flex-direction:column;gap:12px;margin:20px 0;">
        <button class="resolve-option-btn" data-winner="0"
          style="padding:16px;font-size:1.1em;background:#10b981;color:white;border:none;border-radius:12px;cursor:pointer;">
          ✅ ${market.optionA}
        </button>

        <button class="resolve-option-btn" data-winner="1"
          style="padding:16px;font-size:1.1em;background:#ef4444;color:white;border:none;border-radius:12px;cursor:pointer;">
          ✅ ${market.optionB}
        </button>
      </div>

      <button id="cancelResolveBtn" class="modal-btn cancel-btn">Cancelar</button>
    </div>
  `

  document.body.appendChild(modal)
  modal.style.display = 'flex'

  modal.querySelectorAll('.resolve-option-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const selected = Number(btn.dataset.winner)
      modal.remove()
      resolve(selected)
    })
  })

  document.getElementById('cancelResolveBtn').addEventListener('click', () => {
    modal.remove()
    resolve(null)
  })
})

  if (winner === null) return

  const signer = await getInternalWalletSigner()
  if (!signer) return

  try {
    showLoadingModal('Resolvendo Mercado', 'Confirmando transação na Polygon...')

    const winningOption = winner === 0 ? 0 : 1
    const contract = new Contract(CONTRACT_ADDRESS, USER_PREDICTIONS_ABI, signer)
    const tx = await contract.resolveMarket(marketId, winningOption)
    await tx.wait()

    const updateData = {
      status: 'resolved',
      winningOption: winningOption === 0 ? 'A' : 'B',
      resolvedAt: serverTimestamp(),
      resolveTxHash: tx.hash
    }

    // 🔥 ATUALIZAÇÃO PARA TODO MUNDO
    await setDoc(privateRef, updateData, { merge: true })   // Privado do criador
    await setDoc(publicRef, updateData, { merge: true })    // Público (importante!)

    hideLoadingModal()

    showAlert(
      '✅ Mercado Resolvido com Sucesso!',
      `Vencedor: <strong>${winner === 0 ? market.optionA : market.optionB}</strong><br>Tx: <small>${tx.hash}</small>`,
      'success'
    )

    await loadMyMarkets()

 } catch (error) { 
  hideLoadingModal()
   console.error(error)
    showAlert( 
      'Erro na resolução',
       error.shortMessage || error.message,
       'error' ) 
  } finally {
     state.signer = null 
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
              <h1>🎲 Criar Mercado</h1>
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
              <button id="createBtn" class="launch-btn">🎲 Criar Mercado</button>
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