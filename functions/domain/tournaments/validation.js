const { getFormat } = require("./formats");

function validateTournamentSetup({
  format,
  participantMode,
  participants = [],
  teams = [],
  courtPool = [],
}) {
  const errors = [];
  const warnings = [];
  let formatModule = null;
  try {
    formatModule = getFormat(format?.id);
  } catch (error) {
    return { errors: [{ code: "UNKNOWN_FORMAT", message: error.message }], warnings };
  }

  const normalizedConfig = formatModule.normalizeConfig(format?.config || {});
  const configResult = formatModule.validateConfig(normalizedConfig);
  errors.push(...(configResult.errors || []));
  warnings.push(...(configResult.warnings || []));

  if (
    formatModule.entryMode !== "either" &&
    participantMode &&
    participantMode !== formatModule.entryMode
  ) {
    errors.push({
      code: "INVALID_ENTRY_MODE",
      message: `${formatModule.label} requires ${formatModule.entryMode} entries.`,
    });
  }

  const state = {
    tournament: {
      participantMode,
      format: { id: format?.id, version: 1, config: normalizedConfig },
      courtPool,
    },
    participants,
    teams,
    rounds: [],
    fixtures: [],
    generationSeed: "validation",
  };
  const participantResult = formatModule.validateParticipants(state);
  errors.push(...(participantResult.errors || []));
  warnings.push(...(participantResult.warnings || []));

  const duplicateParticipants = duplicateIds(
    participants.map((participant) => participant.participantId),
  );
  if (duplicateParticipants.length)
    errors.push({ code: "DUPLICATE_PARTICIPANTS", message: "Participant IDs must be unique." });
  const duplicateTeams = duplicateIds(teams.map((team) => team.teamId));
  if (duplicateTeams.length)
    errors.push({ code: "DUPLICATE_TEAMS", message: "Team IDs must be unique." });
  for (const team of teams) {
    const duplicates = duplicateIds(team.participantIds || []);
    if (duplicates.length)
      errors.push({
        code: "DUPLICATE_TEAM_MEMBERS",
        message: `${team.teamId} contains duplicate participants.`,
      });
  }

  if (!Array.isArray(courtPool))
    errors.push({ code: "INVALID_COURT_POOL", message: "courtPool must be an array." });
  return { errors, warnings };
}

function duplicateIds(ids) {
  const seen = new Set();
  const duplicates = new Set();
  for (const id of ids) {
    if (!id) continue;
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return [...duplicates];
}

module.exports = { validateTournamentSetup };
