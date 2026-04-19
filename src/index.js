

import { auth } from './firebase'
import {
  browserLocalPersistence,
  onAuthStateChanged,
  setPersistence
} from 'firebase/auth'
import { Contract, JsonRpcProvider, formatUnits } from 'ethers'

const app = document.querySelector('#app')

if (!app) {
  throw new Error('Elemento #app não encontrado.')
}

const TOKEN_SYMBOL = 'vWALA'
const POLYGON_RPC_URL = new URL('/api/rpc', window.location.origin).toString()
const VWALA_TOKEN_ADDRESS = '0x7bD1f6f4F5CEf026b643758605737CB48b4B7D83'

let currentFirebaseUser = null

const ERC20_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)'
]

let balanceReadCounter = 0

function getWalletDebugSnapshot() {
  const currentUid = getCurrentSessionUid()

  let deviceWallet = null
  let profileWallet = null

  try {
    const rawDeviceWallet = localStorage.getItem('vwala_device_wallet')
    deviceWallet = rawDeviceWallet ? JSON.parse(rawDeviceWallet) : null
  } catch (error) {
    console.error('Erro ao ler vwala_device_wallet:', error)
  }

  try {
    const rawProfile = localStorage.getItem('vwala_wallet_profile')
    profileWallet = rawProfile ? JSON.parse(rawProfile) : null
  } catch (error) {
    console.error('Erro ao ler vwala_wallet_profile:', error)
  }

  const deviceUid = String(deviceWallet?.uid || '').trim()
  const profileUid = String(profileWallet?.uid || '').trim()

  const deviceWalletAddress = String(
    deviceWallet?.walletAddress ||
    deviceWallet?.address ||
    deviceWallet?.wallet_address ||
    ''
  ).trim()

  const profileWalletAddress = String(
    profileWallet?.walletAddress ||
    profileWallet?.address ||
    profileWallet?.wallet_address ||
    ''
  ).trim()

  let resolvedSource = 'none'
  let resolvedWalletAddress = ''

  if (
    deviceWalletAddress &&
    (!currentUid || !deviceUid || deviceUid === currentUid)
  ) {
    resolvedSource = 'vwala_device_wallet'
    resolvedWalletAddress = deviceWalletAddress
  } else if (
    profileWalletAddress &&
    (!currentUid || !profileUid || profileUid === currentUid)
  ) {
    resolvedSource = 'vwala_wallet_profile'
    resolvedWalletAddress = profileWalletAddress
  }

  return {
    currentUid,
    deviceUid,
    deviceWalletAddress,
    profileUid,
    profileWalletAddress,
    resolvedSource,
    resolvedWalletAddress
  }
}

function createRpcProbeUrl(label) {
  const url = new URL(POLYGON_RPC_URL, window.location.origin)
  url.searchParams.set('_ts', String(Date.now()))
  url.searchParams.set('_probe', label)
  return url.toString()
}

function compareRawBalanceAsc(a, b) {
  const aValue = BigInt(String(a || '0'))
  const bValue = BigInt(String(b || '0'))

  if (aValue === bValue) return 0
  return aValue < bValue ? -1 : 1
}

async function readSingleBalanceProbe(walletAddress, label) {
  const rpcUrl = createRpcProbeUrl(label)
  const provider = new JsonRpcProvider(rpcUrl)
  const tokenContract = new Contract(VWALA_TOKEN_ADDRESS, ERC20_ABI, provider)

  const [blockNumber, rawBalance, decimals] = await Promise.all([
    provider.getBlockNumber(),
    tokenContract.balanceOf(walletAddress),
    tokenContract.decimals()
  ])

  return {
    source: label,
    walletAddress,
    blockNumber: Number(blockNumber),
    rawBalance: rawBalance.toString(),
    decimals: Number(decimals),
    formattedBalance: Number(formatUnits(rawBalance, decimals)),
    rpcUrl
  }
}

