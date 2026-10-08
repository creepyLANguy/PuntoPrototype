// Match operations callable (spec sections 6, 34.1 and 60). One callable with
// an explicit `operation` keeps the deployed surface small while every
// operation stays server-authoritative, authorised and audited.
const { db } = require("../infrastructure/firebase");
const matchService = require("../services/matchService");
const { paths } = require("../services/firestorePaths");
const { validateId } = require("../services/ids");
const {
  readCredentials,
  requireAdmin,
  authorizeCourtControl,
  authorizeMatchControl,
} = require("../services/authService");
const { invalid, notFound } = require("../services/errors");
const { onTournamentMatchChanged } = require("../services/tournamentHooks");

async function loadMatch(matchId) {
  if (!matchId || typeof matchId !== "string") throw invalid("A match id is required.");
  const snap = await db.doc(paths.match(matchId)).get();
  if (!snap.exists) throw notFound("That match could not be found.");
  return { matchId, ...snap.data() };
}

async function loadCourt(courtId) {
  if (!courtId) return null;
  const snap = await db.doc(paths.court(courtId)).get();
  if (!snap.exists) throw notFound(`Court ${courtId} could not be found.`);
  return { courtId, ...snap.data() };
}

// Authorises against the match's tournament, or for a casual match against
// the court it is on (or is being put on).
async function authorizeFor(matchId, credentials, targetCourtId = null) {
  const match = await loadMatch(matchId);
  const court = match.tournamentId
    ? null
    : await loadCourt(targetCourtId || match.currentCourtId || null);
  if (!match.tournamentId && !court) {
    return { match, actor: await requireAdmin(credentials) };
  }
  return { match, actor: await authorizeMatchControl({ match, court }, credentials) };
}

const OPERATIONS = {
  async ensureCourtMatch(data) {
    return matchService.ensureCourtMatch({ courtId: data.courtId, actor: { type: "court" } });
  },

  async createMatch(data, credentials) {
    const actor = await requireAdmin(credentials);
    return matchService.createMatchDocument(
      {
        name: data.name,
        teamNames: data.teamNames,
        playerNames: data.playerNames,
        scoringOptions: data.scoringOptions || {},
        kind: "casual",
        visibility: data.visibility === "private" ? "private" : "public",
        courtId: data.courtId,
        displace: Boolean(data.displace),
      },
      { actor },
    );
  },

  async startMatch(data, credentials) {
    const { actor } = await authorizeFor(data.matchId, credentials, data.courtId);
    return matchService.startMatch({
      matchId: data.matchId,
      courtId: data.courtId,
      displace: Boolean(data.displace),
      actor,
      reason: data.reason,
    });
  },

  async moveMatch(data, credentials) {
    const { actor } = await authorizeFor(data.matchId, credentials, data.courtId);
    return matchService.moveMatch({
      matchId: data.matchId,
      courtId: data.courtId,
      displace: Boolean(data.displace),
      actor,
      reason: data.reason,
    });
  },

  async detachMatch(data, credentials) {
    const { actor } = await authorizeFor(data.matchId, credentials);
    return matchService.detachMatch({ matchId: data.matchId, actor, reason: data.reason });
  },

  async requeueMatch(data, credentials) {
    const { actor } = await authorizeFor(data.matchId, credentials);
    return matchService.detachMatch({
      matchId: data.matchId,
      requeue: true,
      actor,
      reason: data.reason,
    });
  },

  async completeMatch(data, credentials) {
    const { match, actor } = await authorizeFor(data.matchId, credentials);
    let requireDecisive = false;
    if (match.tournamentId) {
      const { fixtureRequiresWinner } = require("../services/tournamentService");
      requireDecisive = await fixtureRequiresWinner(match);
    }
    return matchService.completeMatch({
      matchId: data.matchId,
      actor,
      reason: data.reason,
      requireDecisive,
    });
  },

  async cancelMatch(data, credentials) {
    const { actor } = await authorizeFor(data.matchId, credentials);
    return matchService.cancelMatch({ matchId: data.matchId, actor, reason: data.reason });
  },

  async reopenMatch(data, credentials) {
    const { match, actor } = await authorizeFor(data.matchId, credentials, data.courtId);
    if (match.tournamentId) {
      const { assertFixtureReopenable } = require("../services/tournamentService");
      await assertFixtureReopenable(match);
    }
    return matchService.reopenMatch({
      matchId: data.matchId,
      courtId: data.courtId || null,
      actor,
      reason: data.reason,
    });
  },

  async resetMatch(data, credentials) {
    const { actor } = await authorizeFor(data.matchId, credentials);
    return matchService.resetMatch({
      matchId: data.matchId,
      deepReset: Boolean(data.deepReset),
      scoringOptions: data.scoringOptions || null,
      actor,
      reason: data.reason,
    });
  },

  async renameMatch(data, credentials) {
    const { actor } = await authorizeFor(data.matchId, credentials);
    return matchService.renameMatch({ matchId: data.matchId, name: data.name, actor });
  },

  async updateMatchNames(data, credentials) {
    const { actor } = await authorizeFor(data.matchId, credentials);
    return matchService.updateMatchNames({
      matchId: data.matchId,
      teamNames: data.teamNames,
      playerNames: data.playerNames,
      actor,
    });
  },

  async courtControlCheck(data, credentials) {
    const court = await loadCourt(data.courtId);
    const actor = await authorizeCourtControl(court, credentials);
    return { allowed: true, actorType: actor.type };
  },
};

async function manageMatch(request) {
  const data = request.data || {};
  if (data.matchId !== undefined) validateId("match", data.matchId);
  if (data.courtId !== undefined && data.courtId !== null) validateId("court", data.courtId);
  const handler = OPERATIONS[data.operation];
  if (!handler) throw invalid("Unknown match operation.");

  const credentials = readCredentials(request);
  const result = await handler(data, credentials);
  if (result?.tournamentId) {
    await onTournamentMatchChanged(result);
  }
  return { success: true, ...result };
}

module.exports = { manageMatch, MATCH_OPERATIONS: Object.keys(OPERATIONS) };
