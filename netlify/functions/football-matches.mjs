export default async (req, context) => {
  const jsonHeaders = {
    'content-type': 'application/json',
    'cache-control': 'public, max-age=180, s-maxage=180'
  }

  try {
    const token = process.env.FOOTBALL_DATA_TOKEN

    if (!token) {
      return new Response(
        JSON.stringify({ error: 'FOOTBALL_DATA_TOKEN não configurado.' }),
        { status: 500, headers: jsonHeaders }
      )
    }

    function formatDateYMD(date) {
      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      return `${year}-${month}-${day}`
    }

    const now = new Date()
    const dateFrom = formatDateYMD(now)

    const limitDate = new Date(now)
    limitDate.setDate(limitDate.getDate() + 2)
    const dateTo = formatDateYMD(limitDate)

    const response = await fetch(
      `https://api.football-data.org/v4/competitions/BSA/matches?status=SCHEDULED,TIMED&dateFrom=${dateFrom}&dateTo=${dateTo}`,
      {
        headers: {
          'X-Auth-Token': token
        }
      }
    )

    if (!response.ok) {
      const text = await response.text()

      return new Response(
        JSON.stringify({
          error: 'Falha ao buscar jogos.',
          details: text
        }),
        { status: 500, headers: jsonHeaders }
      )
    }

    const data = await response.json()

    const matches = Array.isArray(data.matches)
      ? data.matches
          .filter((match) =>
            ['SCHEDULED', 'TIMED'].includes(match?.status) &&
            match?.homeTeam?.name &&
            match?.awayTeam?.name &&
            match?.utcDate
          )
          .sort((a, b) => new Date(a.utcDate).getTime() - new Date(b.utcDate).getTime())
          .slice(0, 10)
          .map((match) => {
            const homeProbBps = 4000
            const drawProbBps = 3000
            const awayProbBps = 3000

            return {
              fixtureId: Number(match.id),
              league: match.competition?.name || 'Campeonato Brasileiro Série A',
              teamA: match.homeTeam?.name || 'Time A',
              teamB: match.awayTeam?.name || 'Time B',
              time: new Date(match.utcDate).toLocaleString('pt-BR', {
                dateStyle: 'short',
                timeStyle: 'short'
              }),
              utcDate: match.utcDate,
              status: match.status,
              homeProbBps,
              drawProbBps,
              awayProbBps
            }
          })
      : []

    return new Response(
      JSON.stringify({ matches }),
      { status: 200, headers: jsonHeaders }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message || 'Erro interno.' }),
      { status: 500, headers: jsonHeaders }
    )
  }
}