export default async (req, context) => {
  try {
    const token = process.env.FOOTBALL_DATA_TOKEN

    if (!token) {
      return new Response(
        JSON.stringify({ error: 'FOOTBALL_DATA_TOKEN não configurado.' }),
        { status: 500, headers: { 'content-type': 'application/json' } }
      )
    }

    const response = await fetch('https://api.football-data.org/v4/matches?status=SCHEDULED', {
      headers: {
        'X-Auth-Token': token
      }
    })

    if (!response.ok) {
      const text = await response.text()
      return new Response(
        JSON.stringify({ error: 'Falha ao buscar jogos.', details: text }),
        { status: 500, headers: { 'content-type': 'application/json' } }
      )
    }

    const data = await response.json()
    const matches = Array.isArray(data.matches) ? data.matches.slice(0, 24).map((match) => {
      const homeProbBps = 4000
      const drawProbBps = 3000
      const awayProbBps = 3000

      return {
        fixtureId: Number(match.id),
        league: match.competition?.name || 'Futebol',
        teamA: match.homeTeam?.name || 'Time A',
        teamB: match.awayTeam?.name || 'Time B',
        time: match.utcDate
          ? new Date(match.utcDate).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
          : 'Em breve',
        homeProbBps,
        drawProbBps,
        awayProbBps
      }
    }) : []

    return new Response(
      JSON.stringify({ matches }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message || 'Erro interno.' }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    )
  }
}