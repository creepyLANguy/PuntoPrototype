const {
  DEFAULT_SCORING_OPTIONS,
  defaultScore,
  normalizeScoringOptions,
  applyEvent,
  replayEvents,
  getCompletedMatchGames,
  getGameServerLabel,
  getCurrentServerLabel,
  toLiveScorePayload,
  compareEventOrder,
  scoreEquivalent,
  didSetCountIncrease
} = require("./scoringEngine");

// Helper: apply N points to a team
function awardPoints(score, team, count, options = DEFAULT_SCORING_OPTIONS)
{
  let s = score;
  for (let i = 0; i < count; i++)
  {
    s = applyEvent(s, { eventType: team === "A" ? "POINT_TEAM_A" : "POINT_TEAM_B", id: `evt-${team}-${i}-${Date.now()}` }, options);
  }
  return s;
}

// Helper: win a game for a team (standard scoring, no deuce)
function winGame(score, team, options = DEFAULT_SCORING_OPTIONS)
{
  return awardPoints(score, team, 4, options);
}

// Helper: win a set 6-0 for a team
function winSet60(score, team, options = DEFAULT_SCORING_OPTIONS)
{
  let s = score;
  for (let i = 0; i < 6; i++)
  {
    s = winGame(s, team, options);
  }
  return s;
}

describe("normalizeScoringOptions", () =>
{
  test("returns defaults for empty input", () =>
  {
    expect(normalizeScoringOptions({})).toEqual(DEFAULT_SCORING_OPTIONS);
  });

  test("resets invalid scoringMode", () =>
  {
    expect(normalizeScoringOptions({ scoringMode: "invalid" }).scoringMode).toBe("standard");
  });

  test("resets invalid deuceMode", () =>
  {
    expect(normalizeScoringOptions({ deuceMode: "invalid" }).deuceMode).toBe("standard");
  });

  test("resets invalid tiebreakMode", () =>
  {
    expect(normalizeScoringOptions({ tiebreakMode: "invalid" }).tiebreakMode).toBe("sixAllSeven");
  });

  test("preserves valid options", () =>
  {
    const opts = { scoringMode: "straight", deuceMode: "golden", tiebreakMode: "sixAllTen" };
    expect(normalizeScoringOptions(opts)).toEqual(opts);
  });
});

describe("defaultScore", () =>
{
  test("creates initial score state", () =>
  {
    const s = defaultScore();
    expect(s.A.points).toBe(0);
    expect(s.A.games).toBe(0);
    expect(s.A.sets).toBe(0);
    expect(s.B.points).toBe(0);
    expect(s.matchComplete).toBe(false);
    expect(s.inTiebreak).toBe(false);
    expect(s.history).toEqual([]);
    expect(s.completedSets).toEqual([]);
  });
});

describe("Standard scoring - adding points", () =>
{
  test("first point advances to 15 (points index 1)", () =>
  {
    let s = defaultScore();
    s = applyEvent(s, { eventType: "POINT_TEAM_A", id: "e1" });
    expect(s.A.points).toBe(1);
    expect(s.A.totalPoints).toBe(1);
    expect(s.lastPointTeam).toBe("A");
  });

  test("second point advances to 30 (points index 2)", () =>
  {
    let s = defaultScore();
    s = awardPoints(s, "A", 2);
    expect(s.A.points).toBe(2);
  });

  test("third point advances to 40 (points index 3)", () =>
  {
    let s = defaultScore();
    s = awardPoints(s, "A", 3);
    expect(s.A.points).toBe(3);
  });

  test("fourth point wins game when opponent has < 3 points", () =>
  {
    let s = defaultScore();
    s = awardPoints(s, "A", 4);
    expect(s.A.points).toBe(0);
    expect(s.A.games).toBe(1);
    expect(s.lastGameTeam).toBe("A");
  });

  test("points for team B work correctly", () =>
  {
    let s = defaultScore();
    s = awardPoints(s, "B", 4);
    expect(s.B.games).toBe(1);
    expect(s.lastGameTeam).toBe("B");
  });
});

describe("Standard scoring - deuce scenarios", () =>
{
  function getToDeuce()
  {
    let s = defaultScore();
    s = awardPoints(s, "A", 3);
    s = awardPoints(s, "B", 3);
    return s;
  }

  test("at deuce (3-3), scoring team gets advantage (4)", () =>
  {
    let s = getToDeuce();
    s = applyEvent(s, { eventType: "POINT_TEAM_A", id: "e1" });
    expect(s.A.points).toBe(4); // advantage
  });

  test("advantage team wins game with next point", () =>
  {
    let s = getToDeuce();
    s = applyEvent(s, { eventType: "POINT_TEAM_A", id: "e1" });
    s = applyEvent(s, { eventType: "POINT_TEAM_A", id: "e2" });
    expect(s.A.games).toBe(1);
    expect(s.A.points).toBe(0);
  });

  test("opponent scoring when other has advantage returns to deuce", () =>
  {
    let s = getToDeuce();
    s = applyEvent(s, { eventType: "POINT_TEAM_A", id: "e1" }); // A has ad
    s = applyEvent(s, { eventType: "POINT_TEAM_B", id: "e2" }); // back to deuce
    expect(s.A.points).toBe(3);
    expect(s.B.points).toBe(3);
  });

  test("multiple deuce cycles work correctly", () =>
  {
    let s = getToDeuce();
    // A gets ad, B breaks back
    s = applyEvent(s, { eventType: "POINT_TEAM_A", id: "e1" });
    s = applyEvent(s, { eventType: "POINT_TEAM_B", id: "e2" });
    // B gets ad, A breaks back
    s = applyEvent(s, { eventType: "POINT_TEAM_B", id: "e3" });
    s = applyEvent(s, { eventType: "POINT_TEAM_A", id: "e4" });
    // A gets ad and wins
    s = applyEvent(s, { eventType: "POINT_TEAM_A", id: "e5" });
    s = applyEvent(s, { eventType: "POINT_TEAM_A", id: "e6" });
    expect(s.A.games).toBe(1);
  });
});

