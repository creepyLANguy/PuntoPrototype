function defaultScore()
{
  return {
    A: { points: 0, games: 0, sets: 0 },
    B: { points: 0, games: 0, sets: 0 },
    lastPointTeam: null,
    lastGameTeam: null,
    lastSetTeam: null,
    lastEventId: null
  };
}

function applyEvent(score, event)
{
  const newScore = structuredClone(score);

  if (!event.eventType) return newScore;

  switch (event.eventType)
  {
    case "POINT_TEAM_A":
      awardPoint(newScore, "A", "B");
      break;

    case "POINT_TEAM_B":
      awardPoint(newScore, "B", "A");
      break;

    case "UNDO_LAST_POINT":
      undoLastPoint(newScore);
      break;

    default:
      break;
  }

  return newScore;
}

function awardPoint(score, scoringTeam, otherTeam)
{
  const team = score[scoringTeam];
  const opponent = score[otherTeam];

  score.lastPointTeam = scoringTeam;

  function winGame()
  {
    team.games++;
    score.lastGameTeam = scoringTeam;

    team.points = 0;
    opponent.points = 0;

    if (team.games >= 6 && (team.games - opponent.games) >= 2)
    {
      team.sets++;
      score.lastSetTeam = scoringTeam;
      team.games = 0;
      opponent.games = 0;
    }
  }

  // POINT LOGIC: 0,15,30,40,Ad
  if (team.points < 3)
  {
    team.points++;
    return;
  }

  // 40-40 → Advantage
  if (team.points === 3 && opponent.points === 3)
  {
    team.points = 4; // advantage
    return;
  }

  // Advantage → Game
  if (team.points === 4)
  {
    winGame();
    return;
  }

  // Opponent had advantage → back to deuce
  if (opponent.points === 4)
  {
    opponent.points = 3;
    return;
  }

  // 40 vs <40 → Game
  if (team.points === 3 && opponent.points < 3)
  {
    winGame();
    return;
  }
}

function undoLastPoint(score)
{
  const lastTeam = score.lastPointTeam;
  if (!lastTeam) return;

  const team = score[lastTeam];
  const opponent = lastTeam === "A" ? score.B : score.A;

  // Undo Advantage → back to 40
  if (team.points === 4)
  {
    team.points = 3;
    return;
  }

  // Undo opponent advantage → back to 40
  if (opponent.points === 4)
  {
    opponent.points = 3;
    return;
  }

  // Normal point deduction
  if (team.points > 0)
  {
    team.points--;
    return;
  }

  // If points are 0 and a game was just won, undo the game
  if (team.points === 0 && team.games > 0)
  {
    team.games--;
    // Restore points to 40 for the last game of the team who won
    team.points = 3;

    // Check if a set was won and needs to be undone
    if (team.sets > 0 && team.games === 0 && opponent.games === 0)
    {
      team.sets--;
      // Restore games to last completed game count (assume 5–any score)
      team.games = 5;
      opponent.games = Math.max(0, opponent.games); // keep opponent games at 0
    }

    // Update lastGameTeam/lastSetTeam if needed
    score.lastGameTeam = team.games === 0 ? null : lastTeam;
    score.lastSetTeam = team.sets === 0 ? null : lastTeam;
  }

  // Reset lastPointTeam if undo removed the last point
  score.lastPointTeam = null;
}