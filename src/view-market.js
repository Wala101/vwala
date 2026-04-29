import { auth, db } from './firebase'
import { doc, getDoc, setDoc, collection, query, orderBy, getDocs, serverTimestamp } from 'firebase/firestore'
import { onAuthStateChanged, setPersistence, browserLocalPersistence } from 'firebase/auth'
import { JsonRpcProvider, Contract, Wallet, parseUnits, formatUnits } from 'ethers'

const POLYGON_CHAIN_ID = Number(import.meta.env.VITE_POLYGON_CHAIN_ID || 137)
const POLYGON_RPC_PRIMARY_URL = new URL('/api/rpc', window.location.origin).toString()

const CONTRACT_ADDRESS = '0xb6b57B6146e535d2D850B0Ea086D29EdBacB5A0C'
const VWALA_TOKEN = '0x7bD1f6f4F5CEf026b643758605737CB48b4B7D83'

const USER_PREDICTIONS_ABI = [
  'function getMarket(uint256 marketId) view returns (tuple(bool exists,address creator,uint256 closeAt,uint16 feeBps,uint16 probA,uint16 probB,uint256 poolA,uint256 poolB,uint256 totalPool,bool resolved,uint8 winningOption,uint256 resolvedAt))',
  'function buyPosition(uint256 marketId, uint8 option, uint256 amount) external',
  'function claim(uint256 marketId) external',                    // ← MUDOU AQUI
  'function getPosition(uint256 marketId, address user) view returns (tuple(bool exists,uint8 option,uint256 amount,bool claimed))'  // ← Melhor usar isso
];

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
 
          <div class="position-warning">
          ⚠️ Só é possível apostar em uma opção por mercado
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

// ==================== APOSTAR ====================
async function placeBet(option) {
  const deviceVault = JSON.parse(localStorage.getItem('vwala_device_wallet') || 'null')
  if (!deviceVault?.walletKeystoreLocal) {
    showAlert('Carteira não configurada', 'Crie um PIN na página de Swap primeiro.', 'error')
    setTimeout(() => window.location.href = '/carteira', 1800)
    return
  }

  const amountStr = document.getElementById('betAmount').value.trim()
  const amount = parseFloat(amountStr)

  if (!amount || amount <= 0) {
    showAlert('Valor inválido', 'Digite uma quantidade maior que zero.', 'error')
    return
  }

  let signer;
  try {
    signer = await getInternalWalletSigner()
    if (!signer) return
  } catch (e) {
    hideLoadingModal()
    showAlert('Erro na carteira', 'Não foi possível conectar a carteira.', 'error')
    return
  }

  try {
    const amountWei = parseUnits(amount.toString(), 18)
    const now = Math.floor(Date.now() / 1000)
    const userBalance = await getUserVWalaBalance()

    if (currentMarket.resolved) throw new Error('Mercado já resolvido')
    if (now >= Number(currentMarket.closeAt)) throw new Error('Mercado encerrado')
    if (Number(userBalance) < amount) throw new Error('Saldo insuficiente de vWALA')

    showLoadingModal('Aprovando vWALA...', 'Aguarde um momento')

    const vWala = new Contract(VWALA_TOKEN, ERC20_ABI, signer)
    const predictionsSigner = new Contract(CONTRACT_ADDRESS, USER_PREDICTIONS_ABI, signer)

    const allowance = await vWala.allowance(state.userAddress, CONTRACT_ADDRESS)
    if (allowance < amountWei) {
      showLoadingModal('Aprovando vWALA...', 'Confirmando na blockchain...')
      const approveTx = await vWala.approve(CONTRACT_ADDRESS, amountWei)
      await approveTx.wait()
    }

    showLoadingModal('Enviando aposta...', 'Confirmando transação na Polygon')

    const marketId = BigInt(currentMarket.id)
    const tx = await predictionsSigner.buyPosition(marketId, option, amountWei)
    await tx.wait()

    // ==================== SUCESSO - LIBERA O LOADING IMEDIATAMENTE ====================
    hideLoadingModal()
    showAlert('✅ Aposta realizada!', `Você apostou ${amount} vWALA.`, 'success')

    // Atualizações no Firebase (isoladas - não podem travar a tela)
    if (currentGoogleUser?.uid) {
      Promise.allSettled([
        saveBetToFirestore(marketId, option, amount, currentMarket.title, currentMarket.closeAt),
        saveBetToBalanceFirebase(currentGoogleUser.uid, state.userAddress, amount)
      ]).catch(e => console.error('Erro Firebase (não crítico):', e));
    }

    setTimeout(loadMarket, 2000)

  } catch (error) {
    hideLoadingModal()   // ← GARANTIDO EM QUALQUER ERRO
    console.error('Erro completo na aposta:', error)
    showAlert('Erro na transação', error.shortMessage || error.message || 'Tente novamente', 'error')
  }
}