describe("Standard scoring - golden point (no-ad)", () =>
{
  const options = { scoringMode: "standard", deuceMode: "golden", tiebreakMode: "sixAllSeven" };

  test("at deuce with golden point, next point wins game", () =>
  {
    let s = defaultScore(options);
    s = awardPoints(s, "A", 3, options);
    s = awardPoints(s, "B", 3, options);
    s = applyEvent(s, { eventType: "POINT_TEAM_A", id: "e1" }, options);
    expect(s.A.games).toBe(1);
    expect(s.A.points).toBe(0);
  });

  test("at deuce with golden point, team B can also win", () =>
  {
    let s = defaultScore(options);
    s = awardPoints(s, "A", 3, options);
    s = awardPoints(s, "B", 3, options);
    s = applyEvent(s, { eventType: "POINT_TEAM_B", id: "e1" }, options);
    expect(s.B.games).toBe(1);
  });
});

describe("Standard scoring - silver deuce", () =>
{
  const options = { scoringMode: "standard", deuceMode: "silver", tiebreakMode: "sixAllSeven" };

  test("first deuce plays normally with advantage", () =>
  {
    let s = defaultScore(options);
    s = awardPoints(s, "A", 3, options);
    s = awardPoints(s, "B", 3, options);
    // First deuce: normal advantage rules
    s = applyEvent(s, { eventType: "POINT_TEAM_A", id: "e1" }, options);
    expect(s.A.points).toBe(4); // advantage
  });

  test("second deuce is sudden death (golden)", () =>
  {
    let s = defaultScore(options);
    s = awardPoints(s, "A", 3, options);
    s = awardPoints(s, "B", 3, options);
    // First deuce: A gets ad, B breaks back
    s = applyEvent(s, { eventType: "POINT_TEAM_A", id: "e1" }, options);
    s = applyEvent(s, { eventType: "POINT_TEAM_B", id: "e2" }, options);
    // Now deuceCycles > 0, so next point at deuce wins
    expect(s.A.points).toBe(3);
    expect(s.B.points).toBe(3);
    s = applyEvent(s, { eventType: "POINT_TEAM_B", id: "e3" }, options);
    expect(s.B.games).toBe(1);
  });
});

describe("Standard scoring - star point", () =>
{
  const options = { scoringMode: "standard", deuceMode: "star", tiebreakMode: "sixAllSeven" };

  test("first two deuces play normally with advantage", () =>
  {
    let s = defaultScore(options);
    s = awardPoints(s, "A", 3, options);
    s = awardPoints(s, "B", 3, options);
    // First deuce: advantage play
    s = applyEvent(s, { eventType: "POINT_TEAM_A", id: "e1" }, options);
    expect(s.A.points).toBe(4);
    s = applyEvent(s, { eventType: "POINT_TEAM_B", id: "e2" }, options);
    // Second deuce (one cancelled advantage): still advantage play
    s = applyEvent(s, { eventType: "POINT_TEAM_B", id: "e3" }, options);
    expect(s.B.points).toBe(4);
  });

  test("third deuce is sudden death", () =>
  {
    let s = defaultScore(options);
    s = awardPoints(s, "A", 3, options);
    s = awardPoints(s, "B", 3, options);
    // Two full deuce cycles: Ad A cancelled, Ad B cancelled
    s = applyEvent(s, { eventType: "POINT_TEAM_A", id: "e1" }, options);
    s = applyEvent(s, { eventType: "POINT_TEAM_B", id: "e2" }, options);
    s = applyEvent(s, { eventType: "POINT_TEAM_B", id: "e3" }, options);
    s = applyEvent(s, { eventType: "POINT_TEAM_A", id: "e4" }, options);
    expect(s.deuceCycles).toBe(2);
    expect(s.A.points).toBe(3);
    expect(s.B.points).toBe(3);
    // Third deuce: next point wins the game outright
    s = applyEvent(s, { eventType: "POINT_TEAM_A", id: "e5" }, options);
    expect(s.A.games).toBe(1);
  });
});

describe("Standard tiebreak - no upper limit", () =>
{
  const options = { scoringMode: "standard", deuceMode: "standard", tiebreakMode: "sixAllSeven" };

  test("tiebreak continues past 7 until two clear", () =>
  {
    let s = defaultScore(options);
    for (let i = 0; i < 6; i++)
    {
      s = winGame(s, "A");
      s = winGame(s, "B");
    }
    // 6-6 -> tiebreak; trade points to 7-7
    for (let i = 0; i < 7; i++)
    {
      s = applyEvent(s, { eventType: "POINT_TEAM_A", id: `a${i}` }, options);
      s = applyEvent(s, { eventType: "POINT_TEAM_B", id: `b${i}` }, options);
    }
    expect(s.inTiebreak).toBe(true);
    expect(s.A.points).toBe(7);
    expect(s.B.points).toBe(7);
    expect(s.A.sets).toBe(0);
    // 8-7 is still not enough
    s = applyEvent(s, { eventType: "POINT_TEAM_A", id: "a8" }, options);
    expect(s.A.sets).toBe(0);
    // 9-7 takes the set
    s = applyEvent(s, { eventType: "POINT_TEAM_A", id: "a9" }, options);
    expect(s.A.sets).toBe(1);
    expect(s.completedSets[0].tiebreakPoints).toEqual({ A: 9, B: 7 });
  });
});

