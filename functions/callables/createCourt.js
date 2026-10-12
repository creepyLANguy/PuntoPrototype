const courtService = require("../services/courtService");
const { readCredentials, requireAdmin } = require("../services/authService");

async function createCourt(request) {
  await requireAdmin(readCredentials(request));
  return courtService.createCourt(request.data || {});
}

module.exports = { createCourt };
