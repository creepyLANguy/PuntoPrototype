// Firestore document and collection paths. Scoring state is match-scoped:
// a court is a physical location that points at its active match.
const { SCORE_CHECKPOINTS_COLLECTION } = require("./constants");

const paths = {
  court: (courtId) => `courts/${courtId}`,
  courtDeviceEvents: (courtId) => `courts/${courtId}/deviceEvents`,
  club: (clubId) => `clubs/${clubId}`,
  admin: () => "admin/goodies",

  match: (matchId) => `matches/${matchId}`,
  matchEvents: (matchId) => `matches/${matchId}/events`,
  matchEvent: (matchId, eventId) => `matches/${matchId}/events/${eventId}`,
  matchScore: (matchId) => `matches/${matchId}/score/current`,
  matchCheckpoints: (matchId) => `matches/${matchId}/${SCORE_CHECKPOINTS_COLLECTION}`,
  matchArchiveEvent: (matchId, archiveId, eventId) =>
    `matches/${matchId}/archive/${archiveId}/events/${eventId}`,
  matchAudits: (matchId) => `matches/${matchId}/audits`,

  tournament: (tournamentId) => `tournaments/${tournamentId}`,
  tournamentParticipants: (tournamentId) => `tournaments/${tournamentId}/participants`,
  tournamentTeams: (tournamentId) => `tournaments/${tournamentId}/teams`,
  tournamentRounds: (tournamentId) => `tournaments/${tournamentId}/rounds`,
  tournamentFixtures: (tournamentId) => `tournaments/${tournamentId}/fixtures`,
  tournamentAudits: (tournamentId) => `tournaments/${tournamentId}/audits`,
  tournamentOperations: (tournamentId) => `tournaments/${tournamentId}/operations`,
  tournamentSecret: (tournamentId) => `tournamentSecrets/${tournamentId}`,
  tournamentCreation: (requestId) => `tournamentCreations/${requestId}`,
  tournamentView: (tournamentId) => `tournamentViews/${tournamentId}`,
  tournamentPrivateView: (tournamentId) => `tournamentPrivateViews/${tournamentId}`,
  tournamentDirectory: (tournamentId) => `tournamentDirectory/${tournamentId}`,
};

module.exports = { paths };
