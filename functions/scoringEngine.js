const defaultScore = () => ({
  A: { points: 0, games: 0, sets: 0 },
  B: { points: 0, games: 0, sets: 0 },
  lastPointTeam: null,
  lastGameTeam: null,
  lastSetTeam: null
});

const opponent = (team) => (team === "A" ? "B" : "A");

function addPoint(score, team)
{
  const s = JSON.parse(JSON.stringify(score));
  s.lastPointTeam = team;
  const opp = opponent(team);

  if (s.A.points >= 3 && s.B.points >= 3)
  {
    if (s[opp].points === 4)
    {
      s[opp].points = 3;
      return s;
    }
    if (s[team].points === 4)
    {
      return winGame(s, team);
    }
    s[team].points = 4;
    return s;
  }

  s[team].points++;
  if (s[team].points >= 4)
  {
    return winGame(s, team);
  }

  return s;
}

function winGame(score, team)
{
  const opp = opponent(team);
  score[team].games++;
  score.lastGameTeam = team;
  score.A.points = 0;
  score.B.points = 0;

  if (score[team].games >= 6 && score[team].games - score[opp].games >= 2)
  {
    return winSet(score, team);
  }

  return score;
}

function winSet(score, team)
{
  score[team].sets++;
  score.lastSetTeam = team;
  score.A.games = 0;
  score.B.games = 0;
  return score;
}

function applyEvent(score, eventType)
{
  switch (eventType)
  {
    case "POINT_TEAM_A":
      return addPoint(score, "A");
    case "POINT_TEAM_B":
      return addPoint(score, "B");
    default:
      return score;
  }
}

function computeScoreFromEvents(events)
{
  return events.reduce(
    (score, event) => applyEvent(score, event.eventType),
    defaultScore()
  );
}

module.exports = {
  defaultScore,
  computeScoreFromEvents
};