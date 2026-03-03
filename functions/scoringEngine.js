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
 * Classic Advantage-style point logic (Deuce)
 * No tiebreaks implemented as requested.
 */
function awardPoint(score, scoringTeam, otherTeam)
{
  const team = score[scoringTeam];
  const opponent = score[otherTeam];

  score.lastPointTeam = scoringTeam;

  // Increment points
  team.points++;

  // Check for game win
  // Normal win: 4 points and at least 2 points lead
  // Deuce win: After 3-3, must win by 2 points (Ad -> Win)
  if (team.points >= 4 && (team.points - opponent.points) >= 2)
  {
    team.games++;
    score.lastGameTeam = scoringTeam;

    // Reset points for the next game
    score.A.points = 0;
    score.B.points = 0;

    // Set logic: Win set by reaching 6 games with a 2-game lead
    if (team.games >= 6 && (team.games - opponent.games) >= 2)
    {
      team.sets++;
      score.lastSetTeam = scoringTeam;

      // Reset games for the next set
      score.A.games = 0;
      score.B.games = 0;
    }
  }
  // Advantage logic: If opponent had advantage (4 points while we had 3), 
  // and we scored, they go back to 3 (Deuce)
  else if (opponent.points >= 4 && opponent.points > team.points)
  {
    // No change needed here, the point increase for 'team' naturally brings them closer.
    // However, to keep point values readable (0,15,30,40,Ad), 
    // we reset both to 3 (40) if it's 4-4 now.
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