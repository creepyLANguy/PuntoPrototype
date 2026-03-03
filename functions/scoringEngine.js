function defaultScore()
{
  return {
    A: { points: 0, games: 0, sets: 0 },
    B: { points: 0, games: 0, sets: 0 },
    lastPointTeam: null,
    lastGameTeam: null,
    lastSetTeam: null
  };
}

function applyEvent(score, event)
{
  const newScore = structuredClone(score);

  if (!event.eventType) return newScore;

  if (event.eventType === "POINT_TEAM_A")
  {
    awardPoint(newScore, "A", "B");
  }

  if (event.eventType === "POINT_TEAM_B")
  {
    awardPoint(newScore, "B", "A");
  }

  return newScore;
}

function awardPoint(score, scoringTeam, otherTeam)
{
  const team = score[scoringTeam];
  const opponent = score[otherTeam];

  score.lastPointTeam = scoringTeam;

  team.points++;

  if (team.points >= 4 && (team.points - opponent.points) >= 2)
  {
    team.games++;
    score.lastGameTeam = scoringTeam;
    score.A.points = 0;
    score.B.points = 0;

    if (team.games >= 6 && (team.games - opponent.games) >= 2)
    {
      team.sets++;
      score.lastSetTeam = scoringTeam;

      score.A.games = 0;
      score.B.games = 0;
    }
  }
  else if (opponent.points >= 4 && opponent.points > team.points)
  {
    if (team.points === opponent.points)
    {
      team.points = 3;
      opponent.points = 3;
    }
  }
}

module.exports = {
  defaultScore,
  applyEvent
};