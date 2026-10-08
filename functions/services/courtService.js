const { db, FieldValue } = require("../infrastructure/firebase");
const { allocateId } = require("./ids");
const { paths } = require("./firestorePaths");
const { invalid } = require("./errors");
const { buildScoringOptions } = require("../domain/scoring/modes");

function text(value, label, min, max) {
  if (typeof value !== "string") throw invalid(`${label} is required.`);
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max || /[<>\u0000-\u001f]/.test(normalized)) {
    throw invalid(`${label} must contain ${min}-${max} safe characters.`);
  }
  return normalized;
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalid(`${label} must be an object.`);
  }
}

function choice(value, values, label) {
  if (value !== undefined && !values.includes(value)) throw invalid(`Invalid ${label}.`);
}

function scoringInput(input) {
  const source = input.scoringOptions ?? {};
  object(source, "Scoring options");
  const allowed = [
    "scoringMode",
    "deuceMode",
    "tiebreakMode",
    "pointsTarget",
    "serving",
    "completion",
  ];
  if (Object.keys(source).some((key) => !allowed.includes(key))) {
    throw invalid("Unknown scoring option.");
  }
  const options = { ...source };
  for (const key of ["scoringMode", "deuceMode", "tiebreakMode"]) {
    if (input[key] !== undefined) options[key] = input[key];
  }
  choice(
    options.scoringMode,
    ["standard", "straight", "tiebreakTen", "fixedTotalPoints"],
    "scoring mode",
  );
  choice(options.deuceMode, ["standard", "golden", "silver", "star"], "deuce mode");
  choice(options.tiebreakMode, ["off", "sixAllSeven", "sixAllTen"], "tiebreak mode");
  if (
    options.pointsTarget !== undefined &&
    (!Number.isInteger(options.pointsTarget) ||
      options.pointsTarget < 1 ||
      options.pointsTarget > 500)
  ) {
    throw invalid("Invalid points target.");
  }
  if (options.serving !== undefined) {
    object(options.serving, "Serving options");
    const serving = options.serving;
    if (
      Object.keys(serving).some(
        (key) => !["enabled", "order", "serveBlockLength", "sideSwapRule"].includes(key),
      )
    ) {
      throw invalid("Unknown serving option.");
    }
    if (serving.enabled !== undefined && typeof serving.enabled !== "boolean")
      throw invalid("Invalid serving enabled flag.");
    if (
      serving.order !== undefined &&
      (!Array.isArray(serving.order) ||
        serving.order.length !== 4 ||
        !["A1", "A2", "B1", "B2"].every((slot) => serving.order.includes(slot)))
    ) {
      throw invalid("Invalid serving order.");
    }
    if (
      serving.serveBlockLength !== undefined &&
      (!Number.isInteger(serving.serveBlockLength) ||
        serving.serveBlockLength < 1 ||
        serving.serveBlockLength > 20)
    ) {
      throw invalid("Invalid serving block length.");
    }
    choice(serving.sideSwapRule, ["after_all_players_serve_once", "none"], "side swap rule");
  }
  if (options.completion !== undefined) {
    object(options.completion, "Completion options");
    if (Object.keys(options.completion).some((key) => !["rule", "tieResolution"].includes(key))) {
      throw invalid("Unknown completion option.");
    }
    choice(options.completion.rule, ["exact_total_points"], "completion rule");
    choice(options.completion.tieResolution, ["allow_draw", "golden_point"], "tie resolution");
  }
  return buildScoringOptions({ ...options, scoringOptions: options });
}

async function createCourt(input = {}) {
  object(input, "Court");
  if (input.courtId !== undefined) throw invalid("Court ids are allocated by the server.");
  const name = text(input.name, "Court name", 1, 80);
  const password = text(input.password, "Court password", 4, 128);
  if (password === name) throw invalid("Court password must differ from its name.");
  const status = input.status ?? "open";
  choice(status, ["open", "closed", "private"], "court status");
  const scoringOptions = scoringInput(input);
  if (input.beaconEnabled !== undefined && typeof input.beaconEnabled !== "boolean") {
    throw invalid("Invalid beacon enabled flag.");
  }
  return db.runTransaction(async (tx) => {
    const courtId = await allocateId(tx, "court");
    const timestamp = FieldValue.serverTimestamp();
    tx.create(db.doc(paths.court(courtId)), {
      name,
      password,
      status,
      scoringOptions,
      scoringMode: scoringOptions.scoringMode,
      activeMatchId: null,
      lastMatchId: null,
      clubId: null,
      beaconSidesSwapped: false,
      ...(input.beaconEnabled !== undefined ? { beaconEnabled: input.beaconEnabled } : {}),
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return { courtId };
  });
}

module.exports = { createCourt };