function selectStableBalanceProbe(probes = []) {
  const groupedMap = new Map()

  probes.forEach((probe) => {
    const key = String(probe.rawBalance || '0')

    if (!groupedMap.has(key)) {
      groupedMap.set(key, {
        rawBalance: key,
        count: 0,
        maxBlock: 0,
        probes: []
      })
    }

    const group = groupedMap.get(key)
    group.count += 1
    group.maxBlock = Math.max(group.maxBlock, Number(probe.blockNumber || 0))
    group.probes.push(probe)
  })

  const groups = [...groupedMap.values()].sort((a, b) => {
    const balanceCompare = compareRawBalanceAsc(a.rawBalance, b.rawBalance)
    if (balanceCompare !== 0) {
      return balanceCompare
    }

    if (b.count !== a.count) {
      return b.count - a.count
    }

    return b.maxBlock - a.maxBlock
  })

  const selectedGroup = groups[0]
  const selectedProbe = [...selectedGroup.probes].sort((a, b) => {
    const blockDiff = Number(b.blockNumber || 0) - Number(a.blockNumber || 0)

    if (blockDiff !== 0) {
      return blockDiff
    }

    return String(a.source || '').localeCompare(String(b.source || ''))
  })[0]

  const selectionReason = groups.length === 1
    ? 'unanimous'
    : 'lowest_balance_wins'

  return {
    selectedProbe,
    selectionReason,
    groups
  }
}

async function readBalanceViaEthers(walletAddress, label) {
  const settled = await Promise.allSettled([
    readSingleBalanceProbe(walletAddress, `${label}_a`),
    readSingleBalanceProbe(walletAddress, `${label}_b`),
    readSingleBalanceProbe(walletAddress, `${label}_c`)
  ])

  const probes = settled
    .filter((item) => item.status === 'fulfilled')
    .map((item) => item.value)

  const failures = settled
    .filter((item) => item.status === 'rejected')
    .map((item) => item.reason)

  if (!probes.length) {
    throw failures[0] || new Error('Nenhuma leitura de saldo foi concluída.')
  }

  const { selectedProbe, selectionReason, groups } = selectStableBalanceProbe(probes)

  console.groupCollapsed(`[VWALA_RPC_PROBES] ${label}`)
  console.log('all_probes', probes)
  console.log('grouped_probes', groups)
  console.log('selected_probe', selectedProbe)
  console.log('selection_reason', selectionReason)

  if (failures.length) {
    console.warn('probe_failures', failures)
  }

  console.groupEnd()

  return {
    ...selectedProbe,
    selectedFrom: selectedProbe.source,
    selectionReason,
    allProbes: probes,
    failedProbeCount: failures.length
  }
}

function getCurrentSessionUid() {
  const runtimeUid = String(currentFirebaseUser?.uid || '').trim()

  if (runtimeUid) {
    return runtimeUid
  }

  try {
    const rawUser = localStorage.getItem('vwala_user')
    if (!rawUser) return ''
    return String(JSON.parse(rawUser)?.uid || '').trim()
  } catch (error) {
    console.error('Erro ao ler sessão local:', error)
    return ''
  }
}

function readWalletProfile() {
  try {
    const currentUid = getCurrentSessionUid()

    const rawDeviceWallet = localStorage.getItem('vwala_device_wallet')
    if (rawDeviceWallet) {
      const parsedDeviceWallet = JSON.parse(rawDeviceWallet)
      const deviceUid = String(parsedDeviceWallet?.uid || '').trim()

      if (
        parsedDeviceWallet?.walletAddress &&
        (!currentUid || !deviceUid || deviceUid === currentUid)
      ) {
        return parsedDeviceWallet
      }
    }

    const rawProfile = localStorage.getItem('vwala_wallet_profile')
    if (rawProfile) {
      const parsedProfile = JSON.parse(rawProfile)
      const profileUid = String(parsedProfile?.uid || '').trim()

      if (
        parsedProfile?.walletAddress &&
        (!currentUid || !profileUid || profileUid === currentUid)
      ) {
        return parsedProfile
      }
    }

    return null
  } catch (error) {
    console.error('Erro ao ler carteira local:', error)
    return null
  }
}

