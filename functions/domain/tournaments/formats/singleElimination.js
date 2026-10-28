const {
  baseRound,
  calculateRoundResult,
  createRng,
  nextRoundNumber,
  seedFor,
} = require("./shared");
const {
  advanceBracketState,
  bracketEntries,
  bracketStandings,
  makeByeOrScheduled,
  nextPowerOfTwo,
  roundLabel,
  seedOrder,
  setFeed,
  sideFromTeam,
} = require("./bracketHelpers");
const { TournamentDomainError } = require("../errors");

const singleElimination = {
  id: "singleElimination",
  label: "Single Elimination",
  entryMode: "team",
  kind: "bracket",
  supportsNextRound: false,
  defaultConfig: () => ({ draw: "seeded", thirdPlaceMatch: false }),
  normalizeConfig(config = {}) {
    return {
      draw: config.draw === "random" ? "random" : "seeded",
      thirdPlaceMatch: Boolean(config.thirdPlaceMatch),
    };
  },
  validateConfig() {
    return { errors: [], warnings: [] };
  },
  validateParticipants(state) {
    const active = (state.teams || []).filter((team) => team.status === "active");
    return {
      errors:
        active.length < 2
          ? [{ code: "INSUFFICIENT_TEAMS", message: "Single elimination needs at least 2 teams." }]
          : [],
      warnings: [],
    };
  },
  generateInitialRound(state) {
    return generateBracket(state);
  },
  generateNextRound() {
    throw new TournamentDomainError(
      "NEXT_ROUND_NOT_AVAILABLE",
      "Single elimination bracket is generated up front.",
    );
  },
  canGenerateNextRound() {
    return { allowed: false, reason: "Single elimination bracket is generated up front." };
  },
  calculateStandings: bracketStandings,
  calculateFinalStandings: bracketStandings,
  calculateRoundResult,
  getRulesSummary(config) {
    const cfg = this.normalizeConfig(config);
    return {
      title: "SINGLE ELIMINATION",
      lines: [
        "One loss eliminates a team",
        `${cfg.draw} draw`,
        cfg.thirdPlaceMatch ? "Includes third-place match" : "No third-place match",
      ],
    };
  },
  generateBracket,
  advanceBracket(state, completedFixtureId) {
    return advanceBracketState(state, completedFixtureId);
  },
};

function generateBracket(state) {
  const cfg = singleElimination.normalizeConfig(state.tournament?.format?.config || {});
  const firstRound = nextRoundNumber(state);
  const seed = seedFor(state, firstRound, ":single");
  const entries = bracketEntries(state, cfg.draw, createRng(seed));
  const size = nextPowerOfTwo(entries.length);
  const totalRounds = Math.log2(size);
  const slots = Array(size).fill(null);
  seedOrder(size).forEach((seedNumber, index) => {
    slots[index] = entries[seedNumber - 1] || null;
  });
  const rounds = [];
  const fixtures = [];
  const byPosition = {};
  let previousRoundPositions = [];

  for (let bracketRound = 1; bracketRound <= totalRounds; bracketRound += 1) {
    const roundNumber = firstRound + bracketRound - 1;
    const round = baseRound(
      roundNumber,
      roundLabel(totalRounds, bracketRound - 1, 0).replace(/ \d+$/, "s"),
      "knockout",
      seed,
      {
        algorithm: "single-elimination-v1",
        bracketRound,
      },
    );
    const matches = size / 2 ** bracketRound;
    const currentPositions = [];
    for (let index = 0; index < matches; index += 1) {
      const position = `KO-R${bracketRound}-M${index + 1}`;
      currentPositions.push(position);
      let sides;
      let sourceRefs = { A: null, B: null };
      if (bracketRound === 1) {
        sides = {
          A: slots[index * 2] ? sideFromTeam(slots[index * 2]) : null,
          B: slots[index * 2 + 1] ? sideFromTeam(slots[index * 2 + 1]) : null,
        };
      } else {
        const left = byPosition[previousRoundPositions[index * 2]];
        const right = byPosition[previousRoundPositions[index * 2 + 1]];
        sides = {
          A: left.status === "bye" ? left.sides.A || left.sides.B : null,
          B: right.status === "bye" ? right.sides.A || right.sides.B : null,
        };
        sourceRefs = {
          A: { fixtureId: left.fixtureId, outcome: "winner" },
          B: { fixtureId: right.fixtureId, outcome: "winner" },
        };
      }
      const fixture = makeByeOrScheduled({
        roundNumber,
        index,
        label: roundLabel(totalRounds, bracketRound - 1, index),
        stage: "knockout",
        sides,
        bracketPosition: position,
        sourceFixtureIds: [sourceRefs.A?.fixtureId, sourceRefs.B?.fixtureId].filter(Boolean),
        sourceRefs,
      });
      byPosition[position] = fixture;
      fixtures.push(fixture);
      if (bracketRound > 1) {
        setFeed(byPosition, previousRoundPositions[index * 2], "winner", fixture, "A");
        setFeed(byPosition, previousRoundPositions[index * 2 + 1], "winner", fixture, "B");
      }
    }
    if (bracketRound === totalRounds && cfg.thirdPlaceMatch && totalRounds >= 2) {
      const semifinals = previousRoundPositions.map((position) => byPosition[position]);
      if (
        semifinals.length === 2 &&
        semifinals.every((fixture) =>
          fixture && fixture.status !== "bye" && fixture.sides?.A && fixture.sides?.B
        )
      ) {
        const thirdPlace = makeByeOrScheduled({
          roundNumber,
          index: matches,
          label: "Third-place match",
          stage: "thirdPlace",
          sides: { A: null, B: null },
          bracketPosition: "KO-3P",
          sourceFixtureIds: semifinals.map((fixture) => fixture.fixtureId),
          sourceRefs: {
            A: { fixtureId: semifinals[0].fixtureId, outcome: "loser" },
            B: { fixtureId: semifinals[1].fixtureId, outcome: "loser" },
          },
        });
        byPosition["KO-3P"] = thirdPlace;
        fixtures.push(thirdPlace);
        setFeed(byPosition, previousRoundPositions[0], "loser", thirdPlace, "A");
        setFeed(byPosition, previousRoundPositions[1], "loser", thirdPlace, "B");
      }
    }
    round.fixtureIds = fixtures
      .filter((fixture) => fixture.roundNumber === roundNumber)
      .map((fixture) => fixture.fixtureId);
    rounds.push(round);
    previousRoundPositions = currentPositions;
  }
  return { rounds, fixtures };
}

module.exports = singleElimination;
