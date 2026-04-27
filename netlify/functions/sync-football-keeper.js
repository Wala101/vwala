// netlify/functions/sync-football-keeper.js
export const schedule = "@every 45 minutes"   // roda a cada 45 minutos

export default async function handler() {
  console.log("🚀 [KEEPER] Iniciando sync automático de futebol...")

  const startTime = Date.now()

  try {
    // Altere "football-sync" se o nome da sua function de sync for diferente
    const syncUrl = `${process.env.URL || 'http://localhost:8888'}/.netlify/functions/football-sync`

    const response = await fetch(syncUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Wala-Football-Keeper'
      }
    })

    if (!response.ok) {
      throw new Error(`Sync falhou com status: ${response.status}`)
    }

    const result = await response.json()

    const duration = Date.now() - startTime

    console.log(`✅ [KEEPER] Sync concluído com sucesso!`, {
      syncedMatches: result.syncedMatches || 0,
      duration: `${duration}ms`,
      timestamp: new Date().toISOString()
    })

    return new Response(JSON.stringify({
      success: true,
      message: "Sync de futebol executado pelo Keeper",
      syncedMatches: result.syncedMatches || 0,
      duration: `${duration}ms`,
      executedAt: new Date().toISOString()
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error("❌ [KEEPER] Erro ao executar sync:", error.message)

    return new Response(JSON.stringify({
      success: false,
      error: error.message,
      executedAt: new Date().toISOString()
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}