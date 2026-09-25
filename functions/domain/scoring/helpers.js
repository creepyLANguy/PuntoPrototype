function isTeamOnGamePoint(state, team, options, isTiebreakGame) {
  if (options.scoringMode !== "standard" || isTiebreakGame) {
    return false;
  }

  const opponent = team === "A" ? "B" : "A";
  const ownPoints = Number(state[team]?.points) || 0;
  const oppPoints = Number(state[opponent]?.points) || 0;

  if (options.deuceMode === "golden") {
    if (ownPoints === 3 && oppPoints === 3) return true;
    if (ownPoints === 3 && oppPoints < 3) return true;
    return ownPoints >= 4;
  }

  if (ownPoints === 3 && oppPoints < 3) return true;
  if (ownPoints >= 4) return true;
  return false;
}

module.exports = { isTeamOnGamePoint };
