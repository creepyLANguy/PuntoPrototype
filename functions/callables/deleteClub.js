const clubService = require("../services/clubService");
const { runClubOperation } = require("./clubCallableErrors");

// data: { clubId } -> deletes the club and clears clubId on its members.
async function deleteClub(request) {
  return runClubOperation(() => clubService.deleteClub(request.data || {}));
}

module.exports = { deleteClub };
