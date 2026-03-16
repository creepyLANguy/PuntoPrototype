function defaultScore()
{
  return {
    A: { points: 0, games: 0, sets: 0 },
    B: { points: 0, games: 0, sets: 0 },
    lastPointTeam: null,
    lastGameTeam: null,
    lastSetTeam: null,
    lastEventId: null,
    history: []
  };
}

function applyEvent(score, event)
{
  if (event.eventType === "UNDO")
  {
    return undo(score);
  }

  const newScore = structuredClone(score);

  // Ensure history exists (for legacy score documents)
  if (!newScore.history) newScore.history = [];

  // Before applying a point, save the current state (excluding history) to history
  const snapshot = structuredClone(newScore);
  delete snapshot.history;
  newScore.history.push(snapshot);

  // Keep history reasonable (e.g., last 'n'' events)
  if (newScore.history.length > 100)
  {
    newScore.history.shift();
  }

  switch (event.eventType)
  {
    case "POINT_TEAM_A":
      awardPoint(newScore, "A", "B");
      break;

    case "POINT_TEAM_B":
      awardPoint(newScore, "B", "A");
      break;

    default:
      // If it's not a point event, we shouldn't have added to history
      newScore.history.pop();
      break;
  }

  return newScore;
}

function undo(score)
{
  if (!score.history || score.history.length === 0)
  {
    console.log("Nothing to undo");
    return score;
  }

  const newScore = score.history.pop();
  // Ensure the history itself is preserved in the new state
  newScore.history = score.history;
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

  // POINT LOGIC: 0 -> 15 (1) -> 30 (2) -> 40 (3) -> Ad (4)
  if (team.points < 3)
  {
    team.points++;
    return;
  }

  // Deuce logic
  if (team.points === 3 && opponent.points === 3)
  {
    team.points = 4; // advantage
    return;
  }

  if (opponent.points === 4)
  {
    opponent.points = 3; // back to deuce
    return;
  }

  // Win game from 40 or Ad
  winGame();
}

module.exports = {
  defaultScore,
  applyEvent
};