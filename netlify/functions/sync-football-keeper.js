// netlify/functions/sync-football-keeper.js
export const schedule = "@every 60 minutes"

export default async function handler() {
  console.log("🚀 [KEEPER] Iniciando sync de futebol...")

  try {
    const baseUrl = process.env.URL || "https://www.vwala.com.br"
    const syncUrl = `${baseUrl}/.netlify/functions/sync-football`

    console.log(`📡 Chamando sync: ${syncUrl}`)

    // Timeout maior (55 segundos)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 55000)

    const response = await fetch(syncUrl, {
      method: 'GET',
      headers: { 
        'Content-Type': 'application/json',
        'User-Agent': 'Wala-Keeper'
      },
      signal: controller.signal
    })

    clearTimeout(timeout)

    if (!response.ok) {
      throw new Error(`Sync falhou com status: ${response.status}`)
    }

    const result = await response.json()

    console.log(`✅ [KEEPER] Sucesso! Jogos sincronizados: ${result.syncedMatches || 0}`)

    return new Response(JSON.stringify({
      success: true,
      syncedMatches: result.syncedMatches || 0,
      message: "Keeper executado com sucesso"
    }), { 
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error("❌ [KEEPER] Falha:", error.message)
    
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), { status: 500 })
  }
}