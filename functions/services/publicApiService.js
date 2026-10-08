const crypto = require("crypto");

const { db } = require("../infrastructure/firebase");

const {
  defaultScore,
  normalizeScoringOptions,
  getCurrentServerLabel,
  isFixedEndMode,
} = require("../domain/scoring/engine");

const { createApiResponseCache } = require("../infrastructure/cache");
const { buildScoringOptions } = require("../domain/scoring/modes");
const { normalizeScoreVersion } = require("../domain/events/validation");
const { DEFAULT_TEAM_NAMES, DEFAULT_PLAYER_NAMES } = require("./constants");
const { paths } = require("./firestorePaths");
const { validateId } = require("./ids");
const { resolveMatchTitle } = require("../domain/matches/lifecycle");

const SCORE_API_REWRITE_PREFIXES = new Set(["a", "r", "s", "m"]);
const SCORE_API_POINT_LABELS = ["0", "15", "30", "40"];

function sendJson(res, status, body) {
  return res.status(status).json(body);
}

function buildScorePointsDisplay(points, scoringOptions, inTiebreak) {
  const numericPoints = Number(points) || 0;
  const options = normalizeScoringOptions(scoringOptions);
  const usesNumericPoints =
    options.scoringMode === "straight" ||
    options.scoringMode === "tiebreakTen" ||
    options.scoringMode === "fixedTotalPoints" ||
    Boolean(inTiebreak);

  if (usesNumericPoints) {
    return String(numericPoints);
  }

  if (numericPoints === 4) {
    return "Ad";
  }

  return SCORE_API_POINT_LABELS[numericPoints] ?? String(numericPoints);
}

function decodePathSegments(reqPath) {
  return String(reqPath || "")
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch (_err) {
        return segment;
      }
    });
}

// Public read paths address either a physical court (/score/{courtId}: the
// match currently on that court) or a durable match (/score/match/{matchId}).
function extractScoreApiTarget(reqPath) {
  const segments = decodePathSegments(reqPath);
  const id = segments.length ? segments[segments.length - 1] : null;
  const kind =
    segments.length >= 2 && segments[segments.length - 2] === "match" ? "match" : "court";
  try {
    validateId(kind, id);
  } catch {
    return null;
  }
  if (kind === "match") return { kind, id };

  // When the function URL is hit directly, or through the Hosting redirect,
  // the court id is the last segment.
  if (SCORE_API_REWRITE_PREFIXES.has(segments[0]) && segments.length < 2) return null;
  return { kind: "court", id };
}

function extractScoreApiCourtId(reqPath) {
  const target = extractScoreApiTarget(reqPath);
  return target?.kind === "court" ? target.id : null;
}

function targetCacheKey(target) {
  return `${target.kind}:${target.id}`;
}

// Resolves a court or match target to { court, match } without reading any
// score. A court with no active match falls back to its most recent match.
async function resolveScoreTarget(target) {
  if (target.kind === "match") {
    const matchSnap = await db.doc(paths.match(target.id)).get();
    if (!matchSnap.exists) return { notFound: "Match not found." };
    const match = { matchId: target.id, ...matchSnap.data() };
    let court = null;
    if (match.currentCourtId) {
      const courtSnap = await db.doc(paths.court(match.currentCourtId)).get();
      court = courtSnap.exists ? { courtId: match.currentCourtId, ...courtSnap.data() } : null;
    }
    return { court, match };
  }

  const courtSnap = await db.doc(paths.court(target.id)).get();
  if (!courtSnap.exists) return { notFound: "Court not found." };
  const court = { courtId: target.id, ...courtSnap.data() };
  const matchId = court.activeMatchId || court.lastMatchId || null;
  let match = null;
  if (matchId) {
    const matchSnap = await db.doc(paths.match(matchId)).get();
    match = matchSnap.exists ? { matchId, ...matchSnap.data() } : null;
  }
  return { court, match };
}

function computeScoreRevision(body) {
  const { fetchedAt: _ignored, revision: _alsoIgnored, ...fingerprintSource } = body || {};
  return crypto
    .createHash("sha1")
    .update(JSON.stringify(fingerprintSource))
    .digest("hex")
    .slice(0, 16);
}

function buildMatchContext(match, court) {
  if (!match) return null;
  return {
    matchId: match.matchId,
    name: match.name || null,
    title: resolveMatchTitle(match),
    status: match.status || null,
    tournamentId: match.tournamentId || null,
    roundId: match.roundId || null,
    fixtureId: match.fixtureId || null,
    courtId: match.currentCourtId || null,
    courtName: court && court.courtId === match.currentCourtId ? court.name || null : null,
  };
}

