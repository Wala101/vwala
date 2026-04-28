// src/criar-aposta.js
import './style/style.css'
import { auth, db } from './firebase'
import {
  browserLocalPersistence,
  onAuthStateChanged,
  setPersistence
} from 'firebase/auth'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { JsonRpcProvider, Wallet, Contract, ethers } from 'ethers'

const CONTRACT_ADDRESS = '0x25F9007ef8E62796C1ed0259B6266d097577e133' // Novo contrato

const USER_PREDICTIONS_ABI = [
  'function createMarket(string title, string optionA, string optionB, uint256 closeAt, uint16 feeBps, uint16 probA, uint16 probB) external returns (uint256)',
  'function getMarket(uint256 marketId) external view returns (tuple(bool exists, address creator, uint256 closeAt, uint16 feeBps, uint16 probA, uint16 probB, uint256 poolA, uint256 poolB, uint256 totalPool, bool resolved, uint8 winningOption, uint256 resolvedAt))'
]

const TOKEN_SYMBOL = 'vWALA'
const VWALA_TOKEN = '0x7bD1f6f4F5CEf026b643758605737CB48b4B7D83'

let currentGoogleUser = null
let signer = null
let provider = null

// ==================== REUSANDO SUAS FUNÇÕES ====================
function showAlert(title, message) {
  // Você já tem essa função no seu app global, vou chamar ela se existir
  if (typeof window.showAlert === 'function') {
    window.showAlert(title, message)
  } else {
    alert(title + "\n\n" + message)
  }
}

function showLoadingModal(title = 'Processando', text = 'Aguarde...') {
  if (typeof window.showLoadingModal === 'function') window.showLoadingModal(title, text)
}

function hideLoadingModal() {
  if (typeof window.hideLoadingModal === 'function') window.hideLoadingModal()
}

async function getInternalWalletSigner() {
  // Reusa sua função global de PIN + device wallet
  if (typeof window.getInternalWalletSigner === 'function') {
    return await window.getInternalWalletSigner()
  }
  showAlert('Erro', 'Função de carteira não encontrada.')
  return null
}

// ==================== CRIAR APOSTA ====================
async function createMarket() {
  const title = document.getElementById('title').value.trim()
  const optionA = document.getElementById('optionA').value.trim()
  const optionB = document.getElementById('optionB').value.trim()
  const closeAtStr = document.getElementById('closeAt').value
  const probA = parseInt(document.getElementById('probA').value)
  const probB = parseInt(document.getElementById('probB').value)

  if (!title || !optionA || !optionB || !closeAtStr) {
    showAlert('Erro', 'Preencha todos os campos!')
    return
  }
  if (probA + probB !== 100) {
    showAlert('Erro', 'As probabilidades devem somar 100%')
    return
  }

  const closeAt = Math.floor(new Date(closeAtStr).getTime() / 1000)
  const btn = document.getElementById('createBtn')
  btn.disabled = true
  btn.textContent = "Criando..."

  try {
    const internalSigner = await getInternalWalletSigner()
    if (!internalSigner) return

    const contract = new Contract(CONTRACT_ADDRESS, USER_PREDICTIONS_ABI, internalSigner)

    showLoadingModal('Criando Aposta', 'Enviando transação para Polygon...')

    const tx = await contract.createMarket(
      title,
      optionA,
      optionB,
      closeAt,
      300,           // 3% fee
      probA * 100,
      probB * 100
    )

    await tx.wait()

    hideLoadingModal()
    showAlert('Sucesso!', `Aposta criada com sucesso!\n\nID: ${tx.hash}`)

    // Limpa formulário
    document.getElementById('title').value = ''
    document.getElementById('optionA').value = ''
    document.getElementById('optionB').value = ''

  } catch (error) {
    hideLoadingModal()
    console.error(error)
    showAlert('Erro', error.shortMessage || error.message)
  } finally {
    btn.disabled = false
    btn.textContent = "Criar Aposta"
  }
}

// ==================== RENDER ====================
function renderPage() {
  document.getElementById('app').innerHTML = `
    <div class="create-page">
      <div class="create-header">
        <h1>🎲 Criar Nova Aposta</h1>
        <p>Só o criador pode resolver</p>
      </div>

      <div class="form-card">
        <input type="text" id="title" class="input" placeholder="Título da Aposta" />

        <div class="options-grid">
          <input type="text" id="optionA" class="input" placeholder="Opção A" />
          <input type="text" id="optionB" class="input" placeholder="Opção B" />
        </div>

        <input type="datetime-local" id="closeAt" class="input" />

        <div class="prob-row">
          <div>
            <label>Prob. A (%)</label>
            <input type="number" id="probA" value="50" min="1" max="99" class="input" />
          </div>
          <div>
            <label>Prob. B (%)</label>
            <input type="number" id="probB" value="50" min="1" max="99" class="input" />
          </div>
        </div>

        <button id="createBtn" class="launch-btn">Criar Aposta</button>
      </div>

      <div id="status" class="status"></div>
    </div>
  `

  document.getElementById('createBtn').addEventListener('click', createMarket)
}

// Init
onAuthStateChanged(auth, (user) => {
  currentGoogleUser = user
  renderPage()
})

console.log("📄 Página Criar Aposta carregada - usando carteira interna")