// ==================== TABS (Buscar / Histórico) ====================
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(content => content.style.display = 'none');

  if (tab === 'search') {
    document.getElementById('tabSearch').classList.add('active');
    document.getElementById('searchTab').style.display = 'block';
  } else {
    document.getElementById('tabHistory').classList.add('active');
    document.getElementById('historyTab').style.display = 'block';
    loadUserHistory();
  }
}

// ==================== CARREGAR HISTÓRICO ====================
async function loadUserHistory() {
  const container = document.getElementById('historyList');
  if (!container) return;
  
  container.innerHTML = '<div class="loading-history">Carregando seu histórico...</div>';

  if (!currentGoogleUser?.uid) {
    container.innerHTML = `<div class="empty-history">Faça login para ver seu histórico.</div>`;
    return;
  }

  try {
    const betsRef = collection(db, 'users', currentGoogleUser.uid, 'myBets');
    const q = query(betsRef, orderBy('timestamp', 'desc'));
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      container.innerHTML = `<div class="empty-history">Você ainda não tem apostas.</div>`;
      return;
    }

    let html = '';
    for (const docSnap of snapshot.docs) {
      const bet = docSnap.data();
      const marketId = bet.marketId;

      // 🔥 VERIFICAÇÃO ON-CHAIN (só isso que você pediu)
      let isResolved = bet.resolved === true;
      let winningOption = bet.winningOption;

      if (!isResolved) {
        try {
          const contract = new Contract(CONTRACT_ADDRESS, USER_PREDICTIONS_ABI, state.provider);
          const market = await contract.getMarket(BigInt(marketId));
          if (market.resolved) {
            isResolved = true;
            winningOption = market.winningOption;
          }
        } catch (e) {
          console.log("Erro ao checar on-chain:", e);
        }
      }

      const isRedeemed = bet.redeemed === true;
      const won = isResolved && Number(bet.option) === Number(winningOption);

      let statusHTML = isResolved 
        ? (won ? `<span class="history-status status-resolved">🏆 Ganho</span>` : `<span class="history-status status-resolved">🔴 Perdido</span>`)
        : `<span class="history-status status-active">🟢 Ativo</span>`;

      html += `
        <div class="history-item">
          <div class="history-item-header">
            <div class="history-market-title">${bet.title || `Mercado #${marketId}`}</div>
            ${statusHTML}
          </div>
          <div class="history-bet-info">
            Apostou <strong>${Number(bet.amount || 0).toFixed(2)} vWALA</strong> na opção <strong>${bet.option === 0 ? 'A' : 'B'}</strong>
          </div>
          ${isResolved && !isRedeemed && won ? `
            <button class="redeem-btn" onclick="redeemWinnings('${marketId}')">🎁 Resgatar Prêmio</button>` : ''}
        </div>
      `;
    }
    container.innerHTML = html;
  } catch (error) {
    console.error(error);
    container.innerHTML = `<div class="empty-history">Erro ao carregar histórico.</div>`;
  }
}

window.redeemWinnings = async function(marketId) {
  const signer = await getInternalWalletSigner();
  if (!signer) return;

  try {
    showLoadingModal('Verificando Prêmio...', '');

    const contract = new Contract(CONTRACT_ADDRESS, USER_PREDICTIONS_ABI, state.provider);
    
    const market = await contract.getMarket(BigInt(marketId));
    const position = await contract.getPosition(BigInt(marketId), state.userAddress);

    if (!market.resolved) throw new Error('Mercado ainda não resolvido.');
    if (!position.exists || position.claimed) throw new Error('Prêmio já resgatado.');
    if (position.option !== market.winningOption) throw new Error('Você não ganhou esta aposta.');

    // Calcula o payout (igual ao contrato)
    const winningPool = position.option === 0 ? market.poolA : market.poolB;
    const payoutRaw = (BigInt(position.amount) * BigInt(market.totalPool)) / BigInt(winningPool);
    const payoutFormatted = formatUnits(payoutRaw, 18);

    showLoadingModal('Resgatando Prêmio...', 'Confirmando na Polygon...');

    const tx = await contract.connect(signer).claim(BigInt(marketId));
    const receipt = await tx.wait();

    hideLoadingModal();

    // 🔥 Atualiza Firebase
    await saveRedeemToFirebase(
      currentGoogleUser.uid, 
      state.userAddress, 
      marketId, 
      payoutFormatted
    );

    showAlert('✅ Resgate realizado!', 
      `Você recebeu <strong>${Number(payoutFormatted).toFixed(4)} vWALA</strong>`, 
      'success');

    setTimeout(loadUserHistory, 1500);

  } catch (error) {
    hideLoadingModal();
    console.error(error);
    const msg = error.shortMessage || error.message || 'Erro desconhecido';
    showAlert('❌ Erro no Resgate', msg, 'error');
  }
};


// ==================== SALVAR / ATUALIZAR APOSTA NO FIRESTORE (ACUMULA) ====================
async function saveBetToFirestore(marketId, option, amount, title, closeAt) {
  if (!currentGoogleUser?.uid) return;

  const betRef = doc(db, 'users', currentGoogleUser.uid, 'myBets', marketId.toString());

  try {
    const existingSnap = await getDoc(betRef);

    if (existingSnap.exists()) {
      const existing = existingSnap.data();
      await setDoc(betRef, {
        marketId: marketId.toString(),
        option: Number(option),
        amount: Number(existing.amount || 0) + Number(amount),   // ← ACUMULA
        title: title || existing.title,
        closeAt: Number(closeAt),
        timestamp: Date.now(),
        resolved: existing.resolved || false,
        redeemed: existing.redeemed || false
      });
    } else {
      await setDoc(betRef, {
        marketId: marketId.toString(),
        option: Number(option),
        amount: Number(amount),
        title: title,
        closeAt: Number(closeAt),
        timestamp: Date.now(),
        resolved: false,
        redeemed: false
      });
    }
  } catch (e) {
    console.error('Erro ao salvar aposta no Firestore:', e);
  }
}


// ==================== ATUALIZAR SALDO AO APOSTAR ====================
async function saveBetToBalanceFirebase(userId, walletAddress, amount) {
  if (!userId || !amount) return;
  
  try {
    const amountRaw = parseUnits(String(amount), 18);
    if (amountRaw <= 0n) return;

    const balanceRef = doc(db, 'users', userId, 'swap_balances', 'vwala');
    const balanceSnap = await getDoc(balanceRef);

    let current = 0n;
    if (balanceSnap.exists()) {
      const d = balanceSnap.data();
      current = d.balanceRaw ? BigInt(d.balanceRaw) : parseUnits(String(d.balanceFormatted || d.balance || '0'), 18);
    }

    if (current < amountRaw) return;

    const next = current - amountRaw;
    const formatted = formatUnits(next, 18);

    await setDoc(balanceRef, {
      balanceRaw: next.toString(),
      balanceFormatted: formatted,
      balance: Number(formatted),
      lastType: 'bet_placed',
      updatedAt: serverTimestamp()
    }, { merge: true });

    console.log(`✅ Débito aposta: -${amount} vWALA`);
  } catch (e) {
    console.error('Erro saveBetToBalanceFirebase:', e);
  }
}

// ==================== ATUALIZAR SALDO APÓS RESGATE ====================
async function saveRedeemToFirebase(userId, walletAddress, marketId, payoutAmount) {
  if (!userId || !payoutAmount) return;
  
  try {
    const amountRaw = parseUnits(String(payoutAmount), 18);
    if (amountRaw <= 0n) return;

    const balanceRef = doc(db, 'users', userId, 'swap_balances', 'vwala');
    const balanceSnap = await getDoc(balanceRef);

    let current = 0n;
    if (balanceSnap.exists()) {
      const d = balanceSnap.data();
      current = d.balanceRaw ? BigInt(d.balanceRaw) : parseUnits(String(d.balanceFormatted || d.balance || '0'), 18);
    }

    const next = current + amountRaw;
    const formatted = formatUnits(next, 18);

    await setDoc(balanceRef, {
      balanceRaw: next.toString(),
      balanceFormatted: formatted,
      balance: Number(formatted),
      lastType: 'redeem_win',
      updatedAt: serverTimestamp()
    }, { merge: true });

    console.log(`✅ Crédito resgate: +${payoutAmount} vWALA`);
  } catch (e) {
    console.error('Erro saveRedeemToFirebase:', e);
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

  // === TABS ===
  document.getElementById('tabSearch').addEventListener('click', () => switchTab('search'));
  document.getElementById('tabHistory').addEventListener('click', () => switchTab('history'));

  // Busca
  document.getElementById('searchBtn').addEventListener('click', loadMarket)
  document.getElementById('marketId').addEventListener('keypress', e => {
    if (e.key === 'Enter') loadMarket()
  })

  // Inicia na aba de busca
  switchTab('search')

  console.log('📄 Página Ver Aposta + Histórico v2.16 ✅')
}

boot()
