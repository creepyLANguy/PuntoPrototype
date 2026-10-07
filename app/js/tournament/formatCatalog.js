// Tournament format catalogue for the setup wizard: labels, entry model and
// the format-specific settings each format exposes (spec sections 3, 10-20
// and 35 step 3). Only relevant options are rendered for a format; the server
// normalises and validates the final configuration.

const SOCIAL_SCORING_FIELDS = [
  {
    key: "scoring.pointsTarget",
    label: "Total points per match",
    type: "number",
    min: 4,
    max: 200,
    value: 36,
  },
  {
    key: "scoring.serveBlockLength",
    label: "Consecutive serves",
    type: "number",
    min: 1,
    max: 10,
    value: 1,
  },
  {
    key: "scoring.sideSwapRule",
    label: "Side swap",
    type: "select",
    value: "after_all_players_serve_once",
    options: [
      ["after_all_players_serve_once", "After all players serve once"],
      ["none", "No automatic swap"],
    ],
  },
  {
    key: "scoring.tieResolution",
    label: "Tie at the target",
    type: "select",
    value: "allow_draw",
    options: [
      ["allow_draw", "Allow a draw"],
      ["golden_point", "Golden point decides"],
    ],
  },
];

const MATCH_SCORING_FIELDS = [
  {
    key: "scoring.scoringMode",
    label: "Match scoring",
    type: "select",
    value: "standard",
    options: [
      ["standard", "Games and sets"],
      ["tiebreakTen", "Single tie-break to 10"],
      ["straight", "Straight points"],
      ["fixedTotalPoints", "Fixed total points"],
    ],
  },
  {
    key: "scoring.deuceMode",
    label: "Deuce",
    type: "select",
    value: "golden",
    showIf: ["scoring.scoringMode", "standard"],
    options: [
      ["golden", "Golden point"],
      ["standard", "Advantage"],
      ["silver", "Silver point"],
      ["star", "Star point"],
    ],
  },
  {
    key: "scoring.tiebreakMode",
    label: "Tie-break",
    type: "select",
    value: "sixAllSeven",
    showIf: ["scoring.scoringMode", "standard"],
    options: [
      ["sixAllSeven", "At 6-6, first to 7"],
      ["sixAllTen", "At 6-6, first to 10"],
      ["off", "No tie-break"],
    ],
  },
  {
    key: "scoring.pointsTarget",
    label: "Total points per match",
    type: "number",
    min: 4,
    max: 200,
    value: 24,
    showIf: ["scoring.scoringMode", "fixedTotalPoints"],
  },
];

const LEAGUE_POINT_FIELDS = [
  {
    key: "pointsForWin",
    label: "Points for a win",
    type: "number",
    min: 0,
    max: 10,
    value: 3,
  },
  {
    key: "pointsForDraw",
    label: "Points for a draw",
    type: "number",
    min: 0,
    max: 10,
    value: 1,
  },
];

const DRAW_FIELD = {
  key: "draw",
  label: "Draw",
  type: "select",
  value: "seeded",
  options: [
    ["seeded", "Seeded"],
    ["random", "Random"],
  ],
};