async function buildScoreResponse(target) {
  const cacheKey = targetCacheKey(target);
  const cached = scoreApiCache.get(cacheKey);
  if (cached) {
    return { status: cached.status, body: cached.body };
  }

  const resolved = await resolveScoreTarget(target);
  if (resolved.notFound) {
    const notFoundBody = { success: false, error: resolved.notFound };
    scoreApiCache.set(cacheKey, 404, notFoundBody);
    return { status: 404, body: notFoundBody };
  }

  const { court, match } = resolved;
  const scoreSnap = match ? await db.doc(paths.matchScore(match.matchId)).get() : null;
  const rawScore = scoreSnap?.exists ? scoreSnap.data() : null;
  const configSource = match || court || {};
  const scoringOptions = buildScoringOptions({
    ...(configSource.scoringOptions || {}),
    ...(rawScore?.scoringOptions || {}),
    scoringMode: rawScore?.scoringOptions?.scoringMode || configSource.scoringMode,
  });
  const score = rawScore || defaultScore(scoringOptions);
  const inTiebreak = Boolean(score.inTiebreak);
  const matchContext = buildMatchContext(match, court);

  const body = {
    success: true,
    courtId: court?.courtId || match?.currentCourtId || null,
    courtName: court?.name || null,
    matchId: match?.matchId || null,
    matchName: match?.name || null,
    // Display identity: match name, then matchup, then match id - never the court.
    title: matchContext?.title || null,
    match: matchContext,
    teamNames: {
      A: match?.teamNames?.A || DEFAULT_TEAM_NAMES.A,
      B: match?.teamNames?.B || DEFAULT_TEAM_NAMES.B,
    },
    playerNames: {
      A1: match?.playerNames?.A1 || DEFAULT_PLAYER_NAMES.A1,
      A2: match?.playerNames?.A2 || DEFAULT_PLAYER_NAMES.A2,
      B1: match?.playerNames?.B1 || DEFAULT_PLAYER_NAMES.B1,
      B2: match?.playerNames?.B2 || DEFAULT_PLAYER_NAMES.B2,
    },
    scoringOptions,
    scoringMode: scoringOptions.scoringMode,
    teams: {
      A: {
        sets: Number(score.A?.sets) || 0,
        games: Number(score.A?.games) || 0,
        points: Number(score.A?.points) || 0,
        pointsDisplay: buildScorePointsDisplay(score.A?.points, scoringOptions, inTiebreak),
      },
      B: {
        sets: Number(score.B?.sets) || 0,
        games: Number(score.B?.games) || 0,
        points: Number(score.B?.points) || 0,
        pointsDisplay: buildScorePointsDisplay(score.B?.points, scoringOptions, inTiebreak),
      },
    },
    completedSets: Array.isArray(score.completedSets) ? score.completedSets : [],
    inTiebreak,
    // Silver deuce only becomes a deciding point after the first deuce
    // cycle, so overlays need the cycle count to label it correctly.
    deuceCycles: Number(score.deuceCycles) || 0,
    // Only modes with a defined end (match tiebreak, fixed total points)
    // can be complete; other modes play an open number of sets/points, so a
    // stale persisted flag must not leak out.
    matchComplete: isFixedEndMode(scoringOptions.scoringMode) && Boolean(score.matchComplete),
    server: getCurrentServerLabel({ ...score, scoringOptions }),
    scoreVersion: normalizeScoreVersion(match?.scoreVersion),
  };

  if (scoringOptions.scoringMode === "fixedTotalPoints" && score.fixedTotal) {
    body.fixedTotal = score.fixedTotal;
  }

  body.revision = computeScoreRevision(body);
  body.fetchedAt = new Date().toISOString();

  scoreApiCache.set(cacheKey, 200, body);
  return { status: 200, body };
}

function buildCourtScoreResponse(courtId) {
  return buildScoreResponse({ kind: "court", id: courtId });
}
function prepareScoreApiRequest(req, res, cacheSeconds) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return null;
  }

  if (req.method !== "GET") {
    res.set("Cache-Control", "no-store");
    sendJson(res, 405, { success: false, error: "Method not allowed" });
    return null;
  }

  // Let the Firebase Hosting CDN absorb repeat requests: at most one
  // origin hit per court or match per TTL window regardless of client volume.
  res.set("Cache-Control", `public, max-age=${cacheSeconds}, s-maxage=${cacheSeconds}`);
  return true;
}

const scoreApiCache = createApiResponseCache(4 * 1000, 200);

const statsApiCache = createApiResponseCache(10 * 1000, 200);

const momentumApiCache = createApiResponseCache(5 * 1000, 200);

module.exports = {
  buildScoreResponse,
  buildCourtScoreResponse,
  resolveScoreTarget,
  extractScoreApiTarget,
  targetCacheKey,
  prepareScoreApiRequest,
  scoreApiCache,
  statsApiCache,
  momentumApiCache,
  extractScoreApiCourtId,
  computeScoreRevision,
};