function getCurrentWalletAddress() {
  const wallet = readWalletProfile()

  return String(
    wallet?.walletAddress ||
    wallet?.address ||
    wallet?.wallet_address ||
    ''
  ).trim()
}

function formatTokenBalance(value = 0) {
  const num = Number(value || 0)

  if (!Number.isFinite(num)) {
    return `0,00 ${TOKEN_SYMBOL}`
  }

  return `${num.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4
  })} ${TOKEN_SYMBOL}`
}

function setConnectButtonText(text) {
  const connectBtn = document.getElementById('connectBtn')
  if (connectBtn) connectBtn.textContent = text
}

async function loadUserTokenBalance() {
  const readId = ++balanceReadCounter
  const groupLabel = `[VWALA_BALANCE_READ_${readId}]`

  console.groupCollapsed(groupLabel)

  try {
    const walletAddress = getCurrentWalletAddress()
    const walletDebug = getWalletDebugSnapshot()

    console.log('wallet_resolution', walletDebug)

    if (!walletAddress) {
      setConnectButtonText('Sem carteira')
      console.warn('Nenhuma carteira ativa resolvida.')
      return
    }

    setConnectButtonText('Carregando saldo...')

    const selectedRead = await readBalanceViaEthers(walletAddress, `vwala_balance_main_${readId}`)

    setConnectButtonText(formatTokenBalance(selectedRead.formattedBalance))
    console.log('selected_balance_read', selectedRead)
  } catch (error) {
    console.error(`Erro ao carregar saldo ${TOKEN_SYMBOL}:`, error)
    setConnectButtonText(`0,00 ${TOKEN_SYMBOL}`)
  } finally {
    console.groupEnd()
  }
}

app.innerHTML = `
  <div id="sidebarOverlay" class="overlay"></div>


  <div class="page-shell">
    <div class="app-frame">
      <header class="topbar">
        <button class="menu-btn" id="menuBtn" type="button" aria-label="Abrir menu">
          <span></span>
          <span></span>
          <span></span>
        </button>

        <div class="brand-wrap">
          <div class="brand-badge">W</div>
          <div class="brand-text">
            <strong>Wala-v2</strong>
            <span>Mercado</span>
          </div>
        </div>

        <button id="connectBtn" class="connect" type="button">
  Carregando saldo...
</button>
      </header>



      <aside id="sidebar" class="side-menu">
       <a href="/carteira">Carteira</a>
        <a href="/token">Criar Token</a>
        <a href="/apostas">Futebol</a>
        <a href="/predicoes.html">Predições</a>
        <a href="/posicoes">H/Futebol</a>
        <a href="/historico">H/Futures</a>
      </aside>

      <main class="app-content">
        <section class="hero-card">
          <div class="hero-copy">
            <p class="eyebrow">VWALA · POLYGON</p>
            <h1>vWALA Platform</h1>
            <p class="hero-text">
              Plataforma de previsões, swap interno, stake e liquidez em Polygon.
            </p>
          </div>

          <div class="hero-stats">
            <div class="stat-box">
              <span>Mercado</span>
              <strong>Futebol e Predições</strong>
            </div>

            <div class="stat-box">
              <span>Status</span>
              <strong>Em construção</strong>
            </div>

            <div class="stat-box">
              <span>Rede</span>
              <strong>Polygon</strong>
            </div>
          </div>
        </section>

        <section class="section-head">
          <div>
            <p class="section-kicker">DESTAQUES</p>
            <h2>Acessos principais</h2>
          </div>
        </section>

        <section class="cards-list">
          <article
            class="feature-card clickable-card"
            data-href="/apostas.html"
            role="button"
            tabindex="0"
            aria-label="Abrir página Futebol"
          >
            <div class="feature-card-top">
              <span class="feature-badge">⚽</span>
              <span class="feature-chip">Em destaque</span>
            </div>

            <h3>Futebol</h3>
            <p>
              Jogos, probabilidades e abertura de posições no mercado esportivo.
            </p>

            <div class="feature-card-footer">
              <span>Abrir</span>
              <strong style="display: none;">futebol</strong>
            </div>
          </article>

          <article
            class="feature-card clickable-card"
            data-href="/predicoes.html"
            role="button"
            tabindex="0"
            aria-label="Abrir página Predições"
          >
            <div class="feature-card-top">
              <span class="feature-badge">📈</span>
              <span class="feature-chip">Novo</span>
            </div>

            <h3>Predições</h3>
            <p>
              Área de mercado binário para cripto com posições de sim ou não.
            </p>

            <div class="feature-card-footer">
              <span>Abrir</span>
              <strong style="display: none;">predicoes.html</strong>
            </div>
          </article>

          <article
            class="feature-card clickable-card"
            data-href="/token.html"
            role="button"
            tabindex="0"
            aria-label="Abrir página Criar Token"
          >
            <div class="feature-card-top">
              <span class="feature-badge">🧾</span>
              <span class="feature-chip">Token</span>
            </div>

            <h3>Criar Token</h3>
            <p>
              Crie seu token com imagem, nome, símbolo e metadata ligada ao ecossistema WALA.
            </p>

            <div class="feature-card-footer">
              <span>Abrir</span>
              <strong style="display: none;">token.html</strong>
            </div>
          </article>
        </section>

        <section class="section-head">
          <div>
            <p class="section-kicker">ATALHOS</p>
            <h2>Outras páginas</h2>
          </div>
        </section>

        <section class="shortcut-grid">
          <a class="shortcut-card" href="/apostas.html">
            <span class="shortcut-icon">⚽</span>
            <strong>Futebol</strong>
            <small>Mercado esportivo</small>
          </a>

          <a class="shortcut-card" href="/predicoes.html">
            <span class="shortcut-icon">📈</span>
            <strong>Predições</strong>
            <small>Mercado binário cripto</small>
          </a>

         <a class="shortcut-card" href="/token.html">
          <span class="shortcut-icon">🧾</span>
          <strong>Criar Token</strong>
          <small>Crie seu token</small>
        </a>



          <a class="shortcut-card" href="/carteira.html">
            <span class="shortcut-icon">👛</span>
            <strong>Carteira</strong>
            <small>Saldo e ações internas</small>
          </a>
        </section>
      </main>
    </div>
  </div>
`