export const FORMATS = [
  {
    id: "americano",
    label: "Americano",
    entry: "individual",
    summary:
      "Rotating partners every round. Everyone collects the points they win.",
    fields: [
      ...SOCIAL_SCORING_FIELDS,
      {
        key: "mixed",
        label: "Mixed (one man and one woman per side)",
        type: "checkbox",
        value: false,
      },
    ],
  },
  {
    id: "mexicano",
    label: "Mexicano",
    entry: "individual",
    summary:
      "Like Americano, but each round pairs players by the current standings.",
    fields: [
      ...SOCIAL_SCORING_FIELDS,
      {
        key: "initialDraw",
        label: "First round",
        type: "select",
        value: "seeded",
        options: [
          ["seeded", "By seed"],
          ["random", "Random"],
        ],
      },
    ],
  },
  {
    id: "teamAmericano",
    label: "Team Americano",
    entry: "team",
    summary:
      "Fixed pairs, rotating opponents. Teams collect the points they win.",
    fields: SOCIAL_SCORING_FIELDS,
  },
  {
    id: "teamMexicano",
    label: "Team Mexicano",
    entry: "team",
    summary:
      "Fixed pairs; each round pairs teams that are close in the standings.",
    fields: SOCIAL_SCORING_FIELDS,
  },
  {
    id: "roundRobin",
    label: "Round Robin",
    entry: "team",
    summary: "Every pair plays every other pair once.",
    fields: [
      ...MATCH_SCORING_FIELDS,
      ...LEAGUE_POINT_FIELDS,
      {
        key: "scheduleMode",
        label: "Schedule",
        type: "select",
        value: "full",
        options: [
          ["full", "Generate the full schedule"],
          ["roundByRound", "One round at a time"],
        ],
      },
    ],
  },
  {
    id: "swiss",
    label: "Swiss",
    entry: "team",
    summary:
      "Each round pairs teams with similar records; nobody is eliminated.",
    fields: [
      ...MATCH_SCORING_FIELDS,
      ...LEAGUE_POINT_FIELDS,
      {
        key: "roundCount",
        label: "Number of rounds (blank = automatic)",
        type: "number",
        min: 1,
        max: 20,
        value: "",
      },
      {
        key: "useBuchholz",
        label: "Use opponent strength (Buchholz) as a tie-break",
        type: "checkbox",
        value: true,
      },
    ],
  },
  {
    id: "singleElimination",
    label: "Single Elimination",
    entry: "team",
    summary: "Knockout bracket: one loss and you are out.",
    fields: [
      ...MATCH_SCORING_FIELDS,
      DRAW_FIELD,
      {
        key: "thirdPlaceMatch",
        label: "Play a third-place match",
        type: "checkbox",
        value: false,
      },
    ],
  },
  {
    id: "doubleElimination",
    label: "Double Elimination",
    entry: "team",
    summary: "Winners and losers brackets: two losses and you are out.",
    fields: [
      ...MATCH_SCORING_FIELDS,
      DRAW_FIELD,
      {
        key: "grandFinalReset",
        label: "Reset final if the losers-bracket team wins",
        type: "checkbox",
        value: true,
      },
    ],
  },
  {
    id: "groupKnockout",
    label: "Groups + Knockout",
    entry: "team",
    summary: "Round-robin groups, then a knockout bracket for the qualifiers.",
    fields: [
      ...MATCH_SCORING_FIELDS,
      ...LEAGUE_POINT_FIELDS,
      {
        key: "groupCount",
        label: "Number of groups",
        type: "number",
        min: 1,
        max: 16,
        value: 2,
      },
      {
        key: "advancePerGroup",
        label: "Qualifiers per group",
        type: "number",
        min: 1,
        max: 8,
        value: 2,
      },
      {
        key: "thirdPlaceMatch",
        label: "Play a third-place match",
        type: "checkbox",
        value: false,
      },
    ],
  },
  {
    id: "kingCourt",
    label: "King / Queen of the Court",
    entry: "either",
    summary:
      "Short rounds on ranked courts: winners move up, losers move down.",
    fields: [
      ...MATCH_SCORING_FIELDS,
      {
        key: "courtCount",
        label: "Courts in the ladder",
        type: "number",
        min: 1,
        max: 32,
        value: 2,
      },
      {
        key: "roundDurationMinutes",
        label: "Round length (minutes)",
        type: "number",
        min: 1,
        max: 180,
        value: 12,
      },
      {
        key: "tieBehaviour",
        label: "If a round is tied",
        type: "select",
        value: "higher_seed_wins",
        options: [
          ["higher_seed_wins", "Higher seed moves up"],
          ["stay", "Both sides stay"],
        ],
      },
      {
        key: "scoringMethod",
        label: "Ranking points",
        type: "select",
        value: "courtPoints",
        options: [
          ["courtPoints", "Points by court level won"],
          ["rallyPoints", "Rally points won"],
        ],
      },
      {
        key: "finalRanking",
        label: "Final ranking",
        type: "select",
        value: "courtPosition",
        options: [
          ["courtPosition", "Final court position"],
          ["points", "Total points"],
        ],
      },
    ],
  },
];

export function getFormatEntry(formatId) {
  return FORMATS.find((format) => format.id === formatId) || FORMATS[0];
}

export function isFieldVisible(field, values) {
  if (!field.showIf) return true;
  const [key, expected] = field.showIf;
  return String(values[key] ?? "") === expected;
}

// Flat "a.b" field values -> nested config object, typed per field.
export function buildFormatConfig(formatId, values) {
  const format = getFormatEntry(formatId);
  const config = {};
  format.fields.forEach((field) => {
    if (!isFieldVisible(field, values)) return;
    let value = values[field.key] ?? field.value;
    if (field.type === "number") {
      if (value === "" || value === null) return;
      value = Number(value);
      if (!Number.isFinite(value)) return;
    }
    if (field.type === "checkbox") value = Boolean(value);
    const path = field.key.split(".");
    let target = config;
    path.slice(0, -1).forEach((segment) => {
      target[segment] = target[segment] || {};
      target = target[segment];
    });
    target[path[path.length - 1]] = value;
  });
  return config;
}

export function defaultFieldValues(formatId) {
  return Object.fromEntries(
    getFormatEntry(formatId).fields.map((field) => [field.key, field.value]),
  );
}

// Team rows typed by hosts: "Alice & Ben", "Alice / Ben" or "Team name: Alice, Ben".
export function parseTeamLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const named = line.match(/^([^:]+):\s*(.+)$/);
      const name = named ? named[1].trim() : "";
      const players = (named ? named[2] : line)
        .split(/\s*(?:&|\/|,|\+| and )\s*/i)
        .map((p) => p.trim())
        .filter(Boolean);
      return { name, players };
    });
}

export function parsePlayerLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}