describe("Standard scoring - winning a set", () =>
{
  test("team wins set at 6-0", () =>
  {
    let s = defaultScore();
    s = winSet60(s, "A");
    expect(s.A.sets).toBe(1);
    expect(s.A.games).toBe(0);
    expect(s.completedSets.length).toBe(1);
    expect(s.completedSets[0]).toEqual({ A: 6, B: 0, tiebreakPoints: null });
  });

  test("team wins set at 6-4", () =>
  {
    let s = defaultScore();
    for (let i = 0; i < 4; i++)
    {
      s = winGame(s, "A");
      s = winGame(s, "B");
    }
    // 4-4
    s = winGame(s, "A"); // 5-4
    s = winGame(s, "A"); // 6-4 -> set won
    expect(s.A.sets).toBe(1);
    expect(s.A.games).toBe(0);
  });

  test("no set win at 6-5", () =>
  {
    let s = defaultScore();
    for (let i = 0; i < 5; i++)
    {
      s = winGame(s, "A");
      s = winGame(s, "B");
    }
    // 5-5
    s = winGame(s, "A"); // 6-5
    expect(s.A.sets).toBe(0);
    expect(s.A.games).toBe(6);
  });

  test("set won at 7-5", () =>
  {
    let s = defaultScore();
    for (let i = 0; i < 5; i++)
    {
      s = winGame(s, "A");
      s = winGame(s, "B");
    }
    // 5-5
    s = winGame(s, "A"); // 6-5
    s = winGame(s, "A"); // 7-5 -> set won
    expect(s.A.sets).toBe(1);
  });
});

describe("Standard scoring - tiebreak at 6-6", () =>
{
  function getTo66()
  {
    let s = defaultScore();
    for (let i = 0; i < 6; i++)
    {
      s = winGame(s, "A");
      s = winGame(s, "B");
    }
    return s;
  }

  test("at 6-6, tiebreak is triggered", () =>
  {
    let s = getTo66();
    s = applyEvent(s, { eventType: "POINT_TEAM_A", id: "e1" });
    expect(s.inTiebreak).toBe(true);
    expect(s.A.points).toBe(1);
  });

  test("7-point tiebreak: win at 7-0", () =>
  {
    let s = getTo66();
    s = awardPoints(s, "A", 7);
    expect(s.A.sets).toBe(1);
    expect(s.A.games).toBe(0);
    expect(s.inTiebreak).toBe(false);
  });

  test("7-point tiebreak: no win at 7-6, need 2 point lead", () =>
  {
    let s = getTo66();
    s = awardPoints(s, "A", 6);
    s = awardPoints(s, "B", 6);
    s = applyEvent(s, { eventType: "POINT_TEAM_A", id: "e1" }); // 7-6
    expect(s.A.sets).toBe(0);
    expect(s.inTiebreak).toBe(true);
  });

  test("7-point tiebreak: win at 8-6", () =>
  {
    let s = getTo66();
    s = awardPoints(s, "A", 6);
    s = awardPoints(s, "B", 6);
    s = awardPoints(s, "A", 2); // 8-6
    expect(s.A.sets).toBe(1);
  });

  test("10-point tiebreak at 6-6", () =>
  {
    const options = { scoringMode: "standard", deuceMode: "standard", tiebreakMode: "sixAllTen" };
    let s = defaultScore(options);
    for (let i = 0; i < 6; i++)
    {
      s = winGame(s, "A", options);
      s = winGame(s, "B", options);
    }
    s = awardPoints(s, "A", 10, options);
    expect(s.A.sets).toBe(1);
  });

  test("tiebreak off: no tiebreak at 6-6, game continues", () =>
  {
    const options = { scoringMode: "standard", deuceMode: "standard", tiebreakMode: "off" };
    let s = defaultScore(options);
    for (let i = 0; i < 6; i++)
    {
      s = winGame(s, "A", options);
      s = winGame(s, "B", options);
    }
    // 6-6, win another game
    s = winGame(s, "A", options); // 7-6
    expect(s.A.sets).toBe(0);
    expect(s.A.games).toBe(7);
    expect(s.inTiebreak).toBe(false);
    s = winGame(s, "A", options); // 8-6 -> set
    expect(s.A.sets).toBe(1);
  });
});

describe("Standard scoring - no match completion (sets continue indefinitely)", () =>
{
  test("winning 2 sets does NOT complete the match", () =>
  {
    let s = defaultScore();
    s = winSet60(s, "A");
    s = winSet60(s, "A");
    expect(s.matchComplete).toBe(false);
    expect(s.A.sets).toBe(2);
  });

  test("can play beyond 2 sets", () =>
  {
    let s = defaultScore();
    s = winSet60(s, "A");
    s = winSet60(s, "B");
    s = winSet60(s, "A");
    s = winSet60(s, "B");
    s = winSet60(s, "A");
    expect(s.matchComplete).toBe(false);
    expect(s.A.sets).toBe(3);
    expect(s.B.sets).toBe(2);
    expect(s.completedSets.length).toBe(5);
  });

  test("points can still be added after many sets", () =>
  {
    let s = defaultScore();
    s = winSet60(s, "A");
    s = winSet60(s, "A");
    s = winSet60(s, "A");
    s = applyEvent(s, { eventType: "POINT_TEAM_B", id: "extra" });
    expect(s.B.points).toBe(1);
    expect(s.matchComplete).toBe(false);
  });
});

