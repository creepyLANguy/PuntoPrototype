const {
  defaultScore,
  applyEvent,
  replayEvents,
  normalizeScoringOptions,
  getCurrentServerLabel,
  getMatchResult,
  toLiveScorePayload,
} = require("./scoringEngine");
const { buildScoringOptions } = require("./domain/scoring/modes");

const AMERICANO_36 = {
  scoringMode: "fixedTotalPoints",
  pointsTarget: 36,
  serving: {
    enabled: true,
    order: ["A1", "B1", "A2", "B2"],
    serveBlockLength: 1,
    sideSwapRule: "after_all_players_serve_once",
  },
  completion: { rule: "exact_total_points", tieResolution: "allow_draw" },
};

function points(sequence) {
  return [...sequence].map((team, index) => ({
    id: `e${String(index).padStart(3, "0")}`,
    eventType: team === "A" ? "POINT_TEAM_A" : "POINT_TEAM_B",
  }));
}

function play(sequence, options = AMERICANO_36) {
  return replayEvents(points(sequence), options);
}

describe("fixedTotalPoints scoring profile", () => {
  test("normalises a complete configuration snapshot", () => {
    const options = normalizeScoringOptions(AMERICANO_36);
    expect(options.scoringMode).toBe("fixedTotalPoints");
    expect(options.pointsTarget).toBe(36);
    expect(options.serving).toEqual(AMERICANO_36.serving);
    expect(options.completion).toEqual(AMERICANO_36.completion);
  });

  test("fills defaults and rejects invalid serve orders", () => {
    const options = normalizeScoringOptions({
      scoringMode: "fixedTotalPoints",
      serving: { order: ["A1", "A1", "B1", "B2"], sideSwapRule: "sometimes" },
      completion: { tieResolution: "coin_toss" },
    });
    expect(options.pointsTarget).toBe(36);
    expect(options.serving.order).toEqual(["A1", "B1", "A2", "B2"]);
    expect(options.serving.sideSwapRule).toBe("after_all_players_serve_once");
    expect(options.completion.tieResolution).toBe("allow_draw");
  });

  test("normalizes the changeover rule and swaps sides after each serve cycle", () => {
    const options = normalizeScoringOptions({
      ...AMERICANO_36,
      serving: { ...AMERICANO_36.serving, sideSwapRule: "after_all_players_serve_once" },
    });
    expect(options.serving.sideSwapRule).toBe("after_all_players_serve_once");
    expect(play("ABBA", options).fixedTotal.sideSwapCycles).toBe(1);
  });

  test("does not accept the legacy side-swap rule", () => {
    const options = normalizeScoringOptions({
      ...AMERICANO_36,
      serving: { ...AMERICANO_36.serving, sideSwapRule: "after_each_player_serves_once" },
    });
    expect(options.serving.sideSwapRule).toBe("after_all_players_serve_once");
  });

  test("other modes preserve the fixed profile for later reuse", () => {
    const options = normalizeScoringOptions({ ...AMERICANO_36, scoringMode: "standard" });
    expect(options.pointsTarget).toBe(36);
    expect(options.serving.serveBlockLength).toBe(1);
    expect(options.serving).not.toHaveProperty("servesPerPlayer");
  });

  test("legacy servesPerPlayer is ignored and never emitted", () => {
    const options = normalizeScoringOptions({
      ...AMERICANO_36,
      serving: { ...AMERICANO_36.serving, servesPerPlayer: 99 },
    });
    expect(options.serving).not.toHaveProperty("servesPerPlayer");
    expect(options.serving.serveBlockLength).toBe(1);
  });

  test("buildScoringOptions keeps top-level fixed-total fields", () => {
    const options = buildScoringOptions({ ...AMERICANO_36, pointsTarget: 24 });
    expect(options.scoringMode).toBe("fixedTotalPoints");
    expect(options.pointsTarget).toBe(24);
  });

  test("ends on exactly 36 rally points with a 19-17 result", () => {
    const score = play("A".repeat(19) + "B".repeat(17));
    expect(score.matchComplete).toBe(true);
    expect(score.A.points + score.B.points).toBe(36);
    expect(score.result).toBe("A");
    expect(getMatchResult(score)).toMatchObject({ winner: "A", points: { A: 19, B: 17 } });
  });

  test("allows an 18-18 draw", () => {
    const score = play("AB".repeat(18));
    expect(score.matchComplete).toBe(true);
    expect(score.result).toBe("draw");
    expect(getMatchResult(score).winner).toBe("draw");
    expect(score.A.sets + score.B.sets).toBe(0);
  });

  test("ignores points after completion", () => {
    const score = play("A".repeat(24) + "B".repeat(12) + "BBB");
    expect(score.A.points).toBe(24);
    expect(score.B.points).toBe(12);
  });

  test("golden point resolves a tie with one deciding rally", () => {
    const options = { ...AMERICANO_36, completion: { tieResolution: "golden_point" } };
    const tied = play("AB".repeat(18), options);
    expect(tied.matchComplete).toBe(false);
    const decided = applyEvent(tied, { id: "z", eventType: "POINT_TEAM_B" }, options);
    expect(decided.matchComplete).toBe(true);
    expect(decided.result).toBe("B");
  });

  test("rotates one serve per player A1 -> B1 -> A2 -> B2", () => {
    const servers = [];
    let score = defaultScore(AMERICANO_36);
    for (let i = 0; i < 8; i++) {
      servers.push(getCurrentServerLabel(score));
      score = applyEvent(score, { id: `p${i}`, eventType: "POINT_TEAM_A" }, AMERICANO_36);
    }
    expect(servers).toEqual(["A1", "B1", "A2", "B2", "A1", "B1", "A2", "B2"]);
  });

  test("serve block length 3 gives each player three consecutive serves", () => {
    const options = {
      ...AMERICANO_36,
      serving: { ...AMERICANO_36.serving, serveBlockLength: 3 },
    };
    const servers = [];
    let score = defaultScore(options);
    for (let i = 0; i < 12; i++) {
      servers.push(getCurrentServerLabel(score));
      score = applyEvent(score, { id: `p${i}`, eventType: "POINT_TEAM_A" }, options);
    }
    expect(servers).toEqual([
      "A1",
      "A1",
      "A1",
      "B1",
      "B1",
      "B1",
      "A2",
      "A2",
      "A2",
      "B2",
      "B2",
      "B2",
    ]);
  });

  test("serve block length 2 gives each player two consecutive serves", () => {
    const options = { ...AMERICANO_36, serving: { ...AMERICANO_36.serving, serveBlockLength: 2 } };
    const servers = [];
    let score = defaultScore(options);
    for (let i = 0; i < 8; i++) {
      servers.push(getCurrentServerLabel(score));
      score = applyEvent(score, { id: `p${i}`, eventType: "POINT_TEAM_B" }, options);
    }
    expect(servers).toEqual(["A1", "A1", "B1", "B1", "A2", "A2", "B2", "B2"]);
  });

  test("tracks block-derived serve counts and changeovers after every full cycle", () => {
    const score = play("ABBA".repeat(4) + "AB");
    expect(score.fixedTotal.rallyPoints).toBe(18);
    expect(score.fixedTotal.servesCompleted).toEqual({ A1: 5, B1: 5, A2: 4, B2: 4 });
    expect(score.fixedTotal.sideSwapCycles).toBe(4);
    expect(score.fixedTotal.sidesSwapped).toBe(false);
    expect(score.fixedTotal.currentServer).toBe("A2");
    expect(score.fixedTotal.remainingPoints).toBe(18);

    const afterFive = play("AAAAA");
    expect(afterFive.fixedTotal.sideSwapCycles).toBe(1);
    expect(afterFive.fixedTotal.sidesSwapped).toBe(true);
  });

  test("four serves each across a 16 point match", () => {
    const options = { ...AMERICANO_36, pointsTarget: 16 };
    const score = play("A".repeat(9) + "B".repeat(7), options);
    expect(score.matchComplete).toBe(true);
    expect(score.fixedTotal.servesCompleted).toEqual({ A1: 4, B1: 4, A2: 4, B2: 4 });
  });

  test("no changeovers when the rule is none", () => {
    const options = { ...AMERICANO_36, serving: { ...AMERICANO_36.serving, sideSwapRule: "none" } };
    const score = play("A".repeat(12), options);
    expect(score.fixedTotal.sideSwapCycles).toBe(0);
  });

  test("undo reopens a completed match and restores the serve state", () => {
    const complete = play("A".repeat(19) + "B".repeat(17));
    const undone = applyEvent(complete, { id: "u", eventType: "UNDO" }, AMERICANO_36);
    expect(undone.matchComplete).toBe(false);
    expect(undone.result).toBeNull();
    expect(undone.B.points).toBe(16);
    expect(undone.fixedTotal.rallyPoints).toBe(35);
  });

  test("live payload persists the configuration snapshot and serve state", () => {
    const payload = toLiveScorePayload(play("AB"));
    expect(payload.history).toBeUndefined();
    expect(payload.scoringOptions.pointsTarget).toBe(36);
    expect(payload.fixedTotal.currentServer).toBe("A2");
  });

  test("serving can be disabled", () => {
    const options = { ...AMERICANO_36, serving: { ...AMERICANO_36.serving, enabled: false } };
    expect(getCurrentServerLabel(defaultScore(options))).toBeNull();
  });
});

describe("getMatchResult", () => {
  test("standard mode compares sets, then games, then points", () => {
    const options = { scoringMode: "standard", deuceMode: "golden", tiebreakMode: "sixAllSeven" };
    const oneSet = replayEvents(points("AAAA".repeat(6)), options);
    expect(getMatchResult(oneSet)).toMatchObject({ winner: "A", sets: { A: 1, B: 0 } });

    const gamesOnly = replayEvents(points("BBBB"), options);
    expect(getMatchResult(gamesOnly)).toMatchObject({ winner: "B", games: { A: 0, B: 1 } });

    expect(getMatchResult(defaultScore(options)).winner).toBe("draw");
  });

  test("straight mode compares points", () => {
    const score = replayEvents(points("AAB"), { scoringMode: "straight" });
    expect(getMatchResult(score)).toMatchObject({ winner: "A", points: { A: 2, B: 1 } });
  });
});