const sidebar = document.getElementById('sidebar')

const sidebarOverlay = document.getElementById('sidebarOverlay')

const menuBtn = document.getElementById('menuBtn')
const connectBtn = document.getElementById('connectBtn')

const clickableCards = document.querySelectorAll('.clickable-card')

function goTo(path) {
  if (!path) return
  window.location.href = path
}

function openSidebar() {
  sidebar.style.right = '0'
  sidebarOverlay.classList.add('active')
}

function closeSidebar() {
  sidebar.style.right = '-280px'
  sidebarOverlay.classList.remove('active')
}



async function initFirebaseSession() {
  try {
    await setPersistence(auth, browserLocalPersistence)

    await new Promise((resolve) => {
      let finished = false

      const unsubscribe = onAuthStateChanged(auth, (user) => {
        currentFirebaseUser = user || null

        if (user) {
          localStorage.setItem(
            'vwala_user',
            JSON.stringify({
              uid: user.uid,
              name: user.displayName || '',
              email: user.email || '',
              photo: user.photoURL || ''
            })
          )
        } else {
          localStorage.removeItem('vwala_user')
        }

        if (!finished) {
          finished = true
          unsubscribe()
          resolve()
        }
      })
    })
  } catch (error) {
    console.error('Erro ao iniciar sessão Firebase:', error)
  }
}



menuBtn?.addEventListener('click', openSidebar)
sidebarOverlay?.addEventListener('click', closeSidebar)


// saldo somente leitura



clickableCards.forEach((card) => {
  const target = card.getAttribute('data-href')

  card.addEventListener('click', () => {
    goTo(target)
  })

  card.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      goTo(target)
    }
  })
})

document.querySelectorAll('#sidebar a').forEach((link) => {
  link.addEventListener('click', () => {
    closeSidebar()
  })
})



async function initApp() {

  await initFirebaseSession()
  await loadUserTokenBalance()
}

initApp()