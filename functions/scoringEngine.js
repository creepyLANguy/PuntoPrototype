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

  // Internal helper to win a game
  function winGame()
  {
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
  }

  // Case 1: Normal points (less than 40)
  if (team.points < 3)
  {
    team.points++;
    return;
  }

  // Case 2: Both at 40 → deuce scenario
  if (team.points === 3 && opponent.points === 3)
  {
    team.points = 4; // scoring team gets Advantage
    return;
  }

  // Case 3: Scoring team has Advantage → wins game
  if (team.points === 4)
  {
    winGame();
    return;
  }

  // Case 4: Opponent has Advantage → back to deuce
  if (opponent.points === 4)
  {
    opponent.points = 3; // back to 40
    return;
  }

  // Case 5: Scoring team at 40, opponent less than 40 → wins game
  if (team.points === 3 && opponent.points < 3)
  {
    winGame();
    return;
  }
}

module.exports = {
  defaultScore,
  applyEvent
};