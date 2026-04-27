const COMPETITIONS = [
  {
    code: 'BSA',
    fallbackName: 'Campeonato Brasileiro Série A',
    maxMatches: 10
  },
  {
    code: 'PL',
    fallbackName: 'Premier League',
    maxMatches: 10
  },
  {
    code: 'CL',
    fallbackName: 'UEFA Champions League',
    maxMatches: 10
  },
  {
    code: 'PD',
    fallbackName: 'La Liga',
    maxMatches: 10
  },
  {
    code: 'SA',
    fallbackName: 'Serie A',
    maxMatches: 10
  },
  {
    code: 'BL1',
    fallbackName: 'Bundesliga',
    maxMatches: 10
  },
  {
    code: 'FL1',
    fallbackName: 'Ligue 1',
    maxMatches: 10
  },
  {
    code: 'CLI',
    fallbackName: 'Copa Libertadores',
    maxMatches: 10
  },
  {
    code: 'CSA',
    fallbackName: 'Copa Sul-Americana',
    maxMatches: 10
  }
]

function formatDateYMD(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

async function footballDataGetJson(url, token) {
  const response = await fetch(url, {
    headers: {
      'X-Auth-Token': token
    }
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || `football-data ${response.status}`)
  }

  return response.json()
}

function sortByUtcDateAsc(list = []) {
  return [...list].sort(
    (a, b) => new Date(a?.utcDate || 0).getTime() - new Date(b?.utcDate || 0).getTime()
  )
}

function sortByUtcDateDesc(list = []) {
  return [...list].sort(
    (a, b) => new Date(b?.utcDate || 0).getTime() - new Date(a?.utcDate || 0).getTime()
  )
}

function getTeamGoalsFromMatch(match, teamId) {
  const homeId = Number(match?.homeTeam?.id || 0)
  const awayId = Number(match?.awayTeam?.id || 0)

  const homeGoals = Number(
    match?.score?.fullTime?.home ??
    match?.score?.fullTime?.homeTeam ??
    0
  )

  const awayGoals = Number(
    match?.score?.fullTime?.away ??
    match?.score?.fullTime?.awayTeam ??
    0
  )

  if (teamId === homeId) {
    return {
      goalsFor: homeGoals,
      goalsAgainst: awayGoals
    }
  }

  if (teamId === awayId) {
    return {
      goalsFor: awayGoals,
      goalsAgainst: homeGoals
    }
  }

  return {
    goalsFor: 0,
    goalsAgainst: 0
  }
}

function getRecentFormScore(matches = [], teamId) {
  const recentMatches = sortByUtcDateDesc(matches).slice(0, 3)

  let points = 0
  let goalDiff = 0
  let goalsFor = 0
  let wins = 0
  let draws = 0
  let losses = 0

  for (const match of recentMatches) {
    const { goalsFor: gf, goalsAgainst: ga } = getTeamGoalsFromMatch(match, teamId)

    goalsFor += gf
    goalDiff += gf - ga

    if (gf > ga) {
      points += 3
      wins += 1
    } else if (gf === ga) {
      points += 1
      draws += 1
    } else {
      losses += 1
    }
  }

  return {
    matches: recentMatches.length,
    points,
    goalDiff,
    goalsFor,
    wins,
    draws,
    losses,
    score: (points * 100) + (goalDiff * 10) + goalsFor
  }
}

function buildThreeWayProbabilities(homeForm, awayForm) {
  if (!homeForm?.matches || !awayForm?.matches) {
    return {
      homeProbBps: 4000,
      drawProbBps: 2000,
      awayProbBps: 4000
    }
  }

  const diff = Number(homeForm.score || 0) - Number(awayForm.score || 0)
  const absDiff = Math.abs(diff)

  if (absDiff <= 40) {
    return {
      homeProbBps: 4000,
      drawProbBps: 2000,
      awayProbBps: 4000
    }
  }

  let favoriteBps = 7500
  let drawBps = 1000
  let underdogBps = 1500

  if (absDiff >= 360) {
    favoriteBps = 8000
    drawBps = 800
    underdogBps = 1200
  } else if (absDiff >= 220) {
    favoriteBps = 7800
    drawBps = 900
    underdogBps = 1300
  }

  if (diff > 0) {
    return {
      homeProbBps: favoriteBps,
      drawProbBps: drawBps,
      awayProbBps: underdogBps
    }
  }

  return {
    homeProbBps: underdogBps,
    drawProbBps: drawBps,
    awayProbBps: favoriteBps
  }
}

export default async () => {
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

    const now = new Date()
    const dateFrom = formatDateYMD(now)

    const limitDate = new Date(now)
limitDate.setDate(limitDate.getDate() + 5)
const dateTo = formatDateYMD(limitDate)

    const teamRecentMatchesCache = new Map()
    const matches = []

    for (const competition of COMPETITIONS) {
      let competitionData

      try {
        competitionData = await footballDataGetJson(
          `https://api.football-data.org/v4/competitions/${competition.code}/matches?status=SCHEDULED,TIMED&dateFrom=${dateFrom}&dateTo=${dateTo}`,
          token
        )
      } catch (error) {
        console.error(`Erro ao buscar ${competition.code}:`, error)
        continue
      }

      const scheduledMatches = Array.isArray(competitionData?.matches)
        ? sortByUtcDateAsc(competitionData.matches)
            .filter((match) =>
              ['SCHEDULED', 'TIMED'].includes(match?.status) &&
              match?.homeTeam?.id &&
              match?.awayTeam?.id &&
              match?.homeTeam?.name &&
              match?.awayTeam?.name &&
              match?.utcDate
            )
            .slice(0, competition.maxMatches)
        : []

      for (const match of scheduledMatches) {
        const homeTeamId = Number(match.homeTeam.id)
        const awayTeamId = Number(match.awayTeam.id)

        async function getTeamRecentMatches(teamId) {
          const cacheKey = String(teamId)

          if (teamRecentMatchesCache.has(cacheKey)) {
            return teamRecentMatchesCache.get(cacheKey)
          }

          const teamData = await footballDataGetJson(
            `https://api.football-data.org/v4/teams/${teamId}/matches?status=FINISHED&limit=3`,
            token
          )

          const recentMatches = Array.isArray(teamData?.matches)
            ? sortByUtcDateDesc(teamData.matches).slice(0, 3)
            : []

          teamRecentMatchesCache.set(cacheKey, recentMatches)
          return recentMatches
        }

        let probabilities = {
          homeProbBps: 4000,
          drawProbBps: 2000,
          awayProbBps: 4000
        }

        try {
          const [homeRecentMatches, awayRecentMatches] = await Promise.all([
            getTeamRecentMatches(homeTeamId),
            getTeamRecentMatches(awayTeamId)
          ])

          const homeForm = getRecentFormScore(homeRecentMatches, homeTeamId)
          const awayForm = getRecentFormScore(awayRecentMatches, awayTeamId)

          probabilities = buildThreeWayProbabilities(homeForm, awayForm)
        } catch (error) {
          console.error(`Erro ao calcular favorito do jogo ${match.id}:`, error)
        }

        matches.push({
          fixtureId: Number(match.id),
          league: match.competition?.name || competition.fallbackName,
          teamA: match.homeTeam?.name || 'Time A',
          teamB: match.awayTeam?.name || 'Time B',
          time: new Date(match.utcDate).toLocaleString('pt-BR', {
            dateStyle: 'short',
            timeStyle: 'short'
          }),
          utcDate: match.utcDate,
          status: match.status,
          homeProbBps: probabilities.homeProbBps,
          drawProbBps: probabilities.drawProbBps,
          awayProbBps: probabilities.awayProbBps
        })
      }
    }

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

  