describe("Straight points scoring mode", () =>
{
  const options = { scoringMode: "straight", deuceMode: "standard", tiebreakMode: "sixAllSeven" };

  test("points increment by 1 each time", () =>
  {
    let s = defaultScore(options);
    s = applyEvent(s, { eventType: "POINT_TEAM_A", id: "e1" }, options);
    expect(s.A.points).toBe(1);
    s = applyEvent(s, { eventType: "POINT_TEAM_A", id: "e2" }, options);
    expect(s.A.points).toBe(2);
  });

  test("no games or sets in straight mode", () =>
  {
    let s = defaultScore(options);
    s = awardPoints(s, "A", 100, options);
    expect(s.A.points).toBe(100);
    expect(s.A.games).toBe(0);
    expect(s.A.sets).toBe(0);
    expect(s.matchComplete).toBe(false);
  });

  test("both teams can score independently", () =>
  {
    let s = defaultScore(options);
    s = awardPoints(s, "A", 5, options);
    s = awardPoints(s, "B", 3, options);
    expect(s.A.points).toBe(5);
    expect(s.B.points).toBe(3);
  });
});

describe("Tiebreak Ten scoring mode", () =>
{
  const options = { scoringMode: "tiebreakTen", deuceMode: "standard", tiebreakMode: "sixAllSeven" };

  test("points increment by 1", () =>
  {
    let s = defaultScore(options);
    s = awardPoints(s, "A", 5, options);
    expect(s.A.points).toBe(5);
  });

  test("wins match at 10-0", () =>
  {
    let s = defaultScore(options);
    s = awardPoints(s, "A", 10, options);
    expect(s.matchComplete).toBe(true);
    expect(s.A.sets).toBe(1);
  });

  test("no win at 10-9, need 2 point lead", () =>
  {
    let s = defaultScore(options);
    s = awardPoints(s, "A", 9, options);
    s = awardPoints(s, "B", 9, options);
    s = applyEvent(s, { eventType: "POINT_TEAM_A", id: "e1" }, options); // 10-9
    expect(s.matchComplete).toBe(false);
  });

  test("wins at 11-9", () =>
  {
    let s = defaultScore(options);
    s = awardPoints(s, "A", 9, options);
    s = awardPoints(s, "B", 9, options);
    s = awardPoints(s, "A", 2, options); // 11-9
    expect(s.matchComplete).toBe(true);
  });
});

describe("Undo functionality", () =>
{
  test("undo reverts the last point", () =>
  {
    let s = defaultScore();
    s = applyEvent(s, { eventType: "POINT_TEAM_A", id: "e1" });
    expect(s.A.points).toBe(1);
    s = applyEvent(s, { eventType: "UNDO", id: "u1" });
    expect(s.A.points).toBe(0);
    expect(s.A.totalPoints).toBe(0);
  });

  test("undo after multiple points reverts to previous state", () =>
  {
    let s = defaultScore();
    s = applyEvent(s, { eventType: "POINT_TEAM_A", id: "e1" });
    s = applyEvent(s, { eventType: "POINT_TEAM_B", id: "e2" });
    s = applyEvent(s, { eventType: "UNDO", id: "u1" });
    expect(s.A.points).toBe(1);
    expect(s.B.points).toBe(0);
  });

  test("undo on fresh score does nothing", () =>
  {
    let s = defaultScore();
    s = applyEvent(s, { eventType: "UNDO", id: "u1" });
    expect(s.A.points).toBe(0);
    expect(s.B.points).toBe(0);
  });

  test("undo reverts a game win", () =>
  {
    let s = defaultScore();
    s = awardPoints(s, "A", 4);
    expect(s.A.games).toBe(1);
    s = applyEvent(s, { eventType: "UNDO", id: "u1" });
    expect(s.A.games).toBe(0);
    expect(s.A.points).toBe(3);
  });

  test("undo reverts a set win", () =>
  {
    let s = defaultScore();
    s = winSet60(s, "A");
    expect(s.A.sets).toBe(1);
    s = applyEvent(s, { eventType: "UNDO", id: "u1" });
    expect(s.A.sets).toBe(0);
    expect(s.A.games).toBe(5);
    expect(s.A.points).toBe(3);
  });

  test("multiple undos work sequentially", () =>
  {
    let s = defaultScore();
    s = applyEvent(s, { eventType: "POINT_TEAM_A", id: "e1" });
    s = applyEvent(s, { eventType: "POINT_TEAM_A", id: "e2" });
    s = applyEvent(s, { eventType: "POINT_TEAM_A", id: "e3" });
    s = applyEvent(s, { eventType: "UNDO", id: "u1" });
    s = applyEvent(s, { eventType: "UNDO", id: "u2" });
    expect(s.A.points).toBe(1);
  });

  test("undo reverts tiebreakTen match completion", () =>
  {
    const options = { scoringMode: "tiebreakTen", deuceMode: "standard", tiebreakMode: "sixAllSeven" };
    let s = defaultScore(options);
    s = awardPoints(s, "A", 10, options);
    expect(s.matchComplete).toBe(true);
    s = applyEvent(s, { eventType: "UNDO", id: "u1" }, options);
    expect(s.matchComplete).toBe(false);
    expect(s.A.points).toBe(9);
  });
});

