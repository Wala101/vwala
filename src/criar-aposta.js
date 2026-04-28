// src/criar-aposta.js
import { auth } from './firebase'
import { onAuthStateChanged } from 'firebase/auth'
import { ethers } from 'ethers'

const CONTRACT_ADDRESS = '0x25F9007ef8E62796C1ed0259B6266d097577e133'

const ABI = [
  'function createMarket(string title, string optionA, string optionB, uint256 closeAt, uint16 feeBps, uint16 probA, uint16 probB) external returns (uint256)',
  'function getMarket(uint256 marketId) external view returns (tuple(bool exists, address creator, uint256 closeAt, uint16 feeBps, uint16 probA, uint16 probB, uint256 poolA, uint256 poolB, uint256 totalPool, bool resolved, uint8 winningOption, uint256 resolvedAt))'
]

let signer = null

async function connectWallet() {
  const provider = new ethers.BrowserProvider(window.ethereum)
  await provider.send("eth_requestAccounts", [])
  signer = await provider.getSigner()
  return signer
}

function showStatus(msg, type = 'info') {
  const el = document.getElementById('status')
  if (el) {
    el.textContent = msg
    el.className = `status ${type}`
  }
}

async function createMarket() {
  const title = document.getElementById('title').value.trim()
  const optionA = document.getElementById('optionA').value.trim()
  const optionB = document.getElementById('optionB').value.trim()
  const closeAtStr = document.getElementById('closeAt').value
  const probA = parseInt(document.getElementById('probA').value)
  const probB = parseInt(document.getElementById('probB').value)

  if (!title || !optionA || !optionB || !closeAtStr) {
    showStatus("Preencha todos os campos!", "error")
    return
  }
  if (probA + probB !== 100) {
    showStatus("As probabilidades devem somar 100%", "error")
    return
  }

  const closeAt = Math.floor(new Date(closeAtStr).getTime() / 1000)
  const btn = document.getElementById('createBtn')
  btn.disabled = true
  btn.textContent = "Criando..."

  try {
    if (!signer) await connectWallet()

    const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer)

    const tx = await contract.createMarket(
      title,
      optionA,
      optionB,
      closeAt,
      300,        // 3% fee
      probA * 100,
      probB * 100
    )

    showStatus("Aguardando confirmação na blockchain...", "info")
    await tx.wait()

    showStatus("✅ Aposta criada com sucesso! ID gerado.", "success")

    // Limpa formulário
    document.getElementById('title').value = ''
    document.getElementById('optionA').value = ''
    document.getElementById('optionB').value = ''

  } catch (err) {
    console.error(err)
    showStatus("Erro: " + (err.shortMessage || err.message), "error")
  } finally {
    btn.disabled = false
    btn.textContent = "Criar Aposta"
  }
}

function render() {
  document.getElementById('app').innerHTML = `
    <div class="create-page">
      <div class="create-header">
        <h1>🎲 Criar Nova Aposta</h1>
        <p>Só você pode resolver sua aposta</p>
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
  render()
})