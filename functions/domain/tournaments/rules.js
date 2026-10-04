const { getFormat } = require("./formats");

function getRulesSummary(formatId, config) {
  return getFormat(formatId).getRulesSummary(config);
}

module.exports = { getRulesSummary };