describe("RESET event", () =>
{
  test("reset returns to default score", () =>
  {
    let s = defaultScore();
    s = awardPoints(s, "A", 10);
    s = applyEvent(s, { eventType: "RESET", id: "r1" });
    expect(s.A.points).toBe(0);
    expect(s.A.games).toBe(0);
    expect(s.A.sets).toBe(0);
    expect(s.matchComplete).toBe(false);
  });
});

describe("replayEvents", () =>
{
  test("replays a sequence of events correctly", () =>
  {
    const events = [
      { eventType: "POINT_TEAM_A", id: "e1" },
      { eventType: "POINT_TEAM_A", id: "e2" },
      { eventType: "POINT_TEAM_B", id: "e3" },
      { eventType: "POINT_TEAM_A", id: "e4" },
      { eventType: "POINT_TEAM_A", id: "e5" } // game won by A
    ];
    const s = replayEvents(events);
    expect(s.A.games).toBe(1);
    expect(s.B.points).toBe(0); // B's point was reset when A won the game
  });

  test("replay with undo mid-sequence", () =>
  {
    const events = [
      { eventType: "POINT_TEAM_A", id: "e1" },
      { eventType: "POINT_TEAM_A", id: "e2" },
      { eventType: "UNDO", id: "u1" },
      { eventType: "POINT_TEAM_B", id: "e3" }
    ];
    const s = replayEvents(events);
    expect(s.A.points).toBe(1);
    expect(s.B.points).toBe(1);
  });

  test("replay with reset mid-sequence", () =>
  {
    const events = [
      { eventType: "POINT_TEAM_A", id: "e1" },
      { eventType: "POINT_TEAM_A", id: "e2" },
      { eventType: "RESET", id: "r1" },
      { eventType: "POINT_TEAM_B", id: "e3" }
    ];
    const s = replayEvents(events);
    expect(s.A.points).toBe(0);
    expect(s.B.points).toBe(1);
  });
});

describe("Server labels", () =>
{
  test("getGameServerLabel alternates teams", () =>
  {
    expect(getGameServerLabel(0)).toBe("A1");
    expect(getGameServerLabel(1)).toBe("B1");
    expect(getGameServerLabel(2)).toBe("A2");
    expect(getGameServerLabel(3)).toBe("B2");
    expect(getGameServerLabel(4)).toBe("A1");
  });

  test("getCompletedMatchGames counts all games", () =>
  {
    let s = defaultScore();
    s = winSet60(s, "A"); // 6 games in completed set
    s = winGame(s, "B"); // 1 game in current set
    expect(getCompletedMatchGames(s)).toBe(7);
  });

  test("getCurrentServerLabel returns null for straight mode", () =>
  {
    let s = defaultScore({ scoringMode: "straight", deuceMode: "standard", tiebreakMode: "sixAllSeven" });
    expect(getCurrentServerLabel(s)).toBeNull();
  });
});

describe("lastEventId tracking", () =>
{
  test("lastEventId is set from event id", () =>
  {
    let s = defaultScore();
    s = applyEvent(s, { eventType: "POINT_TEAM_A", id: "myevent123" });
    expect(s.lastEventId).toBe("myevent123");
  });

  test("lastEventId is set from eventId field", () =>
  {
    let s = defaultScore();
    s = applyEvent(s, { eventType: "POINT_TEAM_A", eventId: "myevent456" });
    expect(s.lastEventId).toBe("myevent456");
  });
});

describe("Concurrent/rapid events - timestamp ordering", () =>
{
  test("many rapid events from same team resolve correctly in order", () =>
  {
    const events = [];
    const baseTime = Date.now();
    for (let i = 0; i < 8; i++)
    {
      events.push({ eventType: "POINT_TEAM_A", id: `rapid-${i}`, createdAt: baseTime + i });
    }
    const s = replayEvents(events);
    // 4 points = 1 game, next 4 = another game
    expect(s.A.games).toBe(2);
    expect(s.A.points).toBe(0);
  });

  test("interleaved rapid events from both teams resolve correctly", () =>
  {
    const events = [];
    const baseTime = Date.now();
    for (let i = 0; i < 8; i++)
    {
      events.push({
        eventType: i % 2 === 0 ? "POINT_TEAM_A" : "POINT_TEAM_B",
        id: `alt-${i}`,
        createdAt: baseTime + i
      });
    }
    const s = replayEvents(events);
    // Alternating: A=1,B=1,A=2,B=2,A=3,B=3 (deuce), A gets ad (4), B scores -> back to deuce (3-3)
    expect(s.A.points).toBe(3);
    expect(s.B.points).toBe(3);
  });

  test("burst of identical timestamps with unique IDs all process", () =>
  {
    const events = [
      { eventType: "POINT_TEAM_A", id: "burst-1", createdAt: 1000 },
      { eventType: "POINT_TEAM_A", id: "burst-2", createdAt: 1000 },
      { eventType: "POINT_TEAM_A", id: "burst-3", createdAt: 1000 }
    ];
    const s = replayEvents(events);
    expect(s.A.points).toBe(3);
    expect(s.A.totalPoints).toBe(3);
  });

  test("undo in rapid sequence correctly reverts last point only", () =>
  {
    const events = [
      { eventType: "POINT_TEAM_A", id: "r1", createdAt: 100 },
      { eventType: "POINT_TEAM_A", id: "r2", createdAt: 101 },
      { eventType: "POINT_TEAM_B", id: "r3", createdAt: 102 },
      { eventType: "UNDO", id: "r4", createdAt: 103 }
    ];
    const s = replayEvents(events);
    expect(s.A.points).toBe(2);
    expect(s.B.points).toBe(0);
  });

  test("multiple undos in rapid succession revert multiple points", () =>
  {
    const events = [
      { eventType: "POINT_TEAM_A", id: "m1", createdAt: 100 },
      { eventType: "POINT_TEAM_A", id: "m2", createdAt: 101 },
      { eventType: "POINT_TEAM_A", id: "m3", createdAt: 102 },
      { eventType: "UNDO", id: "m4", createdAt: 103 },
      { eventType: "UNDO", id: "m5", createdAt: 104 },
      { eventType: "UNDO", id: "m6", createdAt: 105 }
    ];
    const s = replayEvents(events);
    expect(s.A.points).toBe(0);
    expect(s.A.totalPoints).toBe(0);
  });

  test("undo after game win in rapid sequence reverts game", () =>
  {
    const events = [
      { eventType: "POINT_TEAM_A", id: "g1", createdAt: 100 },
      { eventType: "POINT_TEAM_A", id: "g2", createdAt: 101 },
      { eventType: "POINT_TEAM_A", id: "g3", createdAt: 102 },
      { eventType: "POINT_TEAM_A", id: "g4", createdAt: 103 },
      { eventType: "UNDO", id: "g5", createdAt: 104 }
    ];
    const s = replayEvents(events);
    expect(s.A.games).toBe(0);
    expect(s.A.points).toBe(3);
  });

  test("events sorted by timestamp produce deterministic result", () =>
  {
    const events = [
      { eventType: "POINT_TEAM_B", id: "t2", createdAt: 200 },
      { eventType: "POINT_TEAM_A", id: "t1", createdAt: 100 },
      { eventType: "POINT_TEAM_A", id: "t3", createdAt: 300 }
    ];
    events.sort((a, b) => a.createdAt - b.createdAt);
    const s = replayEvents(events);
    expect(s.A.points).toBe(2);
    expect(s.B.points).toBe(1);
    expect(s.lastPointTeam).toBe("A");
  });
});

describe("Edge cases", () =>
{
  test("unknown event types are ignored gracefully", () =>
  {
    let s = defaultScore();
    s = applyEvent(s, { eventType: "POINT_TEAM_A", id: "e1" });
    s = applyEvent(s, { eventType: "UNKNOWN_EVENT", id: "e2" });
    expect(s.A.points).toBe(1);
    expect(s.history.length).toBe(1);
  });

  test("undo more times than points scored is safe", () =>
  {
    let s = defaultScore();
    s = applyEvent(s, { eventType: "POINT_TEAM_A", id: "e1" });
    s = applyEvent(s, { eventType: "UNDO", id: "u1" });
    s = applyEvent(s, { eventType: "UNDO", id: "u2" });
    s = applyEvent(s, { eventType: "UNDO", id: "u3" });
    expect(s.A.points).toBe(0);
    expect(s.B.points).toBe(0);
    expect(s.matchComplete).toBe(false);
  });

  test("reset followed by undo does nothing (no history after reset)", () =>
  {
    let s = defaultScore();
    s = awardPoints(s, "A", 5);
    s = applyEvent(s, { eventType: "RESET", id: "r1" });
    s = applyEvent(s, { eventType: "UNDO", id: "u1" });
    expect(s.A.points).toBe(0);
  });

  test("tiebreakTen: no more points after match completion", () =>
  {
    const options = { scoringMode: "tiebreakTen", deuceMode: "standard", tiebreakMode: "sixAllSeven" };
    let s = defaultScore(options);
    s = awardPoints(s, "A", 10, options);
    expect(s.matchComplete).toBe(true);
    const before = s.A.points;
    s = applyEvent(s, { eventType: "POINT_TEAM_A", id: "extra" }, options);
    expect(s.A.points).toBe(before);
  });

  test("straight points: never completes match regardless of score", () =>
  {
    const options = { scoringMode: "straight", deuceMode: "standard", tiebreakMode: "sixAllSeven" };
    let s = defaultScore(options);
    s = awardPoints(s, "A", 200, options);
    expect(s.matchComplete).toBe(false);
    expect(s.A.points).toBe(200);
  });

  test("standard scoring after tiebreak set continues to next set", () =>
  {
    let s = defaultScore();
    for (let i = 0; i < 6; i++)
    {
      s = winGame(s, "A");
      s = winGame(s, "B");
    }
    s = awardPoints(s, "A", 7);
    expect(s.A.sets).toBe(1);
    expect(s.matchComplete).toBe(false);
    s = applyEvent(s, { eventType: "POINT_TEAM_B", id: "next" });
    expect(s.B.points).toBe(1);
  });

  test("undo during tiebreak reverts tiebreak point", () =>
  {
    let s = defaultScore();
    for (let i = 0; i < 6; i++)
    {
      s = winGame(s, "A");
      s = winGame(s, "B");
    }
    s = applyEvent(s, { eventType: "POINT_TEAM_A", id: "tb1" });
    expect(s.inTiebreak).toBe(true);
    expect(s.A.points).toBe(1);
    s = applyEvent(s, { eventType: "UNDO", id: "u1" });
    expect(s.A.points).toBe(0);
    expect(s.A.games).toBe(6);
  });
});

