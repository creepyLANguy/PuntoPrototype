const SCORING_EVENTS = new Set(["POINT_TEAM_A", "POINT_TEAM_B", "UNDO", "RESET"]);
const OPERATIONAL_EVENTS = new Set(["SPECTATE", "REGISTER"]);
const SUPPORTED_EVENTS = new Set([...SCORING_EVENTS, ...OPERATIONAL_EVENTS]);

function normalizeScoreVersion(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function isSupportedEventType(eventType) { return SUPPORTED_EVENTS.has(eventType); }
function isScoringEventType(eventType) { return SCORING_EVENTS.has(eventType); }

module.exports = { SCORING_EVENTS, OPERATIONAL_EVENTS, SUPPORTED_EVENTS, normalizeScoreVersion, isSupportedEventType, isScoringEventType };
