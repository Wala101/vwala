// netlify/functions/sync-football-keeper.js
export const schedule = "@every 45 minutes"

export default async function handler() {
  console.log("🚀 [KEEPER] Iniciando sync automático de futebol...")

  try {
    const baseUrl = process.env.URL || "https://www.vwala.com.br"
    const syncUrl = `${baseUrl}/.netlify/functions/sync-football`

    console.log(`📡 Chamando sync: ${syncUrl}`)

    const response = await fetch(syncUrl, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    })

    if (!response.ok) {
      throw new Error(`Sync falhou com status: ${response.status}`)
    }

    const result = await response.json()

    console.log(`✅ [KEEPER] Sync concluído! Total jogos: ${result.syncedMatches || 0}`)

    return new Response(JSON.stringify({
      success: true,
      syncedMatches: result.syncedMatches || 0,
      message: "Keeper executado com sucesso"
    }), { 
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error("❌ [KEEPER] Erro:", error.message)
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), { status: 500 })
  }
}