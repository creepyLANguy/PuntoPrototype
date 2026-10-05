// Bridge from match lifecycle changes to tournament recalculation. Kept
// separate so the match layer never depends on the tournament layer at load
// time.
async function onTournamentMatchChanged(change) {
  const tournamentId = change?.tournamentId;
  if (!tournamentId) return null;
  const { recalculateTournament } = require("./tournamentService");
  return recalculateTournament({ tournamentId, reason: "match-change" });
}

module.exports = { onTournamentMatchChanged };
