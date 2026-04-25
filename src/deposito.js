import { auth } from './firebase.js'
import { onAuthStateChanged } from 'firebase/auth'

let currentWalletAddress = ''

async function gerarPix() {
  if (!currentWalletAddress) {
    alert("Carteira não encontrada")
    return
  }

  const amount = prompt("Digite o valor em R$ (ex: 50.00)", "100")

  if (!amount) return

  try {
    const res = await fetch('https://api.openpix.com.br/api/v1/charge', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer SEU_APP_ID_AQUI',   // ← Sua chave OpenPix
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        correlationID: `vwala_${Date.now()}`,
        value: Number(amount) * 100,           // centavos
        comment: `Depósito vWALA - ${currentWalletAddress}`,
        customer: {
          name: "Usuário vWALA",
          taxID: "00000000000"
        }
      })
    })

    const data = await res.json()

    if (data.charge) {
      mostrarQrCode(data.charge)
    }
  } catch (err) {
    alert("Erro ao gerar PIX")
    console.error(err)
  }
}

function mostrarQrCode(charge) {
  const container = document.getElementById('pix-container')
  container.innerHTML = `
    <h3>PIX Gerado - R$ ${(charge.value/100).toFixed(2)}</h3>
    <img src="${charge.qrCode}" width="280" style="margin:15px 0; border-radius:12px;">
    <input value="${charge.pixKey}" readonly style="width:100%; padding:12px; text-align:center;">
    <button onclick="navigator.clipboard.writeText('${charge.pixKey}'); alert('Copiado!')">Copiar PIX</button>
  `
}

// Render básico...
// ... (resto do código)

window.gerarPix = gerarPix