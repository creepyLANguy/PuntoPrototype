function fixtureOutcome(fixture) {
  const snapshot = fixture?.resultSnapshot;
  if (!snapshot || fixture.status !== "completed") return null;
  const points = normalizeScore(snapshot.points);
  const games = normalizeScore(snapshot.games);
  const sets = normalizeScore(snapshot.sets);
  let winner = snapshot.winner || "draw";
  if (!["A", "B", "draw"].includes(winner)) {
    winner = points.A === points.B ? "draw" : points.A > points.B ? "A" : "B";
  }
  return { winner, points, games, sets };
}

function normalizeScore(value) {
  return {
    A: Number(value?.A || 0),
    B: Number(value?.B || 0),
  };
}

module.exports = { fixtureOutcome };
