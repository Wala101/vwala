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

const CONTRACT_ADDRESS = '0xb6b57B6146e535d2D850B0Ea086D29EdBacB5A0C'
const VWALA_TOKEN = '0x7bD1f6f4F5CEf026b643758605737CB48b4B7D83'
const TOKEN_SYMBOL = 'vWALA'

// ==================== ABI ====================
const USER_PREDICTIONS_ABI = [
  'function createMarket(string title, string optionA, string optionB, uint256 closeAt, uint16 feeBps, uint16 probA, uint16 probB) external returns (uint256)',
  'function resolveMarket(uint256 marketId, uint8 winningOption) external',
  'function getMarket(uint256 marketId) view returns (tuple(bool exists,address creator,uint256 closeAt,uint16 feeBps,uint16 probA,uint16 probB,uint256 poolA,uint256 poolB,uint256 totalPool,bool resolved,uint8 winningOption,uint256 resolvedAt))',
  'event MarketCreated(uint256 indexed marketId, address indexed creator)',
  'event MarketResolved(uint256 indexed marketId, uint8 winningOption)'
]

let currentGoogleUser = null
const state = { provider: null, signer: null, userAddress: '' }

// ==================== MODAIS (SEGURAS - não sobrescrevem) ====================
if (typeof window.showAlert !== 'function') {
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
}

if (typeof window.showLoadingModal !== 'function') {
  window.showLoadingModal = (title = 'Processando', message = 'Enviando transação...') => {
    const existing = document.getElementById('loading-modal')
    if (existing) return
    const modal = document.createElement('div')
    modal.id = 'loading-modal'
    modal.className = 'modal-overlay loading'
    modal.innerHTML = `<div class="modal-content"><div class="premium-spinner"></div><h2>${title}</h2><p>${message}</p></div>`
    document.body.appendChild(modal)
    modal.style.display = 'flex'
  }
}

if (typeof window.hideLoadingModal !== 'function') {
  window.hideLoadingModal = () => {
    const modal = document.getElementById('loading-modal')
    if (modal) modal.remove()
  }
}

window.showPinModal = (title = 'Confirmar PIN', message = 'Digite seu PIN') => {
  return new Promise(resolve => {
    const existing = document.getElementById('pin-modal')
    if (existing) existing.remove()

    const modal = document.createElement('div')
    modal.id = 'pin-modal'
    modal.className = 'modal-overlay'
    modal.innerHTML = `
      <div class="modal-content pin-modal">
        <div class="modal-icon">🔑</div>
        <h2>${title}</h2>
        <input type="password" id="pin-input" class="input" maxlength="6" placeholder="Digite seu PIN">
        <div class="pin-buttons">
          <button class="modal-btn cancel-btn" id="cancel-pin">Cancelar</button>
          <button class="modal-btn confirm-btn" id="confirm-pin">Confirmar</button>
        </div>
      </div>
    `
    document.body.appendChild(modal)
    modal.style.display = 'flex'

    setTimeout(() => document.getElementById('pin-input').focus(), 100)

    document.getElementById('cancel-pin').onclick = () => { modal.remove(); resolve(null) }
    document.getElementById('confirm-pin').onclick = () => {
      const pin = document.getElementById('pin-input').value.trim()
      modal.remove()
      resolve(pin)
    }
  })
}

// ==================== CARTEIRA E FUNÇÕES (mantidas) ====================
async function syncWalletProfileFromFirebase() { /* seu código original */ }
async function initFirebaseSession() { /* seu código original */ }
async function getInternalWalletSigner() { /* seu código original */ }
async function loadUserTokenBalance() { /* seu código original */ }
async function loadMyMarkets() { /* seu código original */ }
async function createMarket() { /* seu código original */ }
async function resolveUserMarket(marketId, title) { /* seu código original */ }

window.resolveUserMarket = resolveUserMarket;
window.createMarket = createMarket;

// ==================== RENDER + BOOT ====================
function renderPage() { /* seu código original */ }

async function boot() {
  await initFirebaseSession();
  state.provider = new JsonRpcProvider(POLYGON_RPC_PRIMARY_URL, POLYGON_CHAIN_ID);
  renderPage();

  const balance = await loadUserTokenBalance();
  const connectBtn = document.getElementById('connectBtn');
  if (connectBtn) connectBtn.textContent = `${balance} ${TOKEN_SYMBOL}`;

  setTimeout(async () => await loadMyMarkets(), 800);
}

boot();

console.log("📄 Página Criar Aposta v2.2 - Limpa e Segura ✅");