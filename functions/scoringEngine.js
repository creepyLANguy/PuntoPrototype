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

  // Basic tennis progression: 0-1-2-3-4 (simplified)
  if (team.points >= 4 && team.points - opponent.points >= 2)
  {
    team.games++;
    team.points = 0;
    opponent.points = 0;

    score.lastGameTeam = scoringTeam;

    // Simple set logic (6 games win by 2)
    if (team.games >= 6 && team.games - opponent.games >= 2)
    {
      team.sets++;
      team.games = 0;
      opponent.games = 0;

      score.lastSetTeam = scoringTeam;
    }
  }
}

module.exports = {
  defaultScore,
  applyEvent
};