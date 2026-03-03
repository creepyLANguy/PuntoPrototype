// functions/scoringEngine.js

/**
 * Default starting score
 */
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

/**
 * Apply a single event to a score object
 * Must remain pure and deterministic
 */
function applyEvent(score, event)
{

  // Clone safely (Node 18+ supports structuredClone)
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

/**
 * Tennis-style point logic (no tiebreak yet)
 */
function awardPoint(score, scoringTeam, otherTeam)
{
  const team = score[scoringTeam];
  const opponent = score[otherTeam];

  score.lastPointTeam = scoringTeam;

  team.points++;

  // Deuce logic
  if (team.points >= 3 && opponent.points >= 3)
  {

    if (opponent.points === 4)
    {
      opponent.points = 3;
      return;
    }

    if (team.points === 4)
    {
      this.winGame(team);
      return;
    }

    team.points = 4;
    return;
  }

  team.points++;

  if (team.points >= 4)
  {
    this.winGame(team);
    return;
  }

  this.winGame = function ()
  {
    const opp = opponent(team);

    score[team].games++;
    score.lastGameTeam = team;

    score.A.points = 0;
    score.B.points = 0;

    if (
      score[team].games >= 6 &&
      score[team].games - score[opp].games >= 2
    )
    {
      this.winSet(team);
    }
  }

  this.winSet = function ()
  {
    score[team].sets++;
    score.lastSetTeam = team;

    score.A.games = 0;
    score.B.games = 0;
  }
}

module.exports = {
  defaultScore,
  applyEvent
};