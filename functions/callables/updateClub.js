const clubService = require("../services/clubService");
const { runClubOperation } = require("./clubCallableErrors");

// data: { clubId, name, courtIds, deviceIds } -> the saved club. courtIds and
// deviceIds replace the club's members; members of other clubs are moved.
async function updateClub(request) {
  return runClubOperation(() => clubService.updateClub(request.data || {}));
}

module.exports = { updateClub };
