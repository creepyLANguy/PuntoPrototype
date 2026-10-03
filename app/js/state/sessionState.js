// Court session state: everything about the court that is currently open (its id,
// score, options, names, password, mode) plus the match-details caches. Reset by
// court/session.js when a court is entered or left.
import { DEFAULT_PLAYER_NAMES, DEFAULT_SCORING_OPTIONS, DEFAULT_TEAM_NAMES } from "../config/constants.js";
import { appState } from "./appState.js";

export const defaultScore = () => ({
  A: { points: 0, games: 0, sets: 0, totalPoints: 0 },
  B: { points: 0, games: 0, sets: 0, totalPoints: 0 },
  lastPointTeam: null,
  lastGameTeam: null,
  lastSetTeam: null,
  inTiebreak: false,
  matchComplete: false,
  scoringOptions: { ...DEFAULT_SCORING_OPTIONS }
});

export function invalidateMatchDetailsCache()
{
  session.isMatchDetailsCacheValid = false;
  session.matchDetailsCache = null;
  session.matchDetailsCacheCourtId = null;
  session.momentumCache = null;
  session.momentumCacheCourtId = null;
}

export function hasCourtAdminPrivileges()
{
  return appState.isAdmin || session.enteredCourtAsAdmin;
}

export const session = {
  score: defaultScore(),
  activeCourtListenerToken: 0,
  isMatchDetailsCacheValid: false,
  matchDetailsCache: null,
  matchDetailsCacheCourtId: null,
  momentumCache: null,
  momentumCacheCourtId: null,
  // Bumped on every momentum request so a reply that arrives after the view
  // moved on (court switch, empty match, modal closed) is discarded instead of
  // drawing over whatever is on screen now.
  momentumRequestToken: 0,
  lastKnownSets: { A: 0, B: 0 },
  sessionInitialized: false,
  currentCourtId: null,
  currentCourtPassword: null,
  pendingLocalPasswordUpdate: null,
  currentCourtStatus: null,
  currentScoreVersion: 0,
  beaconSidesSwapped: false,
  changeoverProcessing: false,
  currentScoringOptions: { ...DEFAULT_SCORING_OPTIONS },
  currentRawTeamNames: { ...DEFAULT_TEAM_NAMES },
  currentPlayerNames: { ...DEFAULT_PLAYER_NAMES },
  isSpectating: false,
  // True when this device entered the current court with admin credentials (or from
  // the admin dashboard). Admins keep control of the court across password changes.
  enteredCourtAsAdmin: false,
  currentCourtName: null,
};
