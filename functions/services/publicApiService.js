const crypto = require("crypto");

const { db } = require("../infrastructure/firebase");

const { defaultScore, normalizeScoringOptions, getCurrentServerLabel } = require("../domain/scoring/engine");

const { createApiResponseCache } = require("../infrastructure/cache");
const { buildScoringOptions } = require("../domain/scoring/modes");
const { normalizeScoreVersion } = require("../domain/events/validation");
const { DEFAULT_TEAM_NAMES, DEFAULT_PLAYER_NAMES } = require("./constants");

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
    Boolean(inTiebreak);

  if (usesNumericPoints) {
    return String(numericPoints);
  }

  if (numericPoints === 4) {
    return "Ad";
  }

  return SCORE_API_POINT_LABELS[numericPoints] ?? String(numericPoints);
}

function extractScoreApiCourtId(reqPath) {
  const segments = String(reqPath || "")
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch (_err) {
        return segment;
      }
    });

  // With the hosting rewrite the path looks like /score/{courtId}, /revision/{courtId},
  // /stats/{courtId} or /momentum/{courtId}; when the function URL is hit directly the
  // courtId is simply the last segment.
  let courtId;
  if (SCORE_API_REWRITE_PREFIXES.has(segments[0])) {
    courtId = segments.length >= 2 ? segments[segments.length - 1] : null;
  } else {
    courtId = segments.length ? segments[segments.length - 1] : null;
  }

  if (!courtId || courtId.length > 64) {
    return null;
  }

  return courtId;
}

function computeScoreRevision(body) {
  const { fetchedAt: _ignored, revision: _alsoIgnored, ...fingerprintSource } = body || {};
  return crypto
    .createHash("sha1")
    .update(JSON.stringify(fingerprintSource))
    .digest("hex")
    .slice(0, 16);
}

async function buildCourtScoreResponse(courtId) {
  const cached = scoreApiCache.get(courtId);
  if (cached) {
    return { status: cached.status, body: cached.body };
  }

  const [courtSnap, scoreSnap] = await Promise.all([
    db.doc(`courts/${courtId}`).get(),
    db.doc(`courts/${courtId}/score/current`).get(),
  ]);

  if (!courtSnap.exists) {
    const notFoundBody = { success: false, error: "Court not found." };
    scoreApiCache.set(courtId, 404, notFoundBody);
    return { status: 404, body: notFoundBody };
  }

  const courtData = courtSnap.data() || {};
  const rawScore = scoreSnap.exists ? scoreSnap.data() : null;
  const scoringOptions = buildScoringOptions({
    ...(courtData.scoringOptions || {}),
    ...(rawScore?.scoringOptions || {}),
    scoringMode: rawScore?.scoringOptions?.scoringMode || courtData.scoringMode,
  });
  const score = rawScore || defaultScore(scoringOptions);
  const inTiebreak = Boolean(score.inTiebreak);

  const body = {
    success: true,
    courtId,
    teamNames: {
      A: courtData.teamNames?.A || DEFAULT_TEAM_NAMES.A,
      B: courtData.teamNames?.B || DEFAULT_TEAM_NAMES.B,
    },
    playerNames: {
      A1: courtData.playerNames?.A1 || "",
      A2: courtData.playerNames?.A2 || "",
      B1: courtData.playerNames?.B1 || "",
      B2: courtData.playerNames?.B2 || "",
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
    // Only the match tiebreak has a defined end; other modes play an open
    // number of sets/points, so a stale persisted flag must not leak out.
    matchComplete: scoringOptions.scoringMode === "tiebreakTen" && Boolean(score.matchComplete),
    server: getCurrentServerLabel({ ...score, scoringOptions }),
    scoreVersion: normalizeScoreVersion(courtData.scoreVersion),
  };

  body.revision = computeScoreRevision(body);
  body.fetchedAt = new Date().toISOString();

  scoreApiCache.set(courtId, 200, body);
  return { status: 200, body };
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
  // origin hit per courtId per TTL window regardless of client volume.
  res.set("Cache-Control", `public, max-age=${cacheSeconds}, s-maxage=${cacheSeconds}`);
  return true;
}

const scoreApiCache = createApiResponseCache(4 * 1000, 200);

const statsApiCache = createApiResponseCache(10 * 1000, 200);

const momentumApiCache = createApiResponseCache(5 * 1000, 200);

module.exports = { buildCourtScoreResponse, prepareScoreApiRequest, scoreApiCache, statsApiCache, momentumApiCache, extractScoreApiCourtId, computeScoreRevision };