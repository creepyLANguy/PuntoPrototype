// Pure tournament setup rules: input normalisation, lifecycle edit locks,
// bulk participant parsing and club-first court candidate ordering.
const { TournamentDomainError } = require("./errors");
const { getFormat } = require("./formats");

const TOURNAMENT_STATUSES = ["draft", "published", "live", "completed", "cancelled"];
const NAME_MAX = 80;
const DESCRIPTION_MAX = 500;
const PARTICIPANT_NAME_MAX = 40;
const SHORT_NAME_MAX = 16;
const MAX_PARTICIPANTS = 256;
const MAX_COURTS = 64;

const STATUS_TRANSITIONS = {
  draft: ["published", "cancelled"],
  published: ["live", "completed", "cancelled", "draft"],
  live: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

function fail(code, message, details) {
  throw new TournamentDomainError(code, message, details);
}

function cleanText(value, max) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function toPositiveInt(value, fallback, min = 0, max = 10000) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(number)));
}

function toEpochMs(value) {
  if (value == null || value === "") return null;
  const ms = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function normalizeScheduling(input = {}, previous = {}) {
  const merged = { ...previous, ...(input || {}) };
  return {
    timezone: cleanText(merged.timezone, 64) || "Africa/Johannesburg",
    startAt: toEpochMs(merged.startAt),
    plannedEndAt: toEpochMs(merged.plannedEndAt),
    defaultMatchDurationMinutes: toPositiveInt(merged.defaultMatchDurationMinutes, 20, 1, 600),
    defaultChangeoverMinutes: toPositiveInt(merged.defaultChangeoverMinutes, 3, 0, 120),
    targetRoundCount:
      merged.targetRoundCount == null || merged.targetRoundCount === ""
        ? null
        : toPositiveInt(merged.targetRoundCount, null, 1, 200),
  };
}

// Format config is normalised by the format module. The match scoring block
// is carried alongside for formats whose module does not own scoring, so the
// host's scoring choice is never dropped.
function normalizeFormat(input = {}) {
  const format = getFormat(input?.id);
  const rawConfig = input?.config || {};
  const config = format.normalizeConfig(rawConfig);
  if (config.scoring === undefined && rawConfig.scoring) {
    config.scoring = normalizeLeagueScoring(rawConfig.scoring);
  }
  return { id: format.id, version: 1, config };
}

const LEAGUE_SCORING_MODES = ["standard", "straight", "tiebreakTen", "fixedTotalPoints"];

function normalizeLeagueScoring(scoring = {}) {
  const scoringMode = LEAGUE_SCORING_MODES.includes(scoring.scoringMode)
    ? scoring.scoringMode
    : "standard";
  const normalized = { scoringMode };
  if (scoringMode === "standard") {
    normalized.deuceMode = ["standard", "golden", "silver", "star"].includes(scoring.deuceMode)
      ? scoring.deuceMode
      : "golden";
    normalized.tiebreakMode = ["off", "sixAllSeven", "sixAllTen"].includes(scoring.tiebreakMode)
      ? scoring.tiebreakMode
      : "sixAllSeven";
  }
  if (scoringMode === "fixedTotalPoints") {
    Object.assign(normalized, {
      pointsTarget: scoring.pointsTarget,
      servesPerPlayer: scoring.servesPerPlayer,
      serveOrder: scoring.serveOrder,
      serveBlockLength: scoring.serveBlockLength,
      sideSwapRule: scoring.sideSwapRule,
      tieResolution: scoring.tieResolution,
    });
  }
  return normalized;
}

function resolveParticipantMode(formatId, requested) {
  const format = getFormat(formatId);
  if (format.entryMode === "either") return requested === "individual" ? "individual" : "team";
  return format.entryMode;
}

function normalizeTournamentInput(input = {}, previous = null) {
  const name = cleanText(input.name ?? previous?.name, NAME_MAX);
  if (!name) fail("INVALID_NAME", "A tournament name is required.");

  const formatInput = input.format || previous?.format;
  if (!formatInput?.id) fail("INVALID_FORMAT", "Choose a tournament format.");
  const format = input.format ? normalizeFormat(input.format) : previous.format;

  const courtPool = Array.isArray(input.courtPool ?? previous?.courtPool)
    ? [...new Set((input.courtPool ?? previous.courtPool).filter((id) => typeof id === "string"))]
    : [];
  if (courtPool.length > MAX_COURTS) fail("TOO_MANY_COURTS", `At most ${MAX_COURTS} courts.`);

  const clubSource = input.clubId !== undefined ? input.clubId : previous?.clubId;
  return {
    name,
    description: cleanText(input.description ?? previous?.description ?? "", DESCRIPTION_MAX),
    clubId: typeof clubSource === "string" && clubSource.trim() ? clubSource.trim() : null,
    visibility: (input.visibility ?? previous?.visibility) === "private" ? "private" : "public",
    format,
    participantMode: resolveParticipantMode(
      format.id,
      input.participantMode ?? previous?.participantMode,
    ),
    courtPool,
    scheduling: normalizeScheduling(input.scheduling, previous?.scheduling || {}),
  };
}

function assertStatusTransition(from, to) {
  if (!STATUS_TRANSITIONS[from]?.includes(to)) {
    fail("INVALID_TOURNAMENT_TRANSITION", `A ${from} tournament cannot become ${to}.`);
  }
}

// Which fields a host may change in each lifecycle state (spec section 4).
function editableFields(status, { hasRounds }) {
  switch (status) {
    case "draft":
      return hasRounds
        ? ["name", "description", "clubId", "visibility", "courtPool", "scheduling"]
        : ["name", "description", "clubId", "visibility", "courtPool", "scheduling", "format"];
    case "published":
      return hasRounds
        ? ["name", "description", "clubId", "visibility", "courtPool", "scheduling"]
        : ["name", "description", "clubId", "visibility", "courtPool", "scheduling", "format"];
    case "live":
      return ["name", "description", "visibility", "courtPool", "scheduling"];
    default:
      return [];
  }
}

const FIELD_LABELS = {
  format: "The format",
  clubId: "The club",
  name: "The name",
  description: "The description",
  visibility: "Visibility",
  courtPool: "Courts",
  scheduling: "The schedule",
};

function assertEditable(status, changedFields, context) {
  const allowed = new Set(editableFields(status, context));
  for (const field of changedFields) {
    if (!allowed.has(field)) {
      const reason =
        status === "live" || context.hasRounds
          ? "once play has started"
          : `while the tournament is ${status}`;
      fail("FIELD_LOCKED", `${FIELD_LABELS[field] || field} cannot be changed ${reason}.`, {
        field,
      });
    }
  }
}

// Bulk paste: one name per line (or comma separated). "Name (m)" / "Name, f"
// gender markers are recognised for mixed formats; "#3" sets a seed.
function parseParticipantLines(text) {
  if (typeof text !== "string") return [];
  return text
    .split(/\r?\n|;/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      let rest = line;
      let gender = null;
      let seed = null;
      const genderMatch = rest.match(/[([,]\s*(m|f|male|female)\s*[)\]]?\s*$/i);
      if (genderMatch) {
        gender = genderMatch[1][0].toLowerCase();
        rest = rest.slice(0, genderMatch.index).trim();
      }
      const seedMatch = rest.match(/^#?(\d{1,3})[.)]?\s+(.+)$/);
      if (seedMatch && line.trim().startsWith("#")) {
        seed = Number(seedMatch[1]);
        rest = seedMatch[2];
      }
      return { displayName: cleanText(rest, PARTICIPANT_NAME_MAX), gender, seed };
    })
    .filter((entry) => entry.displayName);
}

function normalizeParticipantInput(input = {}) {
  const displayName = cleanText(input.displayName, PARTICIPANT_NAME_MAX);
  if (!displayName) fail("INVALID_PARTICIPANT", "Every player needs a name.");
  const shortName =
    cleanText(input.shortName, SHORT_NAME_MAX) ||
    cleanText(displayName.split(" ")[0], SHORT_NAME_MAX);
  const seed =
    input.seed == null || input.seed === "" ? null : toPositiveInt(input.seed, null, 1, 999);
  const gender = input.gender === "m" || input.gender === "f" ? input.gender : null;
  return { displayName, shortName, seed, gender };
}

function normalizeTeamInput(input = {}) {
  const name = cleanText(input.name, PARTICIPANT_NAME_MAX);
  const seed =
    input.seed == null || input.seed === "" ? null : toPositiveInt(input.seed, null, 1, 999);
  return { name, seed };
}

// Club-first court candidates (spec section 24.1): eligible courts of the
// selected club, then other eligible courts, then unavailable courts.
// Selection is never implied by the club.
function orderCourtCandidates(courts, { clubId = null, selectedCourtIds = [] } = {}) {
  const selected = new Set(selectedCourtIds);
  const rank = (court) => {
    const available = court.status !== "closed";
    const inClub = Boolean(clubId) && court.clubId === clubId;
    if (available && inClub) return 0;
    if (available) return 1;
    return 2;
  };
  return [...courts]
    .map((court) => ({
      courtId: court.courtId,
      name: court.name || court.courtId,
      clubId: court.clubId || null,
      status: court.status || "open",
      inSelectedClub: Boolean(clubId) && court.clubId === clubId,
      available: court.status !== "closed",
      selected: selected.has(court.courtId),
      group: ["club", "other", "unavailable"][rank(court)],
    }))
    .sort(
      (left, right) =>
        rank(left) - rank(right) ||
        left.name.localeCompare(right.name, undefined, { numeric: true }) ||
        left.courtId.localeCompare(right.courtId),
    );
}

module.exports = {
  TOURNAMENT_STATUSES,
  MAX_PARTICIPANTS,
  normalizeTournamentInput,
  normalizeScheduling,
  normalizeFormat,
  normalizeLeagueScoring,
  resolveParticipantMode,
  assertStatusTransition,
  editableFields,
  assertEditable,
  parseParticipantLines,
  normalizeParticipantInput,
  normalizeTeamInput,
  orderCourtCandidates,
};
