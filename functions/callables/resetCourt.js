// Court-addressed reset used by the scoreboard: resets the match currently on
// the court (spec section 7) and optionally changes the court password.
const { db } = require("../infrastructure/firebase");
const { paths } = require("../services/firestorePaths");
const matchService = require("../services/matchService");
const {
  readCredentials,
  authorizeCourtControl,
  authorizeMatchControl,
} = require("../services/authService");
const { invalid, notFound } = require("../services/errors");
const { onTournamentMatchChanged } = require("../services/tournamentHooks");
const { REGION } = require("../services/constants");

async function resetCourt(request) {
  const {
    courtId,
    deepReset,
    newPassword,
    requirePassword,
    scoringMode,
    scoringOptions: incomingScoringOptions,
  } = request.data || {};
  if (!courtId) throw invalid("Missing courtId");

  const courtSnap = await db.doc(paths.court(courtId)).get();
  if (!courtSnap.exists) throw notFound("Court not found.");
  const court = { courtId, ...courtSnap.data() };
  const credentials = readCredentials(request);
  const trimmedPassword = typeof newPassword === "string" ? newPassword.trim() : "";

  // A password is optional on reset: blank means "keep the existing court
  // password". When one is supplied it still has to satisfy the usual rules,
  // and callers can set requirePassword to make it mandatory.
  if (requirePassword && !trimmedPassword) {
    throw invalid("Password must be at least 4 characters.");
  }
  if (trimmedPassword) {
    if (trimmedPassword.length < 4) throw invalid("Password must be at least 4 characters.");
    if (trimmedPassword === courtId) throw invalid("Password must be different from court name.");
  }

  const matchId = await matchService.resolveCourtMatchId(courtId, { ensure: true });
  const matchSnap = await db.doc(paths.match(matchId)).get();
  const match = { matchId, ...matchSnap.data() };
  const actor = await authorizeMatchControl({ match, court }, credentials);
  if (trimmedPassword && match.tournamentId) {
    await authorizeCourtControl(court, credentials);
  }

  const result = await matchService.resetMatch({
    matchId,
    deepReset: Boolean(deepReset),
    scoringOptions:
      incomingScoringOptions || scoringMode
        ? { ...(incomingScoringOptions || {}), ...(scoringMode ? { scoringMode } : {}) }
        : null,
    actor,
  });

  // Skip the write when the password is unchanged so connected clients do not
  // see a password-change event (which would switch them to spectate mode).
  if (trimmedPassword && trimmedPassword !== court.password) {
    await db.doc(paths.court(courtId)).set({ password: trimmedPassword }, { merge: true });
  }

  if (result.tournamentId) await onTournamentMatchChanged(result);
  return { ...result, courtId };
}

module.exports = { resetCourt, REGION };
