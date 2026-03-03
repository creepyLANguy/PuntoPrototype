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

  // If both are below 3 (less than 40), just increment normally
  if (team.points < 3)
  {
    team.points++;
    return;
  }

  // If both at 3 (deuce)
  if (team.points === 3 && opponent.points === 3)
  {
    // Scoring team gets Advantage
    team.points = 4; // 4 = Advantage
    return;
  }

  // If scoring team has Advantage, they win the game
  if (team.points === 4)
  {
    // Win game
    team.games++;
    score.lastGameTeam = scoringTeam;
    team.points = 0;
    opponent.points = 0;

    // Check set win
    if (team.games >= 6 && (team.games - opponent.games) >= 2)
    {
      team.sets++;
      score.lastSetTeam = scoringTeam;
      team.games = 0;
      opponent.games = 0;
    }
    return;
  }

  // If opponent has Advantage (4) and scoring team wins point, back to deuce
  if (opponent.points === 4)
  {
    opponent.points = 3; // back to 40
    return;
  }

  // If scoring team <3 and opponent <3, normal increment
  if (team.points < 3)
  {
    team.points++;
  }
}

module.exports = {
  defaultScore,
  applyEvent
};