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

  // Normal point increment
  team.points++;

  // Deuce / Advantage logic
  if (team.points >= 4 || opponent.points >= 4)
  {
    const diff = team.points - opponent.points;

    if (diff >= 2)
    {
      // Win the game
      team.games++;
      score.lastGameTeam = scoringTeam;
      team.points = 0;
      opponent.points = 0;

      // Check for set win
      if (team.games >= 6 && (team.games - opponent.games) >= 2)
      {
        team.sets++;
        score.lastSetTeam = scoringTeam;
        team.games = 0;
        opponent.games = 0;
      }
    }
    // No need to explicitly handle deuce/advantage; diff < 2 keeps it at 40/Adv
  }
}

module.exports = {
  defaultScore,
  applyEvent
};