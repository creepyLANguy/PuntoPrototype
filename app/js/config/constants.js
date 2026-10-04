// Application constants: scoring defaults and labels, event types, sound ids, court
// statuses, toast types, storage keys and timing values.
export const ALLOWED_COURT_ID_CHARS = "abcdefghjkmnpqrstuxyz";

export const POINTS = [0, 15, 30, 40];

export const DEFAULT_SCORING_OPTIONS = {
  scoringMode: "standard",
  deuceMode: "standard",
  tiebreakMode: "sixAllSeven",
};

export const DEFAULT_TEAM_NAMES = {
  A: "Team A",
  B: "Team B",
};

export const DEFAULT_PLAYER_NAMES = {
  A1: "",
  A2: "",
  B1: "",
  B2: "",
};

export const SCORING_LABELS = {
  standard: "Games and sets",
  straight: "Straight points",
  tiebreakTen: "Tiebreak Tens",
  golden: "Golden point",
  silver: "Silver deuce",
  star: "Star point",
  sixAllSeven: "7-point tiebreak",
  sixAllTen: "10-point tiebreak",
  off: "No tiebreak",
};

export const COOLDOWN_MS = 3000;

export const ADMIN_SESSION_STORAGE_KEY = "padelPushAdminUnlocked";

// The admin key is kept for this browser session only so server operations
// can be authorised; tournament host keys persist on the device that hosts.
export const ADMIN_KEY_STORAGE_KEY = "padelPushAdminKey";

export const HOST_KEYS_STORAGE_KEY = "padelPushHostKeys";

export const ACCESS_CODES_STORAGE_KEY = "padelPushAccessCodes";

export const ADMIN_LOGOUT_SIGNAL_KEY = "padelPushAdminLogoutSignal";

export const TOAST_DURATION_MS = 3000;

export const LOAD_SPINNER_DELAY_MS = 750;

export const LOADING_SPINNER_MIN_DURATION_MS = 750;

export const EVENT_TYPES = {
  POINT_TEAM_A: "POINT_TEAM_A",
  POINT_TEAM_B: "POINT_TEAM_B",
  UNDO: "UNDO",
  RESET: "RESET",
  SPECTATE: "SPECTATE",
  REGISTER: "REGISTER",
};

export const SOUND_IDS = {
  POINT: "pointSound",
  UNDO: "undoSound",
  SWOOSH: "swooshSound",
  START: "startSound",
  WARNING: "warningSound",
  POP: "popSound",
  SNAP: "snapSound",
  SET: "setSound",
};

export const STATUS = {
  OPEN: "open",
  CLOSED: "closed",
  PRIVATE: "private",
};

export const TOAST_TYPES = {
  SUCCESS: "success",
  ERROR: "error",
  INFO: "info",
  WARNING: "warning",
};
