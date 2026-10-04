// Tournament operations callable (spec sections 34.2, 41, 60 and 61). Every
// mutation is authorised here against the tournament host key or the admin
// key and then executed server-side by the tournament service.
const tournamentService = require("../services/tournamentService");
const { readCredentials, authorizeTournamentHost } = require("../services/authService");
const { invalid } = require("../services/errors");

const PUBLIC_OPERATIONS = {
  listFormats: () => ({ formats: tournamentService.listFormats() }),
  previewTournament: (data) => tournamentService.previewTournament(data),
  getCourtOptions: (data) => tournamentService.getCourtOptions(data),
  getTournamentView: (data, credentials) => tournamentService.getTournamentView(data, credentials),
  createTournament: (data, credentials) =>
    tournamentService.createTournament(data, {
      actor: { type: credentials.adminClaim ? "admin" : "host", uid: credentials.uid },
    }),
};

const HOST_OPERATIONS = {
  verifyHost: async (_data, ctx) => ({ isHost: true, actorType: ctx.actor.type }),
  updateTournament: tournamentService.updateTournament,
  publishTournament: tournamentService.publishTournament,
  unpublishTournament: tournamentService.unpublishTournament,
  startTournament: tournamentService.startTournament,
  completeTournament: tournamentService.completeTournament,
  cancelTournament: tournamentService.cancelTournament,
  addParticipants: tournamentService.addParticipants,
  updateParticipant: tournamentService.updateParticipant,
  removeParticipant: tournamentService.removeParticipant,
  withdrawParticipant: tournamentService.withdrawParticipant,
  restoreParticipant: tournamentService.restoreParticipant,
  createTeam: tournamentService.createTeam,
  updateTeam: tournamentService.updateTeam,
  removeTeam: tournamentService.removeTeam,
  withdrawTeam: tournamentService.withdrawTeam,
  restoreTeam: tournamentService.restoreTeam,
  replaceTeamMember: tournamentService.replaceTeamMember,
  generateRound: tournamentService.generateRound,
  generateNextRound: tournamentService.generateRound,
  startFixture: tournamentService.startFixture,
  startRound: tournamentService.startRound,
  assignFixtureCourt: tournamentService.assignFixtureCourt,
  setFixtureSchedule: tournamentService.setFixtureSchedule,
  moveFixtureCourt: tournamentService.moveFixtureCourt,
  detachFixtureMatch: tournamentService.detachFixtureMatch,
  renameFixture: tournamentService.renameFixture,
  completeFixture: tournamentService.completeFixture,
  createFixtureMatch: tournamentService.createFixtureMatch,
  correctTournamentResult: tournamentService.correctTournamentResult,
  recalculateTournament: (data) => tournamentService.recalculateTournament(data),
};

async function manageTournament(request) {
  const data = request.data || {};
  const credentials = readCredentials(request);

  const publicHandler = PUBLIC_OPERATIONS[data.operation];
  if (publicHandler) {
    return { success: true, ...(await publicHandler(data, credentials)) };
  }

  const hostHandler = HOST_OPERATIONS[data.operation];
  if (!hostHandler) throw invalid("Unknown tournament operation.");
  if (!data.tournamentId) throw invalid("A tournament id is required.");

  const actor = await authorizeTournamentHost(data.tournamentId, credentials);
  return { success: true, ...(await hostHandler(data, { actor })) };
}

module.exports = {
  manageTournament,
  TOURNAMENT_OPERATIONS: [...Object.keys(PUBLIC_OPERATIONS), ...Object.keys(HOST_OPERATIONS)],
};
