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
  playPageReturnToScoreboard: false,
  isJoiningCourt: false,
  courtToEdit: null,
  currentDeviceToEdit: null,
};
