// Firestore document and collection paths. Scoring state is match-scoped:
// a court is a physical location that points at its active match.
const { SCORE_CHECKPOINTS_COLLECTION } = require("./constants");
const { validateId } = require("./ids");
const { invalid } = require("./errors");

function segment(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value.includes("/") ||
    value === "." ||
    value === ".."
  ) {
    throw invalid("A valid document id is required.");
  }
  return value;
}
const court = (id) => `courts/${validateId("court", id)}`;
const match = (id) => `matches/${validateId("match", id)}`;
const tournament = (id) => `tournaments/${validateId("tournament", id)}`;

const paths = {
  court,
  courtDeviceEvents: (courtId) => `${court(courtId)}/deviceEvents`,
  club: (clubId) => `clubs/${validateId("club", clubId)}`,
  admin: () => "admin/goodies",

  match,
  matchEvents: (matchId) => `${match(matchId)}/events`,
  matchEvent: (matchId, eventId) => `${match(matchId)}/events/${segment(eventId)}`,
  matchScore: (matchId) => `${match(matchId)}/score/current`,
  matchCheckpoints: (matchId) => `${match(matchId)}/${SCORE_CHECKPOINTS_COLLECTION}`,
  matchArchiveEvent: (matchId, archiveId, eventId) =>
    `${match(matchId)}/archive/${segment(archiveId)}/events/${segment(eventId)}`,
  matchAudits: (matchId) => `${match(matchId)}/audits`,

  tournament,
  tournamentParticipants: (tournamentId) => `${tournament(tournamentId)}/participants`,
  tournamentTeams: (tournamentId) => `${tournament(tournamentId)}/teams`,
  tournamentRounds: (tournamentId) => `${tournament(tournamentId)}/rounds`,
  tournamentFixtures: (tournamentId) => `${tournament(tournamentId)}/fixtures`,
  tournamentAudits: (tournamentId) => `${tournament(tournamentId)}/audits`,
  tournamentOperations: (tournamentId) => `${tournament(tournamentId)}/operations`,
  tournamentSecret: (id) => `tournamentSecrets/${validateId("tournament", id)}`,
  tournamentCreation: (requestId) => `tournamentCreations/${segment(requestId)}`,
  tournamentView: (id) => `tournamentViews/${validateId("tournament", id)}`,
  tournamentPrivateView: (id) => `tournamentPrivateViews/${validateId("tournament", id)}`,
  tournamentDirectory: (id) => `tournamentDirectory/${validateId("tournament", id)}`,
};

module.exports = { paths };
