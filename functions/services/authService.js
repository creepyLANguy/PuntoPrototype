// Mutation-boundary authorisation (spec section 41). There are no user
// accounts: a caller proves authority with
//   - the platform admin key (admin/goodies.skeletonKey) or an admin custom
//     claim on a Firebase Auth token;
//   - a tournament host key, issued once when the tournament is created and
//     stored only as a SHA-256 hash in tournamentSecrets/{tournamentId};
//   - a court password, for casual (non-tournament) matches on that court.
const crypto = require("crypto");
const { db } = require("../infrastructure/firebase");
const { paths } = require("./firestorePaths");
const { secretsMatch, validateId } = require("./ids");
const { denied } = require("./errors");

function readCredentials(request) {
  const credentials = request?.data?.credentials || {};
  return {
    adminKey: typeof credentials.adminKey === "string" ? credentials.adminKey : null,
    hostKey: typeof credentials.hostKey === "string" ? credentials.hostKey : null,
    courtPassword: typeof credentials.courtPassword === "string" ? credentials.courtPassword : null,
    uid: request?.auth?.uid || null,
    adminClaim: request?.auth?.token?.admin === true,
  };
}

function constantTimeEquals(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const leftHash = crypto.createHash("sha256").update(left).digest();
  const rightHash = crypto.createHash("sha256").update(right).digest();
  return crypto.timingSafeEqual(leftHash, rightHash);
}

async function isAdmin(credentials) {
  if (credentials.adminClaim) return true;
  if (!credentials.adminKey) return false;
  const snap = await db.doc(paths.admin()).get();
  const skeletonKey = snap.exists ? snap.data()?.skeletonKey : null;
  return Boolean(skeletonKey) && constantTimeEquals(credentials.adminKey, skeletonKey);
}

function actorFor(type, credentials) {
  return { type, uid: credentials.uid || null };
}

async function requireAdmin(credentials) {
  if (await isAdmin(credentials)) return actorFor("admin", credentials);
  throw denied("Admin access is required.");
}

async function authorizeTournamentHost(tournamentId, credentials) {
  validateId("tournament", tournamentId);
  if (await isAdmin(credentials)) return actorFor("admin", credentials);
  if (credentials.hostKey) {
    const secretSnap = await db.doc(paths.tournamentSecret(tournamentId)).get();
    if (secretSnap.exists && secretsMatch(credentials.hostKey, secretSnap.data()?.hostKeyHash)) {
      return actorFor("host", credentials);
    }
  }
  throw denied("Only the tournament host can do that.");
}

async function authorizeCourtControl(court, credentials) {
  if (await isAdmin(credentials)) return actorFor("admin", credentials);
  if (
    court &&
    credentials.courtPassword &&
    constantTimeEquals(credentials.courtPassword, court.password || "")
  ) {
    return actorFor("court", credentials);
  }
  throw denied("The court password is required.");
}

// Tournament matches are controlled by the tournament host; casual matches by
// whoever controls the court they are on.
async function authorizeMatchControl({ match, court }, credentials) {
  if (match?.tournamentId) {
    return authorizeTournamentHost(match.tournamentId, credentials);
  }
  return authorizeCourtControl(court, credentials);
}

module.exports = {
  readCredentials,
  isAdmin,
  requireAdmin,
  authorizeTournamentHost,
  authorizeCourtControl,
  authorizeMatchControl,
};
