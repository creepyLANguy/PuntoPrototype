// Application-wide state that outlives a single court session: device
// identity, the admin flag, local preferences and the court lists shown on the
// Play / Spectate / admin pages.
//
// State modules hold plain data only. Every module that needs a value reads
// and writes it through this object, so ownership stays explicit.
export const appState = {
  muted: false,
  isAdmin: false,
  // Assigned during boot by initDeviceIdentity() (lifecycle/deviceIdentity.js).
  thisDeviceId: null,
  nfcDenied: false,
  allCourts: [],
  filteredCourts: [],
  selectedPlayCourt: null,
  selectedPlayMatchId: null,
  playPageReturnToScoreboard: false,
  playPageTargetId: null,
  playPageTargetType: null,
  isJoiningCourt: false,
  courtToEdit: null,
  currentDeviceToEdit: null,
  // The club open in the club editor and its unsaved changes (admin/clubEditor.js).
  clubEditor: null,
  // Where the court / device edit page returns to after a save or delete when
  // it was opened from the club editor (a view state), otherwise null.
  adminEditReturnView: null,
};
