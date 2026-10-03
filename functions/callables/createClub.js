const clubService = require("../services/clubService");
const { runClubOperation } = require("./clubCallableErrors");

// data: { name, courtIds?, deviceIds? } -> the saved club and any members it
// took over from other clubs.
async function createClub(request) {
  return runClubOperation(() => clubService.createClub(request.data || {}));
}

module.exports = { createClub };
