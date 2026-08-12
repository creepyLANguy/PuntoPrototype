const {
  DEFAULT_SCORING_OPTIONS,
  defaultScore,
  normalizeScoringOptions,
  applyEvent,
  replayEvents,
  getCompletedMatchGames,
  getGameServerLabel,
  getTiebreakServerLabel,
  getCurrentServerLabel
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
