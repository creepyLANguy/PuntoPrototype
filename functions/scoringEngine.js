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

    case "RESET":
      // Do nothing: RESET handled in index.js
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

  // Undo advantage
  if (team.points === 4)
  {
    team.points = 3;
    return;
  }

  // Undo deuce advantage recovery
  if (opponent.points === 3 && team.points === 3)
  {
    team.points = 3; // reset from advantage to 40
    return;
  }

  // Normal point deduction
  if (team.points > 0) team.points--;

  // TODO: if needed, undo game/set increments
  // For now, UNDO only affects last point within current game
}

module.exports = {
  defaultScore,
  applyEvent
};