// -----------------------------------------------------------------------
// Regression: undo must still work for the very point that just completed
// a set. The backend previously restarted replay from a set-completion
// checkpoint whose history was stripped (see toLiveScorePayload), which
// left the undo stack empty right at that boundary and silently broke
// undo. The fix always replays from the full event log so history is
// intact, which is what these tests simulate.
// -----------------------------------------------------------------------
describe("Undo immediately after a set-completing point (checkpoint boundary)", () =>
{
  test("undo right after the point that wins a set reverts that point", () =>
  {
    let s = defaultScore();
    // Win 5 games for A, 0 for B, then win the 6th game with the final point
    // being the one that completes the set - this mirrors the checkpoint
    // write boundary in functions/index.js.
    for (let i = 0; i < 5; i++)
    {
      s = winGame(s, "A");
    }
    expect(s.A.games).toBe(5);
    expect(s.A.sets).toBe(0);

    // Three points to reach game point, then the set-winning point.
    s = awardPoints(s, "A", 3);
    s = applyEvent(s, { eventType: "POINT_TEAM_A", id: "set-winning-point" });
    expect(s.A.sets).toBe(1);
    expect(s.A.games).toBe(0); // games reset after set completion

    s = applyEvent(s, { eventType: "UNDO", id: "undo-set-win" });

    // Undo restores the exact pre-point state: the game hadn't been won yet.
    expect(s.A.sets).toBe(0);
    expect(s.A.games).toBe(5);
    expect(s.A.points).toBe(3);
  });

  test("full replay (as used by the backend's excluding-replay path) preserves history across a set boundary", () =>
  {
    const events = [];
    let s = defaultScore();
    let idx = 0;

    for (let g = 0; g < 5; g++)
    {
      for (let p = 0; p < 4; p++)
      {
        events.push({ eventType: "POINT_TEAM_A", id: `e${idx++}` });
      }
    }
    for (let p = 0; p < 4; p++)
    {
      events.push({ eventType: "POINT_TEAM_A", id: `e${idx++}` });
    }

    // Replay everything (mirrors replayScoreFromEventsExcluding with no checkpoint shortcut).
    s = replayEvents(events);
    expect(s.A.sets).toBe(1);

    // The next event is an UNDO of the last (set-winning) point - history must not be empty.
    const undone = applyEvent(s, { eventType: "UNDO", id: "u-final" });
    expect(undone.A.sets).toBe(0);
    expect(undone.A.games).toBe(5);
  });
});

// -----------------------------------------------------------------------
// matchComplete only has meaning in tiebreakTen mode. Standard and straight
// modes have no fixed set/point target (a match can go on indefinitely), so a
// stale flag - e.g. persisted before a scoring-mode change - must never block
// or end scoring in those modes.
// -----------------------------------------------------------------------
describe("matchComplete is only considered in tiebreakTen mode", () =>
{
  const STRAIGHT_OPTIONS = { scoringMode: "straight", deuceMode: "standard", tiebreakMode: "sixAllSeven" };
  const TIEBREAK_TEN_OPTIONS = { scoringMode: "tiebreakTen", deuceMode: "standard", tiebreakMode: "sixAllSeven" };

  test("a stale matchComplete flag does not block points in standard mode", () =>
  {
    let s = defaultScore();
    s.matchComplete = true; // e.g. left over from a scoring-mode change
    s = applyEvent(s, { eventType: "POINT_TEAM_A", id: "e1" });
    expect(s.A.points).toBe(1);
    expect(s.A.totalPoints).toBe(1);
    expect(s.matchComplete).toBe(false);
  });

  test("a stale matchComplete flag does not block points in straight mode", () =>
  {
    let s = defaultScore(STRAIGHT_OPTIONS);
    s.matchComplete = true;
    s = applyEvent(s, { eventType: "POINT_TEAM_B", id: "e1" }, STRAIGHT_OPTIONS);
    expect(s.B.points).toBe(1);
    expect(s.matchComplete).toBe(false);
  });

  test("undo normalization clears a stale matchComplete flag outside tiebreakTen", () =>
  {
    let s = defaultScore();
    s.matchComplete = true;
    s = applyEvent(s, { eventType: "UNDO", id: "u1" });
    expect(s.matchComplete).toBe(false);
  });

  test("switching a completed tiebreakTen score to another mode clears matchComplete and resumes scoring", () =>
  {
    let s = defaultScore(TIEBREAK_TEN_OPTIONS);
    s = awardPoints(s, "A", 10, TIEBREAK_TEN_OPTIONS);
    expect(s.matchComplete).toBe(true);

    s = applyEvent(s, { eventType: "POINT_TEAM_B", id: "e1" }, DEFAULT_SCORING_OPTIONS);
    expect(s.matchComplete).toBe(false);
    expect(s.B.points).toBe(1);
  });

  test("tiebreakTen still completes the match and blocks further points", () =>
  {
    let s = defaultScore(TIEBREAK_TEN_OPTIONS);
    s = awardPoints(s, "A", 10, TIEBREAK_TEN_OPTIONS);
    expect(s.matchComplete).toBe(true);

    s = applyEvent(s, { eventType: "POINT_TEAM_B", id: "blocked" }, TIEBREAK_TEN_OPTIONS);
    expect(s.B.points).toBe(0);
    expect(s.B.totalPoints).toBe(0);
    expect(s.matchComplete).toBe(true);
  });

  test("replaying a long rally under standard mode never drops events to a stale completion", () =>
  {
    // 8 points for A then 4 for B; under standard every event must count
    // towards totalPoints (nothing swallowed by an early "match complete").
    const events = [];
    for (let i = 0; i < 8; i++) events.push({ eventType: "POINT_TEAM_A", id: `a${i}` });
    for (let i = 0; i < 4; i++) events.push({ eventType: "POINT_TEAM_B", id: `b${i}` });

    const s = replayEvents(events, DEFAULT_SCORING_OPTIONS);
    expect(s.A.totalPoints).toBe(8);
    expect(s.B.totalPoints).toBe(4);
    expect(s.matchComplete).toBe(false);
  });

  test("replaying the same rally under straight mode counts every event too", () =>
  {
    const events = [];
    for (let i = 0; i < 8; i++) events.push({ eventType: "POINT_TEAM_A", id: `a${i}` });
    for (let i = 0; i < 4; i++) events.push({ eventType: "POINT_TEAM_B", id: `b${i}` });

    const s = replayEvents(events, STRAIGHT_OPTIONS);
    expect(s.A.points).toBe(8);
    expect(s.B.points).toBe(4);
    expect(s.matchComplete).toBe(false);
  });
});

describe("toLiveScorePayload", () =>
{
  test("strips history but keeps all other fields", () =>
  {
    let s = defaultScore();
    s = applyEvent(s, { eventType: "POINT_TEAM_A", id: "e1" });
    expect(s.history.length).toBeGreaterThan(0);

    const payload = toLiveScorePayload(s);
    expect(payload.history).toBeUndefined();
    expect(payload.A.points).toBe(s.A.points);
    expect(payload.lastPointTeam).toBe(s.lastPointTeam);
  });

  test("passes through non-object values unchanged", () =>
  {
    expect(toLiveScorePayload(null)).toBeNull();
    expect(toLiveScorePayload(undefined)).toBeUndefined();
  });
});

describe("compareEventOrder", () =>
{
  test("returns null when either side is missing timestamp ordering info", () =>
  {
    expect(compareEventOrder(null, "a", { seconds: 1, nanoseconds: 0 }, "b")).toBeNull();
    expect(compareEventOrder({ seconds: 1, nanoseconds: 0 }, "a", null, "b")).toBeNull();
  });

  test("orders by seconds first", () =>
  {
    const earlier = { seconds: 100, nanoseconds: 0 };
    const later = { seconds: 200, nanoseconds: 0 };
    expect(compareEventOrder(earlier, "a", later, "b")).toBeLessThan(0);
    expect(compareEventOrder(later, "a", earlier, "b")).toBeGreaterThan(0);
  });

  test("falls back to nanoseconds when seconds tie", () =>
  {
    const earlier = { seconds: 100, nanoseconds: 10 };
    const later = { seconds: 100, nanoseconds: 20 };
    expect(compareEventOrder(earlier, "a", later, "b")).toBeLessThan(0);
  });

  test("falls back to document id when timestamps tie exactly", () =>
  {
    const ts = { seconds: 100, nanoseconds: 10 };
    expect(compareEventOrder(ts, "a", ts, "b")).toBeLessThan(0);
    expect(compareEventOrder(ts, "b", ts, "a")).toBeGreaterThan(0);
    expect(compareEventOrder(ts, "a", ts, "a")).toBe(0);
  });

  test("still orders by timestamp when one side is missing a document id", () =>
  {
    const earlier = { seconds: 100, nanoseconds: 0 };
    const later = { seconds: 101, nanoseconds: 0 };
    expect(compareEventOrder(earlier, null, later, "b")).toBeLessThan(0);
    expect(compareEventOrder(later, "a", earlier, null)).toBeGreaterThan(0);
  });

  test("returns null when exact timestamp ties cannot be broken without ids", () =>
  {
    const ts = { seconds: 100, nanoseconds: 10 };
    expect(compareEventOrder(ts, null, ts, "b")).toBeNull();
    expect(compareEventOrder(ts, "a", ts, null)).toBeNull();
  });
});

describe("scoreEquivalent", () =>
{
  test("returns false when either score is missing", () =>
  {
    expect(scoreEquivalent(null, defaultScore())).toBe(false);
    expect(scoreEquivalent(defaultScore(), null)).toBe(false);
  });

  test("returns true for two independently built but identical scores", () =>
  {
    const a = awardPoints(defaultScore(), "A", 3);
    const b = awardPoints(defaultScore(), "A", 3);
    expect(scoreEquivalent(a, b)).toBe(true);
  });

  test("returns false when completed set counts differ", () =>
  {
    const a = winSet60(defaultScore(), "A");
    const b = defaultScore();
    expect(scoreEquivalent(a, b)).toBe(false);
  });

  test("returns false when points differ", () =>
  {
    const a = awardPoints(defaultScore(), "A", 2);
    const b = awardPoints(defaultScore(), "A", 1);
    expect(scoreEquivalent(a, b)).toBe(false);
  });
});

describe("didSetCountIncrease", () =>
{
  test("false when no set was completed", () =>
  {
    const before = defaultScore();
    const after = awardPoints(defaultScore(), "A", 2);
    expect(didSetCountIncrease(before, after)).toBe(false);
  });

  test("true when a set was completed", () =>
  {
    const before = defaultScore();
    const after = winSet60(defaultScore(), "A");
    expect(didSetCountIncrease(before, after)).toBe(true);
  });

  test("handles missing/undefined scores safely", () =>
  {
    expect(didSetCountIncrease(undefined, undefined)).toBe(false);
    expect(didSetCountIncrease(null, defaultScore())).toBe(false);
  });
});
