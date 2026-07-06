import { app, db } from "./firebase.js";

import
{
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  onSnapshot,
  collection,
  addDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import
{
  getFunctions,
  httpsCallable
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

const functions = getFunctions(app, "africa-south1");

export async function resetCourt(courtId, deepReset = false, newPassword = null)
{
  const resetFn = httpsCallable(functions, "resetCourt");

  try
  {
    await resetFn({ courtId, deepReset, newPassword });
    showToast("Court reset successful", TOAST_TYPES.SUCCESS);
  }
  catch (err)
  {
    showToast("Reset failed: " + err.message, TOAST_TYPES.ERROR);
  }
}

document.addEventListener("DOMContentLoaded", () =>
{

  // =====================================================
  // CONFIG
  // =====================================================

  const ALLOWED_COURT_ID_CHARS = "abcdefghjkmnpqrstuxyz";

  const POINTS = [0, 15, 30, 40];
  const DEFAULT_SCORING_OPTIONS = {
    scoringMode: "standard",
    deuceMode: "standard",
    tiebreakMode: "sixAllSeven"
  };
  const SCORING_LABELS = {
    standard: "Games and sets",
    straight: "Straight points",
    tiebreakTen: "Tiebreak Tens",
    golden: "Golden point",
    silver: "Silver deuce",
    sixAllSeven: "7-point tiebreak",
    sixAllTen: "10-point tiebreak",
    off: "No tiebreak"
  };
  const COOLDOWN_MS = 3000;
  const BACK_HOLD_MS = 550;
  const UNDO_HOLD_MS = 550;
  const RESET_HOLD_MS = 1050;
  const LONG_PRESS_VIBRATION_MS = 200;

  const TOAST_DURATION_MS = 3000;

  const COURTID_UPPER_LIMIT = 999999999;

  const EVENT_TYPES = {
    POINT_TEAM_A: "POINT_TEAM_A",
    POINT_TEAM_B: "POINT_TEAM_B",
    UNDO: "UNDO",
    RESET: "RESET",
    SPECTATE: "SPECTATE",
    REGISTER: "REGISTER"
  };

  const SOUND_IDS = {
    POINT: "pointSound",
    UNDO: "undoSound",
    SWOOSH: "swooshSound",
    START: "startSound",
    WARNING: "warningSound",
    POP: "popSound",
    SNAP: "snapSound",
    SET: "setSound"
  };

  const STATUS = {
    OPEN: "open",
    CLOSED: "closed",
    PRIVATE: "private"
  };

  const TOAST_TYPES = {
    SUCCESS: "success",
    ERROR: "error",
    INFO: "info",
    WARNING: "warning"
  };

  // =====================================================
  // ACTION MAP
  // =====================================================

  const actionMap = {
    [EVENT_TYPES.POINT_TEAM_A]: () => addPoint(EVENT_TYPES.POINT_TEAM_A),
    [EVENT_TYPES.POINT_TEAM_B]: () => addPoint(EVENT_TYPES.POINT_TEAM_B),
    [EVENT_TYPES.UNDO]: () => undoLastPoint(),
    [EVENT_TYPES.RESET]: () => performShallowReset(),
    [EVENT_TYPES.SPECTATE]: () => spectateCourtFromNfc(),
    [EVENT_TYPES.REGISTER]: () => registerDeviceToCurrentCourt()
  };

  // =====================================================
  // STATE
  // =====================================================

  const defaultScore = () => ({
    A: { points: 0, games: 0, sets: 0, totalPoints: 0 },
    B: { points: 0, games: 0, sets: 0, totalPoints: 0 },
    lastPointTeam: null,
    lastGameTeam: null,
    lastSetTeam: null,
    inTiebreak: false,
    matchComplete: false,
    scoringOptions: { ...DEFAULT_SCORING_OPTIONS }
  });

  function normalizeScoringOptions(options = {})
  {
    const normalized = {
      ...DEFAULT_SCORING_OPTIONS,
      ...(options || {})
    };

    if (!["standard", "straight", "tiebreakTen"].includes(normalized.scoringMode))
    {
      normalized.scoringMode = DEFAULT_SCORING_OPTIONS.scoringMode;
    }

    if (!["standard", "golden", "silver"].includes(normalized.deuceMode))
    {
      normalized.deuceMode = DEFAULT_SCORING_OPTIONS.deuceMode;
    }

    if (!["off", "sixAllSeven", "sixAllTen"].includes(normalized.tiebreakMode))
    {
      normalized.tiebreakMode = DEFAULT_SCORING_OPTIONS.tiebreakMode;
    }

    return normalized;
  }

  function areScoringOptionsEqual(a, b)
  {
    const left = normalizeScoringOptions(a);
    const right = normalizeScoringOptions(b);

    return left.scoringMode === right.scoringMode &&
      left.deuceMode === right.deuceMode &&
      left.tiebreakMode === right.tiebreakMode;
  }

  function resolveScoringOptions(scoreData = score)
  {
    const courtOptions = normalizeScoringOptions(currentScoringOptions || {});
    const scoreOptions = normalizeScoringOptions(scoreData?.scoringOptions || {});

    return normalizeScoringOptions({
      ...scoreOptions,
      ...courtOptions,
      scoringMode: courtOptions.scoringMode || scoreOptions.scoringMode || DEFAULT_SCORING_OPTIONS.scoringMode,
      deuceMode: courtOptions.deuceMode || scoreOptions.deuceMode || DEFAULT_SCORING_OPTIONS.deuceMode,
      tiebreakMode: courtOptions.tiebreakMode || scoreOptions.tiebreakMode || DEFAULT_SCORING_OPTIONS.tiebreakMode
    });
  }

  let score = defaultScore();
  let lastKnownSets = { A: 0, B: 0 };
  let sessionInitialized = false;

  let muted = false;

  let currentCourtId = null;
  let currentCourtPassword = null;
  let currentCourtStatus = null;
  let currentScoringOptions = { ...DEFAULT_SCORING_OPTIONS };

  let isSpectating = false;

  let isAdmin = false;

  let thisDeviceId = DetermineThisDeviceId();

  let lastScannedCourtId = null;
  let lastScannedDeviceId = null;

  // =====================================================
  // NFC STATE
  // =====================================================

  let nfcReader = null;
  let nfcCooldown = false;
  let lastNfcScanTime = 0;
  let nfcDenied = false;

  // =====================================================
  // THEME STATE
  // =====================================================

  const TEAM_COLOUR_STORAGE_KEY = "punto_team_colours";
  const DEFAULT_TEAM_COLOURS = {
    dark: { A: "#ffff00", B: "#00ffff" },
    light: { A: "#ad7535", B: "#0a91ac" }
  };
  const TEAM_COLOUR_PICKER_OPTIONS = {
    format: "hex",
    hash: true,
    uppercase: false,
    required: true,
    width: 176,
    height: 112,
    sliderSize: 18,
    padding: 12,
    borderRadius: 8,
    smartPosition: true,
    zIndex: 20000,
    forceStyle: false
  };

  let isLightMode = localStorage.getItem("theme") === "light";
  let isWavesEnabled = localStorage.getItem("waves") !== "false";
  let isServerBadgeVisible = localStorage.getItem("serverBadge") !== "false";
  let teamColoursByTheme = loadStoredTeamColours();

  // =====================================================
  // THEME FUNCTIONS
  // =====================================================

  function initializeTheme()
  {
    if (isLightMode)
    {
      document.body.classList.add("light-mode");
    }

    initializeTeamColourPickers();
    applyTeamColours();
    syncAppearanceControls();
  }

  function setTheme(theme)
  {
    isLightMode = theme === "light";
    document.body.classList.toggle("light-mode", isLightMode);
    localStorage.setItem("theme", isLightMode ? "light" : "dark");
    applyTeamColours();
    syncAppearanceControls();
  }

  function toggleTheme()
  {
    setTheme(isLightMode ? "dark" : "light");
  }

  function getCurrentThemeName()
  {
    return isLightMode ? "light" : "dark";
  }

  function createEmptyTeamColourState()
  {
    return {
      dark: null,
      light: null
    };
  }

  function loadStoredTeamColours()
  {
    try
    {
      const stored = JSON.parse(localStorage.getItem(TEAM_COLOUR_STORAGE_KEY) || "null");
      if (!stored) return createEmptyTeamColourState();

      const legacyColours = normalizeTeamColourPair(stored);
      if (legacyColours)
      {
        return {
          dark: { ...legacyColours },
          light: { ...legacyColours }
        };
      }

      return {
        dark: normalizeTeamColourPair(stored.dark),
        light: normalizeTeamColourPair(stored.light)
      };
    }
    catch (err)
    {
      console.warn("Could not load team colours:", err);
      return createEmptyTeamColourState();
    }
  }

  function normalizeTeamColourPair(value)
  {
    if (!value || typeof value !== "object") return null;

    const A = normalizeHexColour(value.A);
    const B = normalizeHexColour(value.B);
    return A && B ? { A, B } : null;
  }

  function normalizeHexColour(value)
  {
    if (typeof value !== "string") return null;

    const colour = value.trim().toLowerCase();
    return /^#[0-9a-f]{6}$/.test(colour) ? colour : null;
  }

  function getActiveTeamColours()
  {
    return getTeamColoursForTheme(getCurrentThemeName());
  }

  function getTeamColoursForTheme(theme)
  {
    return teamColoursByTheme[theme] || DEFAULT_TEAM_COLOURS[theme];
  }

  function saveStoredTeamColours()
  {
    if (!teamColoursByTheme.dark && !teamColoursByTheme.light)
    {
      localStorage.removeItem(TEAM_COLOUR_STORAGE_KEY);
      return;
    }

    localStorage.setItem(TEAM_COLOUR_STORAGE_KEY, JSON.stringify(teamColoursByTheme));
  }

  function applyTeamColours()
  {
    const activeTheme = getCurrentThemeName();
    const customColours = teamColoursByTheme[activeTheme];

    if (customColours)
    {
      document.body.style.setProperty("--teamAcolour", customColours.A);
      document.body.style.setProperty("--teamBcolour", customColours.B);
      return;
    }

    document.body.style.removeProperty("--teamAcolour");
    document.body.style.removeProperty("--teamBcolour");
  }

  function setTeamColour(team, colour)
  {
    const normalizedColour = normalizeHexColour(colour);
    if (!normalizedColour || !["A", "B"].includes(team)) return;

    const activeTheme = getCurrentThemeName();

    teamColoursByTheme[activeTheme] = {
      ...getTeamColoursForTheme(activeTheme),
      [team]: normalizedColour
    };

    saveStoredTeamColours();
    applyTeamColours();
    syncAppearanceControls();
  }

  function initializeTeamColourPickers()
  {
    const inputs = document.querySelectorAll("[data-team-colour]");
    const JsColor = window.JSColor || window.jscolor;

    if (!JsColor)
    {
      inputs.forEach((input) =>
      {
        input.readOnly = false;
        input.inputMode = "text";
      });
      return;
    }

    inputs.forEach((input) =>
    {
      if (!input.jscolor)
      {
        new JsColor(input, TEAM_COLOUR_PICKER_OPTIONS);
      }
    });
  }

  function updateTeamColourInput(input, colour)
  {
    input.value = colour;
    input.style.setProperty("--picker-colour", colour);

    if (!input.jscolor) return;

    const pickerColour = normalizeHexColour(input.jscolor.toHEXString());
    if (pickerColour !== colour)
    {
      input.jscolor.fromString(colour);
    }
  }

  function resetTeamColours()
  {
    const activeTheme = getCurrentThemeName();

    teamColoursByTheme[activeTheme] = null;
    saveStoredTeamColours();
    applyTeamColours();
    syncAppearanceControls();
    showToast(`${activeTheme[0].toUpperCase()}${activeTheme.slice(1)} colours reset`, TOAST_TYPES.INFO);
  }

  function syncAppearanceControls()
  {
    const activeTheme = getCurrentThemeName();
    const activeColours = getActiveTeamColours();

    document.querySelectorAll("[data-theme-choice]").forEach((button) =>
    {
      const choiceTheme = button.dataset.themeChoice;
      const previewColours = getTeamColoursForTheme(choiceTheme);
      const isActive = button.dataset.themeChoice === activeTheme;

      button.style.setProperty("--theme-choice-a", previewColours.A);
      button.style.setProperty("--theme-choice-b", previewColours.B);
      button.style.setProperty("--theme-choice-text", getReadableTextColour(previewColours));
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
    });

    document.querySelectorAll("[data-team-colour]").forEach((input) =>
    {
      updateTeamColourInput(input, activeColours[input.dataset.teamColour]);
    });
  }

  function getReadableTextColour(colours)
  {
    const averageLuminance = (getRelativeLuminance(colours.A) + getRelativeLuminance(colours.B)) / 2;
    return averageLuminance > 0.45 ? "#000000" : "#ffffff";
  }

  function getRelativeLuminance(hexColour)
  {
    const channels = [1, 3, 5].map((start) => parseInt(hexColour.slice(start, start + 2), 16) / 255);
    const linearChannels = channels.map((channel) =>
      channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    );

    return (linearChannels[0] * 0.2126) + (linearChannels[1] * 0.7152) + (linearChannels[2] * 0.0722);
  }

  function openAppearanceMenu()
  {
    if (!elements.appearanceMenu || !elements.appearanceMenuBtn) return;

    syncAppearanceControls();
    elements.appearanceMenu.classList.remove("hidden");
    elements.appearanceMenuBtn.setAttribute("aria-expanded", "true");
  }

  function closeAppearanceMenu()
  {
    if (!elements.appearanceMenu || !elements.appearanceMenuBtn) return;

    elements.appearanceMenu.classList.add("hidden");
    elements.appearanceMenuBtn.setAttribute("aria-expanded", "false");
  }

  function toggleAppearanceMenu()
  {
    if (!elements.appearanceMenu) return;

    if (elements.appearanceMenu.classList.contains("hidden")) openAppearanceMenu();
    else closeAppearanceMenu();
  }

  // =====================================================
  // WAVE FUNCTIONS
  // =====================================================

  function initializeWaves()
  {
    updateWavesVisibility();
  }

  function syncSettingsTiles()
  {
    const updateItem = (button, active, activeLabel, inactiveLabel) =>
    {
      if (!button) return;
      const wrapper = button.closest(".setting-item");
      if (!wrapper) return;
      wrapper.classList.toggle("active", Boolean(active));
      const label = wrapper.querySelector("span");
      if (label)
      {
        label.textContent = active ? activeLabel : inactiveLabel;
      }
      button.setAttribute("aria-pressed", active ? "true" : "false");
    };

    updateItem(elements.muteBtn, muted, "Muted", "Mute");
    updateItem(elements.waveToggleScoreboardBtn, isWavesEnabled, "Waves on", "Waves off");
    updateItem(elements.fullscreenBtn, Boolean(getFullscreenElement()), "Exit full", "Fullscreen");
    updateItem(elements.swapBtn, document.querySelector(".scoreboard")?.classList.contains("swapped"), "Swapped", "Swap sides");
    updateItem(elements.serverToggleBtn, isServerBadgeVisible, "Server on", "Server off");
  }

  function toggleWaves()
  {
    isWavesEnabled = !isWavesEnabled;
    localStorage.setItem("waves", isWavesEnabled);
    elements.waveToggleScoreboardBtn.textContent = isWavesEnabled ? "🌊" : "♒︎";

    updateWavesVisibility();
    syncSettingsTiles();

    playSound(SOUND_IDS.POP);

    showToast(isWavesEnabled ? "Waves enabled" : "Waves disabled", TOAST_TYPES.INFO);
  }

  function updateWavesVisibility()
  {
    const waveContainer = document.querySelector(".wave-container");
    if (!waveContainer) return;

    // The toggle only affects the Scoreboard and Spectate (court list) views.
    // On the homepage and other pre-game screens, waves should always be visible.
    const onScoreboard = elements.scoreboardPage && window.getComputedStyle(elements.scoreboardPage).display !== "none";
    const onSpectate = elements.spectatePage && window.getComputedStyle(elements.spectatePage).display !== "none";

    const shouldHide = (onScoreboard || onSpectate) && !isWavesEnabled;
    const holdsHiddenClass = waveContainer.classList.contains("waves-hidden");

    if (shouldHide !== holdsHiddenClass)
    {
      waveContainer.classList.toggle("waves-hidden", shouldHide);
    }
  }

  // =====================================================
  // FULLSCREEN FUNCTIONS
  // =====================================================

  function getFullscreenElement()
  {
    return document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.msFullscreenElement ||
      null;
  }

  function isFullscreenSupported()
  {
    const target = document.documentElement;
    return Boolean(document.fullscreenEnabled ||
      document.webkitFullscreenEnabled ||
      document.msFullscreenEnabled ||
      target.requestFullscreen ||
      target.webkitRequestFullscreen ||
      target.msRequestFullscreen);
  }

  function updateFullscreenButton()
  {
    if (!elements.fullscreenBtn) return;

    const isActive = Boolean(getFullscreenElement());
    const label = isActive ? "Exit fullscreen" : "Enter fullscreen";

    elements.fullscreenBtn.textContent = isActive ? "⬚" : "\u26F6";
    elements.fullscreenBtn.title = label;
    elements.fullscreenBtn.setAttribute("aria-label", label);

    if (elements.fullscreenLabel)
    {
      elements.fullscreenLabel.textContent = isActive ? "Exit full" : "Fullscreen";
    }

    syncSettingsTiles();
  }

  async function toggleFullscreen()
  {
    if (!isFullscreenSupported())
    {
      showToast("Fullscreen is not supported on this device.", TOAST_TYPES.ERROR);
      return;
    }

    try
    {
      if (getFullscreenElement())
      {
        const exit = document.exitFullscreen ||
          document.webkitExitFullscreen ||
          document.msExitFullscreen;

        if (exit) await Promise.resolve(exit.call(document));
        showToast("Fullscreen off", TOAST_TYPES.INFO);
      }
      else
      {
        const target = document.documentElement;
        const request = target.requestFullscreen ||
          target.webkitRequestFullscreen ||
          target.msRequestFullscreen;

        if (request) await Promise.resolve(request.call(target));
        showToast("Fullscreen on", TOAST_TYPES.INFO);
      }

      updateFullscreenButton();
      syncSettingsTiles();
    }
    catch (error)
    {
      console.warn("Fullscreen toggle failed:", error);
      showToast("Fullscreen could not be changed.", TOAST_TYPES.ERROR);
    }
  }

  // =====================================================
  // DOM REFERENCES
  // =====================================================

  const $ = (id) => document.getElementById(id);

  const elements = {
    homeLinkBtn: $("homeLinkBtn"),
    menuPage: $("menuPage"),
    scoreboardPage: $("scoreboardPage"),

    scoreboard: document.querySelector(".scoreboard"),

    points: {
      A: $("pointsA"),
      B: $("pointsB")
    },

    sets: {
      A: $("setsA"),
      B: $("setsB")
    },

    games: {
      A: $("gamesA"),
      B: $("gamesB")
    },

    critical: {
      A: $("criticalA"),
      B: $("criticalB")
    },

    cooldown: $("cooldown"),
    controls: $("controls"),
    resetModal: $("resetModal"),

    confirmResetBtn: $("confirmReset"),
    shallowResetBtn: $("shallowReset"),
    cancelResetBtn: $("cancelReset"),

    undoBtn: $("undoBtn"),
    backBtn: $("backBtn"),
    swapBtn: $("swapBtn"),
    muteBtn: $("muteBtn"),
    fullscreenBtn: $("fullscreenBtn"),
    fullscreenLabel: $("fullscreenLabel"),

    appearanceMenuBtn: $("appearanceMenuBtn"),
    appearanceMenu: $("appearanceMenu"),
    waveToggleScoreboardBtn: $("waveToggleScoreboardBtn"),
    waveToggleSpectateBtn: $("waveToggleSpectateBtn"),

    activateNfcBtn: $("activateNfcBtn"),

    settingsBtn: $("settingsBtn"),
    settingsModal: $("settingsModal"),
    closeSettingsBtn: $("closeSettingsBtn"),
    scoringModeSelect: $("scoringModeSelect"),
    deuceModeSelect: $("deuceModeSelect"),
    tiebreakModeSelect: $("tiebreakModeSelect"),
    scoringStatus: $("scoringStatus"),
    scoreFormatBadge: $("scoreFormatBadge"),
    straightPointsTotal: $("straightPointsTotal"),
    straightTotalValue: $("straightTotalValue"),
    serverBadgeA: $("serverBadgeA"),
    serverBadgeB: $("serverBadgeB"),

    serverToggleBtn: $("serverToggleBtn"),
    serverToggleTile: $("serverToggleTile"),
    resetSettingsBtn: $("resetSettingsBtn"),
    resetSettingsTile: $("resetSettingsTile"),
    joinCourtBtn: $("joinCourtBtn"),
    joinCourtTile: $("joinCourtTile"),

    sep1: $("sep1"),
    sep2: $("sep2"),

    detailsBtn: $("detailsBtn"),
    detailsModal: $("detailsModal"),
    closeDetailsBtn: $("closeDetailsBtn"),
    detailsSetsA: $("detailsSetsA"),
    detailsSetsB: $("detailsSetsB"),
    detailsTeamAName: $("detailsTeamAName"),
    detailsTeamBName: $("detailsTeamBName"),
    dmHead: $("dmHead"),
    dmBody: $("dmBody"),
    detailsLoading: $("detailsLoading"),
    dmMomentumWrap: $("dmMomentumWrap"),
    dmMomentumCanvas: $("dmMomentumCanvas"),
    dmDetailsPanel: $("dmDetailsPanel"),
    dmDetailsToggle: $("dmDetailsToggle"),
    dmDetailsContent: $("dmDetailsContent"),
    dmEmptyState: $("dmEmptyState"),
    dmStatsWrap: $("dmStatsWrap"),
    dmStatsTeamA: $("dmStatsTeamA"),
    dmStatsMeta: $("dmStatsMeta"),

    confirmModal: $("confirmModal"),
    confirmMessage: $("confirmMessage"),
    confirmOkBtn: $("confirmOkBtn"),
    confirmCancelBtn: $("confirmCancelBtn"),

    setWinOverlay: $("setWinOverlay"),
    scoreboardLoading: $("scoreboardLoading")
  };

  //CREATE COURT ELEMENTS
  elements.createPage = $("createPage");
  elements.closeCreateBtn = $("closeCreateBtn");
  elements.createCourtBtn = $("createCourtBtn");

  elements.adminPassword = $("adminPassword");
  elements.courtName = $("courtName");
  elements.courtPassword = $("courtPassword");

  elements.adminError = $("adminError");
  elements.courtNameError = $("courtNameError");
  elements.courtPasswordError = $("courtPasswordError");
  elements.courtStatus = $("courtStatus");
  elements.courtScoringMode = $("courtScoringMode");

  // ADMIN AUTH ELEMENTS
  elements.adminLoginBtn = $("adminLoginBtn");
  elements.adminAuthPage = $("adminAuthPage");
  elements.adminAuthPassword = $("adminAuthPassword");
  elements.submitAdminAuthBtn = $("submitAdminAuthBtn");
  elements.adminAuthError = $("adminAuthError");
  elements.closeAdminAuthBtn = $("closeAdminAuthBtn");

  // ADMIN DASHBOARD ELEMENTS
  elements.adminDashboardPage = $("adminDashboardPage");
  elements.adminCourtList = $("adminCourtList");
  elements.closeAdminDashboardBtn = $("closeAdminDashboardBtn");
  elements.showCreateCourtModalBtn = $("showCreateCourtModalBtn");
  elements.adminCourtSearch = $("adminCourtSearch");
  elements.adminStatusFilter = $("adminStatusFilter");
  elements.nfcToolBtn = $("nfcToolBtn");

  // EDIT COURT ELEMENTS
  elements.editCourtPage = $("editCourtPage");
  elements.editCourtNameTitle = $("editCourtNameTitle");
  elements.editCourtName = $("editCourtName");
  elements.editTeamAName = $("editTeamAName");
  elements.editTeamBName = $("editTeamBName");
  elements.editCourtPassword = $("editCourtPassword");
  elements.editCourtStatus = $("editCourtStatus");
  elements.editCourtScoringMode = $("editCourtScoringMode");
  elements.clearCourtScoreBtn = $("clearCourtScoreBtn");
  elements.saveEditBtn = $("saveEditBtn");
  elements.deleteCourtBtn = $("deleteCourtBtn");
  elements.closeEditBtn = $("closeEditBtn");

  //PLAY COURT ELEMENTS
  elements.playPage = $("playPage");
  elements.closePlayBtn = $("closePlayBtn");

  elements.playCourtSearch = $("playCourtSearch");
  elements.playCourtList = $("playCourtList");
  elements.playPasswordSection = $("playPasswordSection");
  elements.playCourtPassword = $("playCourtPassword");
  elements.playCourtNameError = $("playCourtNameError");
  elements.playCourtPasswordError = $("playCourtPasswordError");
  elements.playBackBtn = $("playBackBtn");

  elements.enterCourtBtn = $("enterCourtBtn");

  //SPECTATE COURT ELEMENTS
  elements.spectatePage = $("spectatePage");
  elements.closeSpectateBtn = $("closeSpectateBtn");

  elements.spectateCourtSearch = $("spectateCourtSearch");
  elements.spectateCourtList = $("spectateCourtList");
  elements.spectateCourtNameError = $("spectateCourtNameError");

  let allCourts = [];
  let filteredCourts = [];
  let selectedPlayCourt = null;
  let currentCourtName = null;
  let playPageReturnToScoreboard = false;

  let allAdminCourts = [];

  //RESET COURT ELEMENTS
  elements.resetCourtPassword = $("resetCourtPassword");
  elements.resetPasswordError = $("resetPasswordError");

  //NFC ELEMENTS
  elements.nfcCooldownBanner = $("nfcCooldownBanner");
  elements.nfcCountdown = $("nfcCountdown");

  //Admin portal things
  elements.adminTabs = document.querySelectorAll('.tab-btn');
  elements.courtsTab = $("courtsTab");
  elements.devicesTab = $("devicesTab");
  elements.adminDeviceList = $("adminDeviceList");
  elements.adminDeviceSearch = $("adminDeviceSearch");

  // Add/Edit Device Modal Elements
  elements.addDevicePage = $("addDevicePage");
  elements.showAddDeviceModalBtn = $("showAddDeviceModalBtn");
  elements.closeAddDeviceBtn = $("closeAddDeviceBtn");
  elements.saveNewDeviceBtn = $("saveNewDeviceBtn");
  elements.newDeviceId = $("newDeviceId");
  // Combo elements — Add Device
  elements.newDeviceCourtIdSelect = $("newDeviceCourtIdSelect");
  elements.newDeviceCourtIdManual = $("newDeviceCourtIdManual");
  elements.newDeviceManualToggle = $("newDeviceManualToggle");
  elements.newDeviceDropdownToggle = $("newDeviceDropdownToggle");
  elements.newDeviceDropdownToggleRow = $("newDeviceDropdownToggleRow");

  elements.editDevicePage = $("editDevicePage");
  elements.editDeviceIdTitle = $("editDeviceIdTitle");
  // Combo elements — Edit Device
  elements.editDeviceCourtIdSelect = $("editDeviceCourtIdSelect");
  elements.editDeviceCourtIdManual = $("editDeviceCourtIdManual");
  elements.editDeviceManualToggle = $("editDeviceManualToggle");
  elements.editDeviceDropdownToggle = $("editDeviceDropdownToggle");
  elements.editDeviceDropdownToggleRow = $("editDeviceDropdownToggleRow");
  elements.saveEditDeviceBtn = $("saveEditDeviceBtn");
  elements.deleteDeviceBtn = $("deleteDeviceBtn");
  elements.closeEditDeviceBtn = $("closeEditDeviceBtn");

  let allDevices = [];

  // =====================================================
  // INITIALIZE THEME
  // =====================================================

  initializeTheme();
  initializeWaves();
  updateFullscreenButton();

  ["fullscreenchange", "webkitfullscreenchange", "MSFullscreenChange"].forEach(eventName =>
  {
    document.addEventListener(eventName, () =>
    {
      updateFullscreenButton();
      syncSettingsTiles();
    });
  });

  // =====================================================
  // ENTER KEY SUBMIT LISTENERS
  // =====================================================

  function submitOnEnter(inputEl, buttonEl)
  {
    if (!inputEl || !buttonEl) return;

    inputEl.addEventListener("keydown", (e) =>
    {
      if (e.key === "Enter")
      {
        e.preventDefault();
        buttonEl.click();
      }
    });
  }

  function submitFormOnEnter(formEl)
  {
    if (!formEl) return;

    formEl.addEventListener("keydown", (e) =>
    {
      if (e.key !== "Enter") return;
      const target = e.target;
      if (target && (target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      const submitButton = formEl.querySelector("button[type='submit'], .primary-btn");
      if (submitButton)
      {
        e.preventDefault();
        submitButton.click();
      }
    });
  }

  // CREATE PAGE
  submitOnEnter(elements.courtName, elements.createCourtBtn);
  submitOnEnter(elements.courtPassword, elements.createCourtBtn);
  submitFormOnEnter(elements.createPage);

  // ADMIN AUTH PAGE
  submitOnEnter(elements.adminAuthPassword, elements.submitAdminAuthBtn);
  submitFormOnEnter(elements.adminAuthPage);

  // PLAY PAGE
  submitOnEnter(elements.playCourtPassword, elements.enterCourtBtn);
  submitFormOnEnter(elements.playPage);

  // SPECTATE PAGE
  submitFormOnEnter(elements.spectatePage);

  // RESET MODAL
  submitOnEnter(elements.resetCourtPassword, elements.confirmResetBtn);
  submitFormOnEnter(elements.resetModal);

  // ADMIN DASHBOARD SEARCH & FILTER
  elements.adminCourtSearch.addEventListener("input", filterAndDisplayAdminCourts);
  elements.adminStatusFilter.addEventListener("change", filterAndDisplayAdminCourts);

  // =====================================================
  // ESC KEY HANDLING (DISMISS MODALS / PAGES)
  // =====================================================

  document.addEventListener("keydown", (e) =>
  {
    if (e.key !== "Escape") return;

    const isVisible = (el) =>
      window.getComputedStyle(el).display !== "none";

    if (playPageReturnToScoreboard) 
    {
      closePlayPage();
      return;
    }

    if (isVisible(elements.resetModal))
    {
      elements.resetModal.classList.add("hidden");
      return;
    }

    if (isVisible(elements.settingsModal))
    {
      elements.settingsModal.classList.add("hidden");
      return;
    }

    if (isVisible(elements.detailsModal))
    {
      elements.detailsModal.classList.add("hidden");
      return;
    }

    if (isVisible(elements.confirmModal))
    {
      elements.confirmCancelBtn.click();
      return;
    }

    if (isVisible(elements.playPage))
    {
      setPlayPageVisible(false);
      elements.menuPage.style.display = "flex";
      return;
    }

    if (isVisible(elements.spectatePage))
    {
      elements.spectatePage.style.display = "none";
      elements.menuPage.style.display = "flex";
      return;
    }

    if (isVisible(elements.scoreboardPage))
    {
      leaveCourt();
      return;
    }

    if (isVisible(elements.adminAuthPage))
    {
      elements.adminAuthPage.style.display = "none";
      elements.menuPage.style.display = "flex";
      return;
    }

    if (isVisible(elements.adminDashboardPage))
    {
      isAdmin = false;
      elements.adminDashboardPage.style.display = "none";
      elements.menuPage.style.display = "flex";
      return;
    }

    if (isVisible(elements.createPage))
    {
      elements.createPage.style.display = "none";
      elements.adminDashboardPage.style.display = "flex";
      return;
    }

    if (isVisible(elements.addDevicePage))
    {
      elements.addDevicePage.style.display = "none";
      elements.adminDashboardPage.style.display = "flex";
      return;
    }

    if (isVisible(elements.editCourtPage))
    {
      elements.editCourtPage.style.display = "none";
      elements.adminDashboardPage.style.display = "flex";
      displayAdminCourtList();
      return;
    }

    if (isVisible(elements.editDevicePage))
    {
      elements.editDevicePage.style.display = "none";
      elements.adminDashboardPage.style.display = "flex";
      loadDevices();
      return;
    }
  });

  // =====================================================
  // HOTKEYS
  // =====================================================

  document.addEventListener("keydown", (e) =>
  {
    // Never fire hotkeys when typing in an input, textarea, or select
    const tag = document.activeElement?.tagName?.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return;

    // Also skip if any modifier key is held (Ctrl, Alt, Meta)
    if (e.ctrlKey || e.altKey || e.metaKey) return;

    const isVisible = (el) => el && window.getComputedStyle(el).display !== "none";

    const onMenu = isVisible(elements.menuPage);
    const onScoreboard = isVisible(elements.scoreboardPage);

    const key = e.key;

    // ── T : Toggle theme (works everywhere) ──────────────────────────
    if (key === "t" || key === "T")
    {
      toggleTheme();
      return;
    }

    // ── ` : Open admin portal (works from menu) ───────────────────────
    if (key === "`")
    {
      if (onMenu)
      {
        e.preventDefault();
        elements.adminLoginBtn.click();
      }
      return;
    }

    // ── Menu-page hotkeys ─────────────────────────────────────────────
    if (onMenu)
    {
      // P : Open play menu
      if (key === "p" || key === "P")
      {
        e.preventDefault();
        const playBtn = document.querySelector(".menu-btn[data-action='start']");
        if (playBtn) playBtn.click();
        return;
      }

      // S : Open spectate menu
      if (key === "s" || key === "S")
      {
        e.preventDefault();
        const btns = document.querySelectorAll(".menu-btn[data-action='start']");
        if (btns.length >= 2) btns[1].click(); // second button is Spectate
        return;
      }
    }

    // ── Scoreboard-page hotkeys ───────────────────────────────────────
    if (onScoreboard)
    {
      // Q : Exit the court
      if (key === "q" || key === "Q")
      {
        elements.backBtn.click();
        return;
      }

      // R : Reset court
      if (key === "r" || key === "R")
      {
        if (!isSpectating)
        {
          e.preventDefault();
          // Open settings modal to the reset tile
          elements.settingsBtn.click();
        }
        return;
      }

      // U : Undo
      if (key === "u" || key === "U")
      {
        if (!isSpectating) elements.undoBtn.click();
        return;
      }

      // M : Mute / unmute
      if (key === "m" || key === "M")
      {
        if (!isSpectating) elements.muteBtn.click();
        return;
      }

      // S : Switch / swap sides
      if (key === "s" || key === "S")
      {
        elements.swapBtn.click();
        return;
      }

      // A / 1 : Add point for Team A
      if ((key === "a" || key === "A" || key === "1") && !isSpectating)
      {
        addPoint(EVENT_TYPES.POINT_TEAM_A);
        return;
      }

      // B / 2 : Add point for Team B
      if ((key === "b" || key === "B" || key === "2") && !isSpectating)
      {
        addPoint(EVENT_TYPES.POINT_TEAM_B);
        return;
      }

      // W : Toggle waves
      if (key === "w" || key === "W")
      {
        toggleWaves();
        return;
      }

      // O : Open settings
      if (key === "o" || key === "O")
      {
        elements.settingsBtn.click();
        return;
      }

      // D : Open match details
      if (key === "d" || key === "D")
      {
        e.preventDefault();
        elements.detailsBtn.click();
        return;
      }
    }
  });

  // =====================================================
  // MENU TOGGLE
  // =====================================================

  async function getSkeleton()
  {
    const adminref = doc(db, "admin", "goodies");
    const adminSnap = await getDoc(adminref);
    return adminSnap.data().skeletonKey;
  }

  // =====================================================
  // COURT LOADING & FILTERING
  // =====================================================

  async function loadAllActiveCourts(includePrivateCourts = true)
  {
    try
    {
      const courtsCollection = collection(db, "courts");
      const snapshot = await getDocs(courtsCollection);
      allCourts = [];
      snapshot.forEach(doc =>
      {
        let data = doc.data();
        if (data.status === STATUS.OPEN || (includePrivateCourts && data.status === STATUS.PRIVATE))
        {
          allCourts.push({
            id: doc.id,
            name: data.name || doc.id,
            password: data.password,
            createdAt: data.createdAt,
            status: data.status
          });
        }
      });

      allCourts.sort((a, b) => a.name.localeCompare(b.name));
      filteredCourts = [...allCourts];
    }
    catch (error)
    {
      console.error("Error loading courts:", error);
      allCourts = [];
      filteredCourts = [];
    }
  }

  function filterCourts(searchTerm, courts)
  {
    const term = searchTerm.toLowerCase().trim();
    if (!term) return courts;
    return courts.filter(court =>
      court.name.toLowerCase().includes(term) ||
      court.id.toLowerCase().includes(term)
    );
  }

  function displayPlayCourtList(courts)
  {
    const listContainer = elements.playCourtList;
    listContainer.innerHTML = "";

    if (courts.length === 0)
    {
      listContainer.innerHTML = '<div class="no-courts">No courts found</div>';
      return;
    }

    courts.forEach(court =>
    {
      const item = document.createElement("div");
      item.className = "court-item";
      item.dataset.courtName = court.name;
      item.dataset.courtId = court.id;

      item.innerHTML = `
      <div class="court-item-name">${court.name}</div>
    `;

      item.addEventListener("click", () =>
      {
        selectedPlayCourt = court.id;
        elements.playCourtSearch.value = court.name;
        elements.playCourtList.querySelectorAll(".court-item").forEach(el =>
        {
          el.classList.remove("active");
        });
        item.classList.add("active");
        elements.playPasswordSection.style.display = "block";
        elements.playCourtPassword.focus();
        elements.playCourtNameError.textContent = "";
        elements.playCourtPasswordError.textContent = "";
      });

      listContainer.appendChild(item);
    });
  }

  function displaySpectateCourtList(courts)
  {
    const listContainer = elements.spectateCourtList;
    listContainer.innerHTML = "";

    if (courts.length === 0)
    {
      listContainer.innerHTML = '<div class="no-courts">No courts found</div>';
      return;
    }

    courts.forEach(court =>
    {
      const item = document.createElement("div");
      item.className = "court-item";
      item.dataset.courtName = court.name;
      item.dataset.courtId = court.id;

      item.innerHTML = `
      <div class="court-item-name">${court.name}</div>
    `;

      item.addEventListener("click", async () =>
      {
        await enterCourt(court.id, true);
      });

      listContainer.appendChild(item);
    });
  }

  async function displayAdminCourtList()
  {
    elements.adminCourtList.innerHTML = '<div class="loading">Loading all courts...</div>';

    try
    {
      const courtsCollection = collection(db, "courts");
      const snapshot = await getDocs(courtsCollection);

      const courtPromises = snapshot.docs.map(async (courtDoc) =>
      {
        const data = courtDoc.data();
        return {
          id: courtDoc.id,
          ...data
        };
      });

      allAdminCourts = await Promise.all(courtPromises);
      allAdminCourts.sort((a, b) => a.id.localeCompare(b.id));

      filterAndDisplayAdminCourts();
    }
    catch (error)
    {
      console.error("Error loading admin courts:", error);
      elements.adminCourtList.innerHTML = '<div class="error">Error loading courts.</div>';
    }
  }

  function filterAndDisplayAdminCourts()
  {
    const searchTerm = elements.adminCourtSearch.value.toLowerCase().trim();
    const statusFilter = elements.adminStatusFilter.value;

    const filtered = allAdminCourts.filter(court =>
    {
      const matchesSearch =
        (court.name || "").toLowerCase().includes(searchTerm) ||
        court.id.toLowerCase().includes(searchTerm);

      const matchesStatus = statusFilter === "all" || court.status === statusFilter;

      return matchesSearch && matchesStatus;
    });

    renderAdminCourtList(filtered);
  }

  function renderAdminCourtList(courts)
  {
    elements.adminCourtList.innerHTML = "";

    if (courts.length === 0)
    {
      elements.adminCourtList.innerHTML = '<div class="no-courts">No matching courts found.</div>';
      return;
    }

    courts.forEach(court =>
    {
      const item = document.createElement("div");
      item.className = "admin-court-item";

      item.innerHTML = `
          <div class="aci-name">
            <strong>${court.name || "N/A"}</strong>
            <div class="aci-id">ID: ${court.id}</div>
          </div>
          <div class="aci-field teams-cell">
            <div class="aci-label">Teams</div>
            <div class="aci-value">
              ${court.teamNames?.A || "A"} vs ${court.teamNames?.B || "B"}
            </div>
          </div>
          <div class="aci-field password-cell">
            <div class="aci-label">Password</div>
            <div class="aci-value"><code>${court.password || "No Password"}</code></div>
          </div>
          <div class="aci-field status-cell">
            <div class="aci-value">
              <span class="status-badge status-${court.status}">${court.status?.toUpperCase() || "UNKNOWN"}</span>
            </div>
          </div>
          <div class="aci-field status-cell">
            <div class="aci-actions">
              <button class="edit-btn" data-id="${court.id}">Edit</button>
            </div>
          </div>
        `;

      item.querySelector(".edit-btn").addEventListener("click", () =>
      {
        openEditModal(court);
      });

      elements.adminCourtList.appendChild(item);
    });
  }

  let courtToEdit = null;

  function openEditModal(court)
  {
    courtToEdit = court;
    const scoringOptions = normalizeScoringOptions({
      ...(court.scoringOptions || {}),
      scoringMode: court.scoringMode || court.scoringOptions?.scoringMode
    });

    elements.editCourtNameTitle.textContent = court.name || court.id;
    elements.editCourtName.value = court.name || "";
    elements.editTeamAName.value = court.teamNames?.A || "";
    elements.editTeamBName.value = court.teamNames?.B || "";
    elements.editCourtPassword.value = court.password || "";
    elements.editCourtStatus.value = court.status || STATUS.CLOSED;
    elements.editCourtScoringMode.value = scoringOptions.scoringMode;

    elements.adminDashboardPage.style.display = "none";
    elements.editCourtPage.style.display = "flex";
  }

  elements.saveEditBtn.addEventListener("click", async () =>
  {
    if (!courtToEdit) return;

    try
    {
      const courtId = courtToEdit.id;
      const newName = elements.editCourtName.value.trim();

      if (!newName) throw new Error("Court name cannot be empty");

      const scoringOptions = normalizeScoringOptions({
        ...(courtToEdit.scoringOptions || {}),
        scoringMode: elements.editCourtScoringMode.value
      });
      const courtRef = doc(db, "courts", courtId);

      await updateDoc(courtRef, {
        name: newName,
        teamNames: {
          A: elements.editTeamAName.value.trim(),
          B: elements.editTeamBName.value.trim()
        },
        password: elements.editCourtPassword.value.trim(),
        status: elements.editCourtStatus.value,
        scoringMode: scoringOptions.scoringMode,
        scoringOptions
      });

      const updateScoringOptions = httpsCallable(functions, "updateScoringOptions");
      const result = await updateScoringOptions({
        courtId,
        scoringMode: scoringOptions.scoringMode,
        scoringOptions
      });
      const serverOptions = normalizeScoringOptions(result?.data?.scoringOptions || scoringOptions);
      const replayedScore = result?.data?.score;
      currentScoringOptions = serverOptions;
      score = replayedScore
        ? {
            ...replayedScore,
            scoringOptions: serverOptions
          }
        : {
            ...score,
            scoringOptions: serverOptions
          };
      syncScoringControls();
      updateUI();

      showToast("Court updated successfully!", TOAST_TYPES.SUCCESS);
      elements.editCourtPage.style.display = "none";
      elements.adminDashboardPage.style.display = "flex";
      displayAdminCourtList();
    }
    catch (err)
    {
      showToast("Failed to update: " + err.message, TOAST_TYPES.ERROR);
    }
  });

  elements.clearCourtScoreBtn.addEventListener("click", async () =>
  {
    if (!courtToEdit) return;

    if (!(await showConfirm(`Clear the existing score for court "${courtToEdit.id}"?`))) return;

    try
    {
      await resetCourt(courtToEdit.id, false);
      showToast("Court score cleared.", TOAST_TYPES.SUCCESS);
    }
    catch (err)
    {
      showToast("Failed to clear score: " + err.message, TOAST_TYPES.ERROR);
    }
  });

  elements.deleteCourtBtn.addEventListener("click", async () =>
  {
    if (!courtToEdit) return;
    if (!(await showConfirm(`Are you sure you want to delete court "${courtToEdit.id}"?\nThis cannot be undone.`))) return;

    try
    {
      await deleteDoc(doc(db, "courts", courtToEdit.id));
      showToast("Court deleted.", TOAST_TYPES.SUCCESS);
      elements.editCourtPage.style.display = "none";
      elements.adminDashboardPage.style.display = "flex";
      displayAdminCourtList();
    }
    catch (err)
    {
      showToast("Delete failed: " + err.message, TOAST_TYPES.ERROR);
    }
  });

  elements.closeEditBtn.addEventListener("click", () =>
  {
    elements.editCourtPage.style.display = "none";
    elements.adminDashboardPage.style.display = "flex";
    displayAdminCourtList();
  });

  elements.adminLoginBtn.addEventListener("click", () =>
  {
    elements.menuPage.style.display = "none";
    elements.adminAuthPage.style.display = "flex";
    elements.adminAuthPassword.value = "";
    elements.adminAuthError.textContent = "";
    elements.adminAuthPassword.focus();
  });

  elements.closeAdminAuthBtn.addEventListener("click", () =>
  {
    elements.adminAuthPage.style.display = "none";
    elements.menuPage.style.display = "flex";
  });

  elements.submitAdminAuthBtn.addEventListener("click", async () =>
  {
    const pass = elements.adminAuthPassword.value.trim();
    const skeleton = await getSkeleton();

    if (pass === skeleton)
    {
      isAdmin = true;
      elements.adminAuthPage.style.display = "none";
      elements.adminDashboardPage.style.display = "flex";
      displayAdminCourtList();
    }
    else
    {
      elements.adminAuthError.textContent = "Incorrect admin password.";
      elements.adminAuthPassword.value = "";
      elements.adminAuthPassword.focus();
    }
  });

  elements.closeAdminDashboardBtn.addEventListener("click", () =>
  {
    isAdmin = false;
    elements.adminDashboardPage.style.display = "none";
    elements.menuPage.style.display = "flex";
  });

  if (elements.nfcToolBtn)
  {
    elements.nfcToolBtn.addEventListener("click", () =>
    {
      window.open("/nfc/index.html", "_blank");
    });
  }

  elements.activateNfcBtn.addEventListener("click", async () =>
  {
    await initNfc();
  });

  elements.showCreateCourtModalBtn.addEventListener("click", () =>
  {
    elements.adminDashboardPage.style.display = "none";
    elements.createPage.style.display = "flex";
    elements.courtName.value = "";
    elements.courtPassword.value = "";
    elements.courtNameError.textContent = "";
    elements.courtPasswordError.textContent = "";
  });

  document.querySelectorAll(".menu-btn").forEach(btn =>
  {
    btn.addEventListener("click", async () =>
    {
      const action = btn.textContent.trim();

      if (action === "Play")
      {
        elements.menuPage.style.display = "none";
        setPlayPageVisible(true);
        elements.playPasswordSection.style.display = "none";
        selectedPlayCourt = null;
        elements.playCourtSearch.value = "";
        elements.playCourtPassword.value = "";
        elements.playCourtNameError.textContent = "";
        elements.playCourtPasswordError.textContent = "";

        await loadAllActiveCourts();
        displayPlayCourtList(allCourts);
        elements.playCourtSearch.focus();
        return;
      }

      if (action === "Spectate")
      {
        elements.menuPage.style.display = "none";
        elements.spectatePage.style.display = "flex";
        elements.spectateCourtSearch.value = "";
        elements.spectateCourtNameError.textContent = "";

        await loadAllActiveCourts(false);
        displaySpectateCourtList(allCourts);
        elements.spectateCourtSearch.focus();
        return;
      }
    });
  });

  function updateAdminButtonVisibility()
  {
    const isMenuVisible = elements.menuPage && window.getComputedStyle(elements.menuPage).display !== "none";
    if (elements.homeLinkBtn)
    {
      const currentVal = elements.homeLinkBtn.style.display;
      const targetVal = isMenuVisible ? "flex" : "none";
      if (currentVal !== targetVal)
      {
        elements.homeLinkBtn.style.display = targetVal;
      }
    }

    if (elements.adminLoginBtn)
    {
      const currentVal = elements.adminLoginBtn.style.display;
      const targetVal = isMenuVisible ? "flex" : "none";
      if (currentVal !== targetVal)
      {
        elements.adminLoginBtn.style.display = targetVal;
      }
    }

    if (elements.appearanceMenuBtn)
    {
      const currentVal = elements.appearanceMenuBtn.style.display;
      const targetVal = isMenuVisible ? "flex" : "none";
      if (currentVal !== targetVal)
      {
        if (targetVal === "none") closeAppearanceMenu();
        elements.appearanceMenuBtn.style.display = targetVal;
      }
    }

    updateWavesVisibility();
  }

  // Watch for page changes to toggle admin button
  const observer = new MutationObserver(() => updateAdminButtonVisibility());
  observer.observe(document.body, { attributes: true, childList: true, subtree: true });

  elements.closeCreateBtn.addEventListener("click", () =>
  {
    elements.createPage.style.display = "none";
    if (isAdmin) elements.adminDashboardPage.style.display = "flex";
    else elements.menuPage.style.display = "flex";
  });

  elements.closePlayBtn.addEventListener("click", () =>
  {
    closePlayPage();
  });

  elements.closeSpectateBtn.addEventListener("click", () =>
  {
    elements.spectatePage.style.display = "none";
    elements.menuPage.style.display = "flex";
  });

  if (elements.appearanceMenuBtn)
  {
    elements.appearanceMenuBtn.addEventListener("click", (e) =>
    {
      e.stopPropagation();
      toggleAppearanceMenu();
    });
  }

  document.querySelectorAll("[data-theme-choice]").forEach((button) =>
  {
    button.addEventListener("click", () => setTheme(button.dataset.themeChoice));
  });

  document.querySelectorAll("[data-team-colour]").forEach((input) =>
  {
    input.addEventListener("input", () => setTeamColour(input.dataset.teamColour, input.value));
    input.addEventListener("change", () => setTeamColour(input.dataset.teamColour, input.value));
  });

  document.querySelectorAll(".reset-theme-colours-btn").forEach((button) =>
  {
    button.addEventListener("click", resetTeamColours);
  });

  document.addEventListener("click", (e) =>
  {
    if (!elements.appearanceMenu || elements.appearanceMenu.classList.contains("hidden")) return;
    if (elements.appearanceMenu.contains(e.target) || elements.appearanceMenuBtn?.contains(e.target)) return;
    if (document.querySelector(".team-colour-input.jscolor-active")) return;

    closeAppearanceMenu();
  });

  document.addEventListener("keydown", (e) =>
  {
    if (e.key === "Escape") closeAppearanceMenu();
  });

  if (elements.waveToggleScoreboardBtn)
  {
    elements.waveToggleScoreboardBtn.addEventListener("click", toggleWaves);
  }

  if (elements.waveToggleSpectateBtn)
  {
    elements.waveToggleSpectateBtn.addEventListener("click", toggleWaves);
  }

  elements.playCourtSearch.addEventListener("input", (e) =>
  {
    const searchTerm = e.target.value;
    filteredCourts = filterCourts(searchTerm, allCourts);
    displayPlayCourtList(filteredCourts);
  });

  elements.spectateCourtSearch.addEventListener("input", (e) =>
  {
    const searchTerm = e.target.value;
    filteredCourts = filterCourts(searchTerm, allCourts);
    displaySpectateCourtList(filteredCourts);
  });

  elements.playPage.addEventListener("click", (e) =>
  {
    if (e.target === elements.playPage)
    {
      closePlayPage();
    }
  });

  function setPlayPageVisible(isVisible)
  {
    elements.playPage.style.display = isVisible ? "flex" : "none";
    document.body.classList.toggle("play-page-open", isVisible);
  }

  async function openPlayerJoinPrompt(courtId)
  {
    playPageReturnToScoreboard = true;
    selectedPlayCourt = courtId;

    if (allCourts.length === 0)
    {
      await loadAllActiveCourts();
    }

    displayPlayCourtList(allCourts);

    const court = allCourts.find((item) => item.id === courtId);
    setPlayPageVisible(true);
    elements.playPasswordSection.style.display = "block";
    elements.playCourtSearch.value = court?.name || currentCourtName || courtId;
    elements.playCourtNameError.textContent = "";
    elements.playCourtPasswordError.textContent = "";
    elements.playCourtPassword.value = "";

    const selectedItem = elements.playCourtList.querySelector(`[data-court-id="${courtId}"]`);
    if (selectedItem)
    {
      elements.playCourtList.querySelectorAll(".court-item").forEach(el => el.classList.remove("active"));
      selectedItem.classList.add("active");
    }

    elements.playCourtPassword.focus();
  }

  function closePlayPage()
  {
    setPlayPageVisible(false);

    if (playPageReturnToScoreboard && currentCourtId)
    {
      elements.scoreboardPage.style.display = "flex";
      playPageReturnToScoreboard = false;
      return;
    }

    playPageReturnToScoreboard = false;
    elements.menuPage.style.display = "flex";
  }

  elements.spectatePage.addEventListener("click", (e) =>
  {
    if (e.target === elements.spectatePage)
    {
      elements.spectatePage.style.display = "none";
      elements.menuPage.style.display = "flex";
    }
  });

  elements.adminAuthPage.addEventListener("click", (e) =>
  {
    if (e.target === elements.adminAuthPage)
    {
      elements.adminAuthPage.style.display = "none";
      elements.menuPage.style.display = "flex";
    }
  });

  function showCourtTitle(name)
  {
    const existing = document.getElementById("courtTitle");
    if (existing)
    {
      existing.textContent = name;
      updateMarqueeScrolling();
    }
  }

  function updateMarqueeScrolling()
  {
    const container = document.querySelector(".marquee-wrapper");
    const content = document.querySelector(".marquee-content");
    if (!container || !content) return;

    // Reset before measuring
    content.classList.remove("scrolling");
    content.style.removeProperty("--marquee-vertical-offset");

    const isLandscape = window.innerHeight < window.innerWidth && window.matchMedia("(orientation: landscape)").matches;

    if (isLandscape)
    {
      const containerHeight = container.clientHeight;
      if (containerHeight > 0 && content.scrollHeight > containerHeight)
      {
        content.style.setProperty("--marquee-vertical-offset", `${containerHeight}px`);
        content.classList.add("scrolling");
      }
    }
    else
    {
      if (content.scrollWidth > container.clientWidth)
      {
        content.classList.add("scrolling");
      }
    }
  }

  elements.createCourtBtn.addEventListener("click", async () =>
  {
    const courtName = elements.courtName.value.trim();
    const courtPass = elements.courtPassword.value.trim();
    const scoringMode = elements.courtScoringMode?.value || DEFAULT_SCORING_OPTIONS.scoringMode;
    const scoringOptions = normalizeScoringOptions({ scoringMode });

    elements.courtNameError.textContent = "";
    elements.courtPasswordError.textContent = "";

    if (!courtName)
    {
      elements.courtNameError.textContent = "Court name required.";
      return;
    }

    if (!courtPass)
    {
      elements.courtPasswordError.textContent = "Court password required.";
      return;
    }
    else if (courtPass.length < 4)
    {
      elements.courtPasswordError.textContent = "Password must be at least 4 characters.";
      return;
    }
    else if (courtPass === courtName)
    {
      elements.courtPasswordError.textContent = "Password must be different from court name.";
      return;
    }

    const createRandomCourtId = () =>
      Array.from({ length: 4 }, () =>
        ALLOWED_COURT_ID_CHARS[Math.floor(Math.random() * ALLOWED_COURT_ID_CHARS.length)]
      ).join("");

    const existingCourtsSnapshot = await getDocs(collection(db, "courts"));
    const existingCourtIdsLower = new Set(
      existingCourtsSnapshot.docs.map((courtDoc) => courtDoc.id.toLowerCase())
    );

    let courtId = createRandomCourtId();
    while (existingCourtIdsLower.has(courtId.toLowerCase()))
    {
      courtId = createRandomCourtId();
    }

    courtId = courtId.toLowerCase();

    const courtRef = doc(db, "courts", courtId);

    // Create court metadata
    await setDoc(courtRef, {
      name: courtName,
      password: courtPass,
      createdAt: serverTimestamp(),
      teamNames: { A: "Team A", B: "Team B" },
      status: elements.courtStatus.value,
      scoringMode: scoringOptions.scoringMode,
      scoringOptions
    });

    // Create initial score document
    await setDoc(
      doc(db, "courts", courtId, "score", "current"),
      defaultScore(scoringOptions)
    );

    showToast(`Court "${courtName}" created successfully. ID: ${courtId.toUpperCase()}`, TOAST_TYPES.SUCCESS);

    elements.createPage.style.display = "none";
    if (isAdmin)
    {
      elements.adminDashboardPage.style.display = "flex";
      displayAdminCourtList();
    }
    else
    {
      elements.menuPage.style.display = "flex";
    }

    elements.courtName.value = "";
    elements.courtPassword.value = "";
    if (elements.courtScoringMode) elements.courtScoringMode.value = DEFAULT_SCORING_OPTIONS.scoringMode;
  });

  elements.enterCourtBtn.addEventListener("click", async () =>
  {
    const courtId = selectedPlayCourt;
    const password = elements.playCourtPassword.value.trim();

    elements.playCourtNameError.textContent = "";
    elements.playCourtPasswordError.textContent = "";

    if (!courtId)
    {
      elements.playCourtNameError.textContent = "Court not selected.";
      return;
    }

    if (!password)
    {
      elements.playCourtPasswordError.textContent = "Password required.";
      return;
    }

    const courtRef = doc(db, "courts", courtId);
    const snap = await getDoc(courtRef);

    if (!snap.exists())
    {
      elements.playCourtNameError.textContent = "Court not found.";
      return;
    }

    var adminPassword = await getSkeleton();
    if (password === adminPassword)
    {
      enterCourt(courtId, false);
      return;
    }

    if (snap.data().password !== password)
    {
      elements.playCourtPasswordError.textContent = "Incorrect password.";
      return;
    }

    currentCourtPassword = password;
    enterCourt(courtId, false);
    playPageReturnToScoreboard = false;

    elements.playCourtPassword.value = "";
  });

  async function enterCourt(courtId, spectate)
  {
    console.log(`Entering court: ${courtId}, spectate: ${spectate}`);

    // Warm Firestore connection
    await getDoc(doc(db, "courts", courtId, "score", "current"));
    // Warm Firestore cloud functions
    await addDoc(
      collection(db, "courts", courtId, "events"),
      {
        eventType: "WARMUP",
        createdAt: serverTimestamp(),
        createdBy: thisDeviceId
      }
    );

    const courtRef = doc(db, "courts", courtId);
    const snap = await getDoc(courtRef);
    if (!snap.exists())
    {
      const errorEl = spectate ? elements.spectateCourtNameError : elements.playCourtNameError;
      errorEl.textContent = "Court not found.";
      const listContainer = spectate ? elements.spectateCourtList : elements.playCourtList;
      const selectedItem = listContainer.querySelector(`[data-court-name="${courtId}"]`);
      if (selectedItem)
      {
        selectedItem.remove();
      }
      return;
    }

    currentCourtId = courtId;
    const data = snap.data();
    currentCourtName = data.name || courtId;
    currentCourtPassword = data.password;
    currentCourtStatus = data.status;
    currentScoringOptions = normalizeScoringOptions({
      ...(data.scoringOptions || {}),
      scoringMode: data.scoringMode || data.scoringOptions?.scoringMode
    });
    syncScoringControls();

    if (muted)
    {
      elements.muteBtn.textContent = "🔇";
    }

    if (isWavesEnabled == false)
    {
      elements.waveToggleScoreboardBtn.textContent = "♒︎";
    }

    try
    {
      await initAudio();
      playSound(SOUND_IDS.START);
    }
    catch (err)
    {
      console.warn("Audio initialization failed:", err);
    }

    elements.menuPage.style.display = "none";
    elements.createPage.style.display = "none";
    setPlayPageVisible(false);
    elements.spectatePage.style.display = "none";

    // Hide top-right buttons in court view
    if (elements.appearanceMenuBtn)
    {
      closeAppearanceMenu();
      elements.appearanceMenuBtn.style.display = "none";
    }
    if (elements.adminLoginBtn)
    {
      elements.adminLoginBtn.style.display = "none";
    }
    if (elements.activateNfcBtn)
    {
      elements.activateNfcBtn.classList.add("hidden");
    }

    elements.scoreboardPage.style.display = "flex";
    document.body.classList.add("scoreboard-active");

    if (elements.scoreboardLoading)
    {
      elements.scoreboardLoading.classList.remove("hidden");
    }

    BlankOutScoreboard();

    if (spectate) enableSpectateMode();
    else disableSpectateMode();

    listenToCourt(courtId);

    requestWakeLock();
  }

  function leaveCourt()
  {
    console.log("Leaving court: " + currentCourtId);

    disableSpectateMode();
    releaseWakeLock();

    if (unsubscribe)
    {
      unsubscribe();
      unsubscribe = null;
    }

    currentCourtId = null;
    currentCourtName = null;
    currentCourtPassword = null;
    currentCourtStatus = null;
    currentScoringOptions = { ...DEFAULT_SCORING_OPTIONS };
    syncScoringControls();

    document.body.classList.remove("scoreboard-active");
    if (elements.appearanceMenuBtn) elements.appearanceMenuBtn.style.display = "";
    if (elements.adminLoginBtn) elements.adminLoginBtn.style.display = "";

    if (nfcDenied && elements.activateNfcBtn)
    {
      elements.activateNfcBtn.classList.remove("hidden");
    }

    elements.scoreboardPage.style.display = "none";
    elements.menuPage.style.display = "flex";
  }

  function BlankOutScoreboard()
  {
    showCourtTitle(".");
    const nameA = $("teamA").querySelector(".name-text");
    const nameB = $("teamB").querySelector(".name-text");
    if (nameA)
    {
      nameA.textContent = ".";
      fitTextToContainer(nameA);
    }
    if (nameB)
    {
      nameB.textContent = ".";
      fitTextToContainer(nameB);
    }
    score = defaultScore();
    lastKnownSets = { A: 0, B: 0 };
    sessionInitialized = false;
    updateUI();
  }

  function enableSpectateMode()
  {
    isSpectating = true;

    document.body.classList.add("spectating-mode");

    $("addPointA").style.pointerEvents = "none";
    $("addPointB").style.pointerEvents = "none";

    elements.undoBtn.style.display = "none";
    if (elements.muteBtn.parentElement) elements.muteBtn.parentElement.style.display = "none";
    if (elements.sep1) elements.sep1.style.display = "none";
    if (elements.sep2) elements.sep2.style.display = "none";

    // Hide player-only tiles in the settings modal
    if (elements.serverToggleTile) elements.serverToggleTile.style.display = "none";
    if (elements.resetSettingsTile) elements.resetSettingsTile.style.display = "none";

    if (elements.joinCourtTile) elements.joinCourtTile.style.display = "";

    syncScoringControls();
    showSpectatorBadges();
  }

  function disableSpectateMode()
  {
    isSpectating = false;

    document.body.classList.remove("spectating-mode");

    $("addPointA").style.pointerEvents = "auto";
    $("addPointB").style.pointerEvents = "auto";

    // Use "" to let CSS (flex) decide display, not "inline-block"
    elements.undoBtn.style.display = "";
    if (elements.muteBtn.parentElement) elements.muteBtn.parentElement.style.display = "";
    if (elements.sep1) elements.sep1.style.display = "";
    if (elements.sep2) elements.sep2.style.display = "";

    // Restore player-only tiles in the settings modal
    if (elements.serverToggleTile) elements.serverToggleTile.style.display = "";
    if (elements.resetSettingsTile) elements.resetSettingsTile.style.display = "";

    if (elements.joinCourtTile) elements.joinCourtTile.style.display = "none";

    syncScoringControls();
    removeSpectatorBadges();
  }

  function showSpectatorBadges()
  {
    const slot = document.querySelector(".header-spectator-badge-slot") || document.body;

    let badge = document.getElementById(`spectatorBadge`);

    if (!badge)
    {
      badge = document.createElement("div");
      badge.id = `spectatorBadge`;
      badge.className = "spectator-badge";
      badge.textContent = " LIVE";
      slot.appendChild(badge);
    }
  }

  function removeSpectatorBadges()
  {
    const badge = document.getElementById(`spectatorBadge`);
    if (badge) badge.remove();
  }

  async function registerDeviceToCurrentCourt()
  {

    if (!currentCourtId)
    {
      showToast("Cannot register device - enter a court first.", TOAST_TYPES.ERROR);
      return;
    }

    let deviceId = lastScannedDeviceId;
    lastScannedDeviceId = null;

    if (!deviceId)
    {
      showToast("Scan failed - no device ID found on tag.", TOAST_TYPES.ERROR);
      return;
    }

    await updateDoc(doc(db, "devices", deviceId), {
      courtId: currentCourtId
    });

    showToast(`Device ${deviceId} registered to this court.`, TOAST_TYPES.SUCCESS);
  }

  // =====================================================
  // SOUND LOGIC
  // =====================================================

  let audioContext = null;
  let audioBuffers = {};
  let audioReady = false;

  async function initAudio()
  {
    if (audioReady) return;

    audioContext = new (window.AudioContext || window.webkitAudioContext)();

    await Promise.all([
      loadSound("pointSound", "media/sfx/point.mp3"),
      loadSound("undoSound", "media/sfx/undo.mp3"),
      loadSound("swooshSound", "media/sfx/swoosh.mp3"),
      loadSound("startSound", "media/sfx/start.mp3"),
      loadSound("warningSound", "media/sfx/warning.mp3"),
      loadSound("popSound", "media/sfx/pop.mp3"),
      loadSound("snapSound", "media/sfx/snap.mp3"),
      loadSound("setSound", "media/sfx/set.mp3")
    ]);

    audioReady = true;
  }

  function loadSound(id, url)
  {
    return fetch(url)
      .then(r => r.arrayBuffer())
      .then(buffer => audioContext.decodeAudioData(buffer))
      .then(decoded =>
      {
        audioBuffers[id] = decoded;
      });
  }

  async function playSound(id, force = false)
  {
    if (muted && !force) return;

    if (!audioReady)
    {
      await initAudio();
    }

    const buffer = audioBuffers[id];
    if (!buffer) return;

    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    source.start();
  }

  // =====================================================
  // SCORE LOGIC
  // =====================================================

  let isSyncingScoringControls = false;

  function syncScoringControls()
  {
    isSyncingScoringControls = true;
    const options = resolveScoringOptions(score);

    if (elements.scoringModeSelect) elements.scoringModeSelect.value = options.scoringMode;
    if (elements.deuceModeSelect) elements.deuceModeSelect.value = options.deuceMode;
    if (elements.tiebreakModeSelect) elements.tiebreakModeSelect.value = options.tiebreakMode;

    const standardFormat = options.scoringMode === "standard";
    [elements.scoringModeSelect, elements.deuceModeSelect, elements.tiebreakModeSelect].forEach(select =>
    {
      if (select) select.disabled = isSpectating || !currentCourtId;
    });

    if (elements.deuceModeSelect) elements.deuceModeSelect.disabled = isSpectating || !currentCourtId || !standardFormat;
    if (elements.tiebreakModeSelect) elements.tiebreakModeSelect.disabled = isSpectating || !currentCourtId || !standardFormat;

    if (elements.scoringStatus)
    {
      if (isSpectating)
      {
        elements.scoringStatus.textContent = "Spectating";
      }
      else if (options.scoringMode === "straight")
      {
        elements.scoringStatus.textContent = "Running point totals";
      }
      else if (options.scoringMode === "tiebreakTen")
      {
        elements.scoringStatus.textContent = "Single 10-point tiebreak";
      }
      else
      {
        elements.scoringStatus.textContent = `${SCORING_LABELS[options.deuceMode]}, ${SCORING_LABELS[options.tiebreakMode]}`;
      }
    }

    isSyncingScoringControls = false;
  }

  function readScoringControls()
  {
    const scoringMode = elements.scoringModeSelect?.value || DEFAULT_SCORING_OPTIONS.scoringMode;
    const standardFormat = scoringMode === "standard";

    return normalizeScoringOptions({
      scoringMode,
      deuceMode: standardFormat ? elements.deuceModeSelect?.value : DEFAULT_SCORING_OPTIONS.deuceMode,
      tiebreakMode: standardFormat ? elements.tiebreakModeSelect?.value : DEFAULT_SCORING_OPTIONS.tiebreakMode
    });
  }

  async function saveScoringOptionsFromSettings()
  {
    if (isSyncingScoringControls || isSpectating || !currentCourtId) return;

    const nextOptions = readScoringControls();
    if (areScoringOptionsEqual(nextOptions, currentScoringOptions)) return;

    try
    {
      if (elements.scoringStatus) elements.scoringStatus.textContent = "Recalculating...";
      [elements.scoringModeSelect, elements.deuceModeSelect, elements.tiebreakModeSelect].forEach(select =>
      {
        if (select) select.disabled = true;
      });

      const updateScoringOptions = httpsCallable(functions, "updateScoringOptions");
      const result = await updateScoringOptions({
        courtId: currentCourtId,
        scoringOptions: nextOptions,
        scoringMode: nextOptions.scoringMode
      });

      const serverOptions = normalizeScoringOptions(result?.data?.scoringOptions || nextOptions);
      const replayedScore = result?.data?.score;
      currentScoringOptions = serverOptions;
      score = replayedScore
        ? {
            ...replayedScore,
            scoringOptions: serverOptions
          }
        : {
            ...score,
            scoringOptions: serverOptions
          };
      syncScoringControls();
      updateUI();
      showToast("Scoring updated", TOAST_TYPES.SUCCESS);
    }
    catch (err)
    {
      console.error("Scoring update failed:", err);
      showToast("Scoring update failed: " + (err.message || "Unknown error"), TOAST_TYPES.ERROR);
      syncScoringControls();
    }
  }

  async function addPoint(addpointevent)
  {
    await addDoc(
      collection(db, "courts", currentCourtId, "events"),
      {
        eventType: addpointevent,
        createdAt: serverTimestamp(),
        createdBy: thisDeviceId
      }
    );

    animate(addpointevent === EVENT_TYPES.POINT_TEAM_A ? "A" : "B");
    playSound(SOUND_IDS.POINT);
  }

  async function undoLastPoint()
  {
    if (isSpectating) return;

    try
    {
      await addDoc(
        collection(db, "courts", currentCourtId, "events"),
        {
          eventType: EVENT_TYPES.UNDO,
          createdAt: serverTimestamp(),
          createdBy: thisDeviceId
        }
      );

      if (score.lastPointTeam)
      {
        animateUndo(score.lastPointTeam);
      }

      playSound(SOUND_IDS.UNDO);
      animateUndo(score.lastPointTeam);
    }
    catch (err)
    {
      console.error("Undo failed:", err);
    }
  }

  // =====================================================
  // UI
  // =====================================================

  function usesNumericPoints()
  {
    const options = resolveScoringOptions(score);
    return options.scoringMode === "straight" ||
      options.scoringMode === "tiebreakTen" ||
      score.inTiebreak;
  }

  function pointLabel(p)
  {
    if (usesNumericPoints()) return p;
    return p === 4 ? "Ad" : (POINTS[p] ?? p);
  }

  function getCompletedMatchGames(currentScore)
  {
    const completedSets = Array.isArray(currentScore.completedSets) ? currentScore.completedSets : [];
    const completedGames = completedSets.reduce((sum, set) =>
    {
      const setA = Number(set.A) || 0;
      const setB = Number(set.B) || 0;
      return sum + setA + setB;
    }, 0);

    return completedGames + (Number(currentScore.A.games) || 0) + (Number(currentScore.B.games) || 0);
  }

  function getGameServerLabel(totalCompletedGames)
  {
    const servingTeam = totalCompletedGames % 2 === 0 ? "A" : "B";
    const serviceRotationIndex = Math.floor(totalCompletedGames / 2);
    const playerNumber = serviceRotationIndex % 2 === 0 ? "1" : "2";
    return `${servingTeam}${playerNumber}`;
  }

  function getTiebreakServerLabel(currentScore)
  {
    const totalCompletedGames = getCompletedMatchGames(currentScore);
    const startingServer = getGameServerLabel(totalCompletedGames);
    const totalPoints = (Number(currentScore.A.points) || 0) + (Number(currentScore.B.points) || 0);

    if (totalPoints === 0)
    {
      return startingServer;
    }

    const startingTeam = startingServer[0];
    const oppositeTeam = startingTeam === "A" ? "B" : "A";
    const segment = Math.floor((totalPoints + 1) / 2);
    const servingTeam = segment % 2 === 0 ? startingTeam : oppositeTeam;
    const serviceSegmentIndex = Math.floor(segment / 2);
    const playerNumber = serviceSegmentIndex % 2 === 0 ? "1" : "2";

    return `${servingTeam}${playerNumber}`;
  }

  function getCurrentServerLabel(currentScore)
  {
    if (!currentScore || currentScore.matchComplete)
    {
      return null;
    }

    const options = resolveScoringOptions(currentScore);
    if (options.scoringMode === "straight")
    {
      return null;
    }

    const totalCompletedGames = getCompletedMatchGames(currentScore);
    const isStandardTiebreak = options.scoringMode === "standard" &&
      (currentScore.inTiebreak || (currentScore.A.games === 6 && currentScore.B.games === 6));
    const isMatchTiebreak = options.scoringMode === "tiebreakTen";

    if (isStandardTiebreak || isMatchTiebreak)
    {
      return getTiebreakServerLabel(currentScore);
    }

    return getGameServerLabel(totalCompletedGames);
  }

  function getCriticalPointStatus(currentScore)
  {
    const status = {
      A: null, // "Game", "Set", "Match", or null
      B: null
    };

    if (!currentScore || currentScore.matchComplete)
    {
      return status;
    }

    const options = resolveScoringOptions(currentScore);

    if (options.scoringMode === "straight")
    {
      return status;
    }

    const teams = ["A", "B"];

    for (const team of teams)
    {
      const opponent = team === "A" ? "B" : "A";

      if (options.scoringMode === "tiebreakTen")
      {
        const target = 10;
        const pts = currentScore[team].points;
        const oppPts = currentScore[opponent].points;
        if (pts >= target - 1 && (pts - oppPts) >= 1)
        {
          status[team] = "Match";
        }
        continue;
      }

      // Standard scoring mode
      if (currentScore.inTiebreak || (currentScore.A.games === 6 && currentScore.B.games === 6))
      {
        const target = options.tiebreakMode === "sixAllTen" ? 10 : 7;
        const pts = currentScore[team].points;
        const oppPts = currentScore[opponent].points;

        if (pts >= target - 1 && (pts - oppPts) >= 1)
        {
          if (currentScore[team].sets === 1)
          {
            status[team] = "Match";
          }
          else
          {
            status[team] = "Set";
          }
        }
      }
      else
      {
        const pts = currentScore[team].points;
        const oppPts = currentScore[opponent].points;
        const gms = currentScore[team].games;
        const oppGms = currentScore[opponent].games;

        let winsGame = false;
        if (pts === 3 && oppPts < 3)
        {
          winsGame = true;
        }
        else if (pts === 3 && oppPts === 3)
        {
          if (options.deuceMode === "golden" || (options.deuceMode === "silver" && currentScore.deuceCycles > 0))
          {
            winsGame = true;
          }
        }
        else if (pts === 4)
        {
          winsGame = true;
        }

        if (winsGame)
        {
          let winsSet = false;
          if (gms === 5 && oppGms <= 4)
          {
            winsSet = true;
          }
          else if (gms === 6 && oppGms === 5)
          {
            winsSet = true;
          }

          if (winsSet)
          {
            if (currentScore[team].sets === 1)
            {
              status[team] = "Match";
            }
            else
            {
              status[team] = "Set";
            }
          }
          else
          {
            status[team] = "Game";
          }
        }
      }
    }

    return status;
  }

  function updateScoreFormatBadge()
  {
    if (!elements.scoreFormatBadge) return;

    const options = resolveScoringOptions(score);
    const total = (score.A.totalPoints || 0) + (score.B.totalPoints || 0);
    let label = "";

    if (options.scoringMode === "straight")
    {
      label = `Straight points - total ${total}`;
    }
    else if (options.scoringMode === "tiebreakTen")
    {
      label = "Tiebreak Tens - first to 10, win by 2";
    }
    else if (score.inTiebreak)
    {
      label = options.tiebreakMode === "sixAllTen" ? "10-point tiebreak" : "7-point tiebreak";
    }

    elements.scoreFormatBadge.textContent = label;
    elements.scoreFormatBadge.classList.toggle("hidden", !label);
  }

  function updateUI()
  {
    updateScoreFormatBadge();

    const options = resolveScoringOptions(score);
    const standardFormat = options.scoringMode === "standard";

    // Hide sets/games if not applicable
    document.querySelectorAll(".sets-row").forEach(el => el.classList.toggle("hidden", !standardFormat));
    document.querySelectorAll(".games-row").forEach(el => el.classList.toggle("hidden", !standardFormat));

    // Update straight-points total display
    const isStraight = options.scoringMode === "straight";
    if (elements.straightPointsTotal)
    {
      elements.straightPointsTotal.classList.toggle("hidden", !isStraight);
      if (isStraight && elements.straightTotalValue)
      {
        const total = (score.A.totalPoints || 0) + (score.B.totalPoints || 0);
        elements.straightTotalValue.textContent = total;
      }
    }

    // Update critical point indicators
    const criticalStatus = getCriticalPointStatus(score);

    ["A", "B"].forEach(team =>
    {
      renderSets(team);
      renderGames(team);
      elements.points[team].textContent = pointLabel(score[team].points);

      document.querySelector(`#team${team} .indicator`).style.opacity =
        score.lastPointTeam === team ? 1 : 0;

      // Toggle critical pulsate on the score display
      const statusVal = criticalStatus[team];
      elements.points[team].classList.toggle("is-critical", !!statusVal);

      // Keep the badge element hidden (replaced by pulsate effect)
      const badge = elements.critical[team];
      if (badge) badge.classList.add("hidden");
    });

    // Detect Set Win - Only check if session is baseline-synced
    if (sessionInitialized)
    {
      if (score.A.sets > lastKnownSets.A)
      {
        triggerSetWinAnimation("A");
      }
      else if (score.B.sets > lastKnownSets.B)
      {
        triggerSetWinAnimation("B");
      }

      // Update baseline after detecting increments
      lastKnownSets.A = score.A.sets;
      lastKnownSets.B = score.B.sets;
    }

    updateServerIndicator();
  }

  function updateServerIndicator()
  {
    if (!elements.serverBadgeA || !elements.serverBadgeB)
    {
      return;
    }

    const label = getCurrentServerLabel(score);
    const teamAServing = isServerBadgeVisible && label?.startsWith("A");
    const teamBServing = isServerBadgeVisible && label?.startsWith("B");

    elements.serverBadgeA.classList.toggle("hidden", !teamAServing);
    elements.serverBadgeB.classList.toggle("hidden", !teamBServing);

    if (teamAServing)
    {
      elements.serverBadgeA.textContent = `${label}`;
    }
    if (teamBServing)
    {
      elements.serverBadgeB.textContent = `${label}`;
    }
  }

  function triggerSetWinAnimation(team)
  {
    const isMenuVisible = elements.settingsModal && window.getComputedStyle(elements.settingsModal).display !== "none";
    if (isMenuVisible)
    {
      return;
    } 

    const overlay = elements.setWinOverlay;
    if (!overlay) return;

    const teamNameEl = overlay.querySelector(".set-win-team-name");
    const nameA = $("teamA").querySelector(".name-text").textContent;
    const nameB = $("teamB").querySelector(".name-text").textContent;

    teamNameEl.textContent = team === "A" ? nameA : nameB;
    overlay.dataset.winner = team;

    const isTiebreakTen = resolveScoringOptions(score).scoringMode === "tiebreakTen";
    overlay.querySelector(".set-win-label").textContent = isTiebreakTen ? "WINS THE MATCH!" : "WINS THE SET!";
    
    overlay.querySelector(".sw-score-a").textContent = isTiebreakTen ? score.A.points : score.A.sets;
    overlay.querySelector(".sw-score-b").textContent = isTiebreakTen ? score.B.points : score.B.sets;
  
    // Remove hidden immediately to start transition
    overlay.classList.remove("hidden");

    playSound(SOUND_IDS.SET); // Respect mute setting

    // Clear any previous timeout to avoid multiple hide calls
    if (overlay.hideTimeout) clearTimeout(overlay.hideTimeout);

    overlay.hideTimeout = setTimeout(() =>
    {
      overlay.classList.add("hidden");
    }, 4500);

    // Initialise click-to-dismiss only once
    if (!overlay.onclick)
    {
      overlay.onclick = () =>
      {
        overlay.classList.add("hidden");
        if (overlay.hideTimeout) clearTimeout(overlay.hideTimeout);
      };
    }
  }

  function animate(team)
  {
    const el = $(`team${team}`);
    el.classList.remove("score-animate");
    void el.offsetWidth;
    el.classList.add("score-animate");
  }

  function animateUndo(team)
  {
    const el = elements.points[team];
    if (!el) return;
    el.classList.remove("undo-flash");
    void el.offsetWidth;
    el.classList.add("undo-flash");
  }

  function renderSets(team)
  {
    const el = elements.sets[team];
    const opp = team === "A" ? "B" : "A";

    const teamSets = score[team].sets;
    const oppSets = score[opp].sets;
    const maxSets = Math.max(teamSets, oppSets, 3);

    el.innerHTML = "";

    for (let i = 0; i < maxSets; i++)
    {
      const dot = document.createElement("span");
      dot.className = "set-dot";
      dot.setAttribute("data-team", team);

      if (i < teamSets)
      {
        dot.classList.add("filled");
      }

      if (i === teamSets - 1 && score.lastSetTeam === team)
      {
        dot.classList.add("recent");
      }

      el.appendChild(dot);
    }
  }

  function renderGames(team)
  {
    const el = elements.games[team];
    const opp = team === "A" ? "B" : "A";

    const teamGames = score[team].games;
    const oppGames = score[opp].games;
    const maxGames = Math.max(teamGames, oppGames, 6);

    el.innerHTML = "";

    for (let i = 0; i < maxGames; i++)
    {
      const dot = document.createElement("span");
      dot.className = "game-dot";
      if (i < teamGames) dot.classList.add("filled");
      el.appendChild(dot);
    }
  }

  function showToast(message, toastType = TOAST_TYPES.SUCCESS)
  {
    const container = document.getElementById("toastContainer");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = `toast ${toastType}`;
    toast.textContent = message;

    container.appendChild(toast);

    setTimeout(() =>
    {
      toast.remove();
    }, TOAST_DURATION_MS);
  }

  // =====================================================
  // NFC INITIALISATION
  // =====================================================

  let nfcInitialized = false;
  async function initNfc()
  {
    if (nfcInitialized) return;

    // Check NFC support
    if (!("NDEFReader" in window))
    {
      showToast("NFC is not supported on this device.", TOAST_TYPES.ERROR);
      return;
    }

    try
    {
      nfcReader = new NDEFReader();
      await nfcReader.scan();
      nfcInitialized = true;
      nfcDenied = false;
      elements.activateNfcBtn.classList.add("hidden");

      console.log("NFC scanning started.");

      nfcReader.onreading = (event) =>
      {
        console.log("NFC Reading event triggered");

        if (!canProcessNfc()) return;

        let foundValidRecord = false;

        for (const record of event.message.records)
        {
          try
          {
            const text = readNfcRecordText(record);
            if (text)
            {
              console.log("NFC text found:", text);
              foundValidRecord = true;
              handleNfc(text);
            }
          }
          catch (err)
          {
            console.error("Error processing NFC record:", err);
          }
        }

        if (!foundValidRecord)
        {
          showToast("NFC tag scanned but no valid data found.", TOAST_TYPES.INFO);
        }
      };

      nfcReader.onerror = () =>
      {
        showToast("NFC is disabled on your device. Enable it in device settings to use tag scanning.", TOAST_TYPES.ERROR);
      };

    }
    catch (error)
    {
      if (error.name === "NotAllowedError")
      {
        showToast("NFC permission denied.", TOAST_TYPES.ERROR);
        nfcDenied = true;
        elements.activateNfcBtn.classList.remove("hidden");
      } else if (error.name === "NotSupportedError")
      {
        showToast("NFC not available on this device.", TOAST_TYPES.ERROR);
      } else
      {
        showToast("NFC Error: Failed to initialize scanning.", TOAST_TYPES.ERROR);
      }
      console.error("NFC scan failed:", error);
    }
  }

  // =====================================================
  // NFC HANDLING
  // =====================================================

  function readNfcRecordText(record)
  {
    if (!record || !record.data) return "";

    const decoder = new TextDecoder(record.encoding || "utf-8");
    const text = decoder.decode(record.data).trim();

    if (record.recordType === "text") return text;

    if (record.recordType === "url" || record.recordType === "absolute-url")
    {
      return text.replace(/^[\u0000-\u001f]+/, "").trim();
    }

    // Fallback for other types (like MIME) if they contain readable text
    if (text.length > 0) return text;

    return "";
  }

  function handleNfc(text)
  {
    if (!text) return;

    const tag = parseNfcTag(text);
    const eventType = tag.eventType;

    if (!eventType || eventType === null || eventType === "")
    {
      showToast("NFC event type missing.", TOAST_TYPES.ERROR);
      console.warn("NFC eventType missing: ", text);
      return;
    }

    const action = actionMap[eventType];
    if (!action)
    {
      showToast("NFC event type unknown.", TOAST_TYPES.ERROR);
      console.warn("NFC event type unknown: ", text);
      return;
    }

    action(tag);
  }

  function parseNfcTag(text)
  {
    const fields = {};
    const rawText = text.trim();

    for (const segment of rawText.split(";"))
    {
      const separatorIndex = segment.indexOf(":");
      if (separatorIndex === -1) continue;

      const key = segment.slice(0, separatorIndex).trim().toUpperCase();
      const value = segment.slice(separatorIndex + 1).trim();

      if (key && value) fields[key] = value;
    }

    const eventType = (
      fields.EVENT ||
      fields.EVENTTYPE ||
      fields.EVENT_TYPE ||
      (Object.keys(fields).length ? "" : rawText)
    ).trim().toUpperCase();

    lastScannedCourtId = fields.COURTID || fields.COURT_ID || "";
    lastScannedDeviceId = fields.DEVICEID || fields.DEVICE_ID || "";

    return {
      rawText,
      fields,
      eventType,
      courtId: lastScannedCourtId,
      deviceId: lastScannedDeviceId,
      ssid: fields.SSID || "",
      password: fields.PASS || fields.PASSWORD || ""
    };
  }

  async function spectateCourtFromNfc()
  {

    let courtId = lastScannedCourtId;

    lastScannedCourtId = null;

    if (!courtId || courtId === null || courtId === "")
    {
      showToast("Cannot spectate - no courtId specified.", TOAST_TYPES.ERROR);
      return;
    }

    if (courtId === currentCourtId)
    {
      if (!isSpectating)
      {
        enableSpectateMode();
        showToast("Switched to spectate mode.", TOAST_TYPES.SUCCESS);
      }
      else
      {
        showToast("Already spectating this court.", TOAST_TYPES.INFO);
      }
      return;
    }

    await enterCourt(courtId, true);
  }

  function canProcessNfc()
  {
    const now = Date.now();

    if (nfcCooldown) return false;

    if (now - lastNfcScanTime < COOLDOWN_MS)
    {
      return false;
    }

    startNfcCooldownUI();

    lastNfcScanTime = now;
    nfcCooldown = true;

    setTimeout(() =>
    {
      nfcCooldown = false;
    }, COOLDOWN_MS);

    return true;
  }

  function startNfcCooldownUI()
  {
    let remaining = COOLDOWN_MS / 1000;

    elements.nfcCooldownBanner.classList.remove("hidden");
    elements.nfcCountdown.textContent = remaining;

    const interval = setInterval(() =>
    {
      remaining--;
      elements.nfcCountdown.textContent = remaining;

      if (remaining <= 0)
      {
        clearInterval(interval);
        elements.nfcCooldownBanner.classList.add("hidden");
      }
    }, 1000);
  }

  // =====================================================
  // CONTROLS
  // =====================================================

  elements.shallowResetBtn.addEventListener("click", performShallowReset);

  async function performShallowReset()
  {
    if (!currentCourtId) return;
    try
    {
      await addDoc(
        collection(db, "courts", currentCourtId, "events"),
        {
          eventType: EVENT_TYPES.RESET,
          createdAt: serverTimestamp(),
          createdBy: thisDeviceId
        }
      );
      elements.resetModal.classList.add("hidden");
      playSound(SOUND_IDS.START);
    }
    catch (err)
    {
      console.error("Reset failed:", err);
      showToast("Reset Failed: " + (err.message || "Unknown error"), TOAST_TYPES.ERROR);
    }
  }

  elements.confirmResetBtn.addEventListener("click", async () =>
  {
    const newPassword = elements.resetCourtPassword.value.trim();
    elements.resetPasswordError.textContent = "";

    if (newPassword.length < 4)
    {
      elements.resetPasswordError.textContent = "Password must be at least 4 characters.";
      return;
    }
    else if (newPassword === currentCourtId)
    {
      elements.resetPasswordError.textContent = "Password must be different from court name.";
      return;
    }
    else if (newPassword === currentCourtPassword)
    {
      elements.resetPasswordError.textContent = "New password must be different from the current one.";
      return;
    }

    currentCourtPassword = newPassword;

    try
    {
      await addDoc(
        collection(db, "courts", currentCourtId, "events"),
        {
          eventType: EVENT_TYPES.RESET,
          createdAt: serverTimestamp(),
          createdBy: thisDeviceId
        }
      );

      await setDoc(
        doc(db, "courts", currentCourtId),
        { password: newPassword },
        { merge: true }
      );

      elements.resetModal.classList.add("hidden");

      playSound(SOUND_IDS.START);
    }
    catch (err)
    {
      console.error("Reset failed:", err);
      showToast("Reset Failed: " + (err.message || "Unknown error"), TOAST_TYPES.ERROR);
    }

    elements.resetCourtPassword.value = "";
    elements.resetModal.classList.add("hidden");

    playSound(SOUND_IDS.START);
  });


  function openResetModal()
  {
    playSound(SOUND_IDS.WARNING);
    elements.resetCourtPassword.value = "";
    elements.resetPasswordError.textContent = "";
    elements.resetModal.classList.remove("hidden");
    elements.resetCourtPassword.focus();
  }

  elements.cancelResetBtn.addEventListener("click", () =>
    elements.resetModal.classList.add("hidden")
  );

  elements.resetModal.addEventListener("click", (e) =>
  {
    if (e.target === elements.resetModal)
      elements.resetModal.classList.add("hidden");
  });

  // =====================================================
  // GENERIC CONFIRM MODAL
  // =====================================================

  function showConfirm(message)
  {
    return new Promise((resolve) =>
    {
      elements.confirmMessage.innerHTML = message.replace(/\n/g, "<br>");
      elements.confirmModal.classList.remove("hidden");

      const cleanup = (result) =>
      {
        elements.confirmOkBtn.onclick = null;
        elements.confirmCancelBtn.onclick = null;
        elements.confirmModal.classList.add("hidden");
        resolve(result);
      };

      elements.confirmOkBtn.onclick = () => cleanup(true);
      elements.confirmCancelBtn.onclick = () => cleanup(false);

      // Support dismissing by clicking outside
      elements.confirmModal.onclick = (e) =>
      {
        if (e.target === elements.confirmModal) cleanup(false);
      };
    });
  }

  elements.swapBtn.addEventListener("click", () =>
  {
    playSound(SOUND_IDS.SWOOSH);

    document.querySelector(".scoreboard").classList.toggle("swapped");

    // Keep the details modal synchronized with the currently visible side orientation.
    if (!elements.detailsModal.classList.contains("hidden"))
    {
      showMatchDetails();
    }

    syncSettingsTiles();
  });

  // =====================================================
  // HOLD BUTTON LOGIC
  // =====================================================

  elements.undoBtn.addEventListener("click", async () =>
  {
    if (await showConfirm("Undo the last point?"))
    {
      undoLastPoint();
    }
  });

  elements.backBtn.addEventListener("click", async () =>
  {
    if (await showConfirm("Exit to the main menu?"))
    {
      leaveCourt();
    }
  });

  // Reset tile in settings modal (player-only)
  if (elements.resetSettingsBtn)
  {
    elements.resetSettingsBtn.addEventListener("click", () =>
    {
      // Close settings first, then open reset modal
      elements.settingsModal.classList.add("hidden");
      openResetModal();
    });
  }

  if (elements.joinCourtBtn)
  {
    elements.joinCourtBtn.addEventListener("click", () =>
    {
      if (!currentCourtId)
      {
        showToast("No court is currently open.", TOAST_TYPES.ERROR);
        return;
      }

      openPlayerJoinPrompt(currentCourtId);
      elements.settingsModal.classList.add("hidden");
    });
  }

  // Server visibility toggle tile (player-only)
  if (elements.serverToggleBtn)
  {
    elements.serverToggleBtn.addEventListener("click", () =>
    {
      isServerBadgeVisible = !isServerBadgeVisible;
      localStorage.setItem("serverBadge", isServerBadgeVisible);
      updateServerIndicator();
      syncSettingsTiles();
      playSound(SOUND_IDS.POP);
      showToast(isServerBadgeVisible ? "Server indicator on" : "Server indicator off", TOAST_TYPES.INFO);
    });
  }

  elements.muteBtn.addEventListener("click", () =>
  {
    muted = !muted;
    elements.muteBtn.textContent = muted ? "🔇" : "🔊";
      syncSettingsTiles();
    if (!muted)
    {
      playSound(SOUND_IDS.SNAP);
    }
  });

  elements.fullscreenBtn.addEventListener("click", toggleFullscreen);

  // Settings Modal logic
  elements.settingsBtn.addEventListener("click", () =>
  {
    updateFullscreenButton();
    syncScoringControls();
    elements.settingsModal.classList.remove("hidden");
    syncSettingsTiles();
  });

  elements.closeSettingsBtn.addEventListener("click", () =>
  {
    elements.settingsModal.classList.add("hidden");
  });

  elements.settingsModal.addEventListener("click", (e) =>
  {
    if (e.target === elements.settingsModal)
      elements.settingsModal.classList.add("hidden");
  });

  [elements.scoringModeSelect, elements.deuceModeSelect, elements.tiebreakModeSelect].forEach(select =>
  {
    if (!select) return;
    select.addEventListener("change", saveScoringOptionsFromSettings);
  });

  // Make option tiles clickable
  document.querySelectorAll(".setting-item").forEach(item =>
  {
    item.addEventListener("click", (e) =>
    {
      const btn = item.querySelector("button");
      if (btn && e.target !== btn)
      {
        btn.click();
      }
    });
  });

  // DETAILS MODAL logic
  elements.detailsBtn.addEventListener("click", showMatchDetails);

  function setDetailsPanelExpanded(isExpanded)
  {
    if (!elements.dmDetailsToggle || !elements.dmDetailsContent)
    {
      return;
    }

    elements.dmDetailsToggle.setAttribute("aria-expanded", isExpanded ? "true" : "false");
    elements.dmDetailsToggle.querySelector(".dm-details-toggle-hint").textContent = isExpanded ? "Tap to collapse" : "Tap to expand";
    elements.dmDetailsContent.hidden = !isExpanded;
  }

  function syncDetailsPanelAvailability()
  {
    if (!elements.dmDetailsPanel || !elements.dmDetailsToggle)
    {
      return;
    }

    const hasMomentum = elements.dmMomentumWrap && !elements.dmMomentumWrap.classList.contains("hidden");
    const hasStats = elements.dmStatsWrap && !elements.dmStatsWrap.classList.contains("hidden");
    const hasDetails = hasMomentum || hasStats;

    elements.dmDetailsPanel.classList.toggle("hidden", !hasDetails);

    if (!hasDetails)
    {
      setDetailsPanelExpanded(false);
    }
  }

  if (elements.dmDetailsToggle)
  {
    elements.dmDetailsToggle.addEventListener("click", () =>
    {
      const expanded = elements.dmDetailsToggle.getAttribute("aria-expanded") === "true";
      setDetailsPanelExpanded(!expanded);
    });
  }

  elements.closeDetailsBtn.addEventListener("click", () =>
  {
    elements.detailsModal.classList.add("hidden");
  });

  elements.detailsModal.addEventListener("click", (e) =>
  {
    if (e.target === elements.detailsModal)
      elements.detailsModal.classList.add("hidden");
  });

  function renderMomentumGraph(pointHistory, colourA, colourB, setPointMarkers = [])
  {
    const wrap = elements.dmMomentumWrap;
    const canvas = elements.dmMomentumCanvas;

    // Need at least one scored point to draw a meaningful momentum line
    if (!pointHistory || pointHistory.length < 1)
    {
      wrap.classList.add("hidden");
      syncDetailsPanelAvailability();
      return;
    }

    wrap.classList.remove("hidden");
    syncDetailsPanelAvailability();

    const CANVAS_FALLBACK_WIDTH = 320;
    const FILL_OPACITY = "55"; // ~34% opacity for the area fill

    // Defer drawing so the canvas has a settled layout width
    requestAnimationFrame(() =>
    {
      const dpr = window.devicePixelRatio || 1;
      const cssW = canvas.offsetWidth || canvas.parentElement.offsetWidth || CANVAS_FALLBACK_WIDTH;
      const cssH = 120;
      canvas.width = cssW * dpr;
      canvas.height = cssH * dpr;
      canvas.style.height = cssH + "px";

      const ctx = canvas.getContext("2d");
      ctx.scale(dpr, dpr);

      const W = cssW;
      const H = cssH;
      const padX = 8;
      const padY = 10;
      const midY = H / 2;

      // Build cumulative momentum: +1 per A point, -1 per B point
      const values = [0];
      for (const p of pointHistory)
        values.push(values[values.length - 1] + (p === "A" ? 1 : -1));

      // Smooth sharp directional changes so peaks/troughs render less jagged.
      const smoothedValues = values.map((v, i, arr) =>
      {
        if (i === 0 || i === arr.length - 1) return v;
        return (arr[i - 1] + arr[i] * 2 + arr[i + 1]) / 4;
      });

      const maxVal = Math.max(...values.map(Math.abs), 1);

      // Map index → x, value → y
      const toX = i => padX + (i / (values.length - 1)) * (W - padX * 2);
      const toY = v => midY - (v / maxVal) * (midY - padY);

      const points = smoothedValues.map((v, i) => ({ x: toX(i), y: toY(v) }));

      const traceQuadraticPath = (target, pts, moveToStart = true) =>
      {
        if (!pts || pts.length === 0) return;

        if (moveToStart)
          target.moveTo(pts[0].x, pts[0].y);

        if (pts.length === 1) return;

        if (pts.length === 2)
        {
          target.lineTo(pts[1].x, pts[1].y);
          return;
        }

        for (let i = 1; i < pts.length - 1; i++)
        {
          const midX = (pts[i].x + pts[i + 1].x) / 2;
          const midY = (pts[i].y + pts[i + 1].y) / 2;
          target.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
        }

        const last = pts.length - 1;
        target.quadraticCurveTo(pts[last - 1].x, pts[last - 1].y, pts[last].x, pts[last].y);
      };

      // --- Background fill above midline (team A) ---
      const fillAbove = new Path2D();
      fillAbove.moveTo(points[0].x, midY);
      fillAbove.lineTo(points[0].x, points[0].y);
      traceQuadraticPath(fillAbove, points, false);
      fillAbove.lineTo(points[points.length - 1].x, midY);
      fillAbove.closePath();

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, W, midY);
      ctx.clip();
      ctx.fillStyle = colourA + FILL_OPACITY;
      ctx.fill(fillAbove);
      ctx.restore();

      // --- Background fill below midline (team B) ---
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, midY, W, H - midY);
      ctx.clip();
      ctx.fillStyle = colourB + FILL_OPACITY;
      ctx.fill(fillAbove);
      ctx.restore();

      // --- Centre balanced line ---
      ctx.beginPath();
      ctx.moveTo(padX, midY);
      ctx.lineTo(W - padX, midY);
      const isLight = document.body.classList.contains("light-mode");
      ctx.strokeStyle = isLight ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.15)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      // --- Set point markers ---
      const markerIndices = Array.isArray(setPointMarkers)
        ? [...new Set(setPointMarkers
          .filter((index) => Number.isInteger(index) && index > 0 && index < values.length))]
        : [];

      markerIndices.forEach((index) =>
      {
        const x = toX(index);
        ctx.beginPath();
        ctx.moveTo(x, padY);
        ctx.lineTo(x, H - padY);
        ctx.strokeStyle = document.body.classList.contains("light-mode") ? "rgba(0,0,0,0.5)" : "rgba(255,255,255,0.5)";
        ctx.lineWidth = 1;
        ctx.stroke();
      });

      // --- Momentum line (segment colours by active momentum) ---
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";

      // Group contiguous segments by colour, then draw each group as a smooth curve.
      const lineGroups = [];

      for (let i = 0; i < values.length - 1; i++)
      {
        const segmentEndValue = values[i + 1];
        const segmentColour =
          segmentEndValue > 0 ? colourA :
            segmentEndValue < 0 ? colourB :
              "#ffffff";

        const previousGroup = lineGroups[lineGroups.length - 1];
        if (!previousGroup || previousGroup.colour !== segmentColour)
        {
          lineGroups.push({ start: i, end: i + 1, colour: segmentColour });
        }
        else
        {
          previousGroup.end = i + 1;
        }
      }

      lineGroups.forEach(group =>
      {
        const groupPoints = points.slice(group.start, group.end + 1);
        ctx.beginPath();
        traceQuadraticPath(ctx, groupPoints, true);
        ctx.strokeStyle = group.colour;
        ctx.stroke();
      });

      const finalMomentum = values[values.length - 1];
      const finalMomentumColour =
        finalMomentum > 0 ? colourA :
          finalMomentum < 0 ? colourB :
            "#ffffff";

      // --- End dot ---
      const lastX = points[points.length - 1].x;
      const lastY = points[points.length - 1].y;
      ctx.beginPath();
      ctx.arc(lastX, lastY, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = finalMomentumColour;
      ctx.fill();
    });
  }

  function formatPct(value)
  {
    const numeric = Number(value) || 0;
    return `${Math.round(numeric)}%`;
  }

  function isScoreboardSwapped()
  {
    return document.querySelector(".scoreboard")?.classList.contains("swapped") || false;
  }

  function renderAdvancedStats(advancedStats, teamNames, isSwapped = false)
  {
    if (!elements.dmStatsWrap || !elements.dmStatsTeamA || !elements.dmStatsMeta)
    {
      return;
    }

    if (!advancedStats || !advancedStats.teamStats || !advancedStats.matchStats)
    {
      elements.dmStatsWrap.classList.add("hidden");
      syncDetailsPanelAvailability();
      return;
    }

    const { teamStats, matchStats } = advancedStats;
    const sA = teamStats.A;
    const sB = teamStats.B;
    if (!sA || !sB)
    {
      elements.dmStatsWrap.classList.add("hidden");
      syncDetailsPanelAvailability();
      return;
    }

    const isGoldenMode = advancedStats.deuceMode === "golden";
    const primaryTeamKey = isSwapped ? "B" : "A";
    const secondaryTeamKey = isSwapped ? "A" : "B";
    const primaryTeamName = teamNames[primaryTeamKey];
    const secondaryTeamName = teamNames[secondaryTeamKey];
    const primaryTeamStats = primaryTeamKey === "A" ? sA : sB;
    const secondaryTeamStats = secondaryTeamKey === "A" ? sA : sB;
    const primaryClassSuffix = primaryTeamKey.toLowerCase();
    const secondaryClassSuffix = secondaryTeamKey.toLowerCase();
    const primaryColour = primaryTeamKey === "A" ? "var(--teamAcolour)" : "var(--teamBcolour)";
    const secondaryColour = secondaryTeamKey === "A" ? "var(--teamAcolour)" : "var(--teamBcolour)";

    const totalPoints = Number(matchStats.totalPoints) || 0;
    const deuceGames = Number(matchStats.deuceGames) || 0;
    const goldenPointsPlayed = Number(matchStats.goldenPointsPlayed) || 0;

    function row(label, valPrimary, valSecondary)
    {
      return `<tr class="dm-st-row">
        <td class="dm-st-label">${label}</td>
        <td class="dm-st-val dm-st-${primaryClassSuffix}">${valPrimary}</td>
        <td class="dm-st-val dm-st-${secondaryClassSuffix}">${valSecondary}</td>
      </tr>`;
    }

    function sharedRow(label, val)
    {
      return `<tr class="dm-st-row">
        <td class="dm-st-label">${label}</td>
        <td class="dm-st-shared" colspan="2">${val}</td>
      </tr>`;
    }

    function sectionRow(label)
    {
      return `<tr class="dm-st-section-hdr"><td colspan="3">${label}</td></tr>`;
    }

    function barRow(label, pctPrimary, pctSecondary, lblPrimary, lblSecondary)
    {
      const safePrimary = Math.max(0, Math.min(100, Number(pctPrimary) || 0));
      const safeSecondary = Math.max(0, Math.min(100, Number(pctSecondary) || 0));
      return `<tr class="dm-st-row dm-st-bar-row">
        <td class="dm-st-label">${label}</td>
        <td class="dm-st-bar-cell" colspan="2">
          <div class="dm-split-bar">
            <span class="dm-split-lbl-a" style="color:${primaryColour};">${lblPrimary}</span>
            <div class="dm-split-track">
              <div class="dm-split-fill-a" style="width:${safePrimary}%; background:${primaryColour};"></div>
              <div class="dm-split-fill-b" style="flex:0 0 ${safeSecondary}%; background:${secondaryColour};"></div>
            </div>
            <span class="dm-split-lbl-b" style="color:${secondaryColour};">${lblSecondary}</span>
          </div>
        </td>
      </tr>`;
    }

    const primaryDeuceWon = Number(primaryTeamStats.gamesWonAfterDeuce) || 0;
    const secondaryDeuceWon = Number(secondaryTeamStats.gamesWonAfterDeuce) || 0;
    const primaryDeucePctRaw = Number(primaryTeamStats.gamesWonAfterDeucePct);
    const secondaryDeucePctRaw = Number(secondaryTeamStats.gamesWonAfterDeucePct);
    const primaryDeucePct = Number.isFinite(primaryDeucePctRaw)
      ? primaryDeucePctRaw
      : (deuceGames > 0 ? (primaryDeuceWon / deuceGames) * 100 : 0);
    const secondaryDeucePct = Number.isFinite(secondaryDeucePctRaw)
      ? secondaryDeucePctRaw
      : (deuceGames > 0 ? (secondaryDeuceWon / deuceGames) * 100 : 0);

    const rows = [
      barRow(
        "Pts Won",
        primaryTeamStats.pointWinPct,
        secondaryTeamStats.pointWinPct,
        `${primaryTeamStats.pointsWon}/${totalPoints} · ${formatPct(primaryTeamStats.pointWinPct)}`,
        `${secondaryTeamStats.pointsWon}/${totalPoints} · ${formatPct(secondaryTeamStats.pointWinPct)}`
      ),
      row("Longest Streak", primaryTeamStats.longestScoringStreak, secondaryTeamStats.longestScoringStreak),
      row("Breaks Faced", primaryTeamStats.breakPointsFaced, secondaryTeamStats.breakPointsFaced),
      row("Breaks Held", `${primaryTeamStats.breakPointsWon}/${primaryTeamStats.breakPointsFaced} · ${formatPct(primaryTeamStats.breakPointWinPct)}`,
                          `${secondaryTeamStats.breakPointsWon}/${secondaryTeamStats.breakPointsFaced} · ${formatPct(secondaryTeamStats.breakPointWinPct)}`),
      row("Break Chances", primaryTeamStats.breakPointConversionOpportunities, secondaryTeamStats.breakPointConversionOpportunities),
      row("Breaks Won", `${primaryTeamStats.breakPointConversions}/${primaryTeamStats.breakPointConversionOpportunities} · ${formatPct(primaryTeamStats.breakPointConversionPct)}`,
                        `${secondaryTeamStats.breakPointConversions}/${secondaryTeamStats.breakPointConversionOpportunities} · ${formatPct(secondaryTeamStats.breakPointConversionPct)}`),
      row("Closing Pts Won",
        `${formatPct(primaryTeamStats.closingEfficiencyPct)} (${primaryTeamStats.gamePointConversions}/${primaryTeamStats.gamePointGames})`,
        `${formatPct(secondaryTeamStats.closingEfficiencyPct)} (${secondaryTeamStats.gamePointConversions}/${secondaryTeamStats.gamePointGames})`),
      sectionRow("Deuce"),
      sharedRow("Games", deuceGames),
      barRow(
        "Won",
        primaryDeucePct,
        secondaryDeucePct,
        `${primaryDeuceWon}/${deuceGames} · ${formatPct(primaryDeucePct)}`,
        `${secondaryDeuceWon}/${deuceGames} · ${formatPct(secondaryDeucePct)}`)
    ];

    if (isGoldenMode)
    {
      rows.push(row(
        "Golden Pts",
        `${primaryTeamStats.goldenPointsWon}/${goldenPointsPlayed} · ${formatPct(primaryTeamStats.goldenPointWinPct)}`,
        `${secondaryTeamStats.goldenPointsWon}/${goldenPointsPlayed} · ${formatPct(secondaryTeamStats.goldenPointWinPct)}`
      ));
    }

    elements.dmStatsTeamA.innerHTML = `
      <table class="dm-stats-table">
        <thead>
          <tr>
            <th class="dm-st-col-label"></th>
            <th class="dm-st-col-team dm-st-col-${primaryClassSuffix}">${primaryTeamName}</th>
            <th class="dm-st-col-team dm-st-col-${secondaryClassSuffix}">${secondaryTeamName}</th>
          </tr>
        </thead>
        <tbody>${rows.join("")}</tbody>
      </table>
    `;

    const comeback = matchStats.largestComeback;
    let comebackText = "No comeback set win recorded.";
    if (comeback && (comeback.team === "A" || comeback.team === "B"))
    {
      const comebackTeamName = comeback.team === "A" ? teamNames.A : teamNames.B;
      const fromA = Number(comeback.fromScore?.A) || 0;
      const fromB = Number(comeback.fromScore?.B) || 0;
      const finalA = Number(comeback.finalScore?.A) || 0;
      const finalB = Number(comeback.finalScore?.B) || 0;
      const setNumber = Number(comeback.setNumber) || 1;
      comebackText = `${comebackTeamName} recovered from ${fromA}-${fromB} to win set ${setNumber} , ${finalA}-${finalB}.`;
    }

    elements.dmStatsMeta.innerHTML = `
      <ul class="dm-meta-list">
        <li><span class="dm-meta-key">Match swings:<br/></span> ${matchStats.leadChanges} lead changes.</li>
        <li><span class="dm-meta-key">Largest comeback:<br/></span> ${comebackText}</li>
      </ul>
    `;

    elements.dmStatsWrap.classList.remove("hidden");
    syncDetailsPanelAvailability();
  }

  async function showMatchDetails()
  {
    elements.detailsModal.classList.remove("hidden");

    // Check if the primary scoreboard is currently swapped
    const isSwapped = isScoreboardSwapped();

    // Mirror the swapped layout state onto the details header container
    const dmOverall = document.querySelector(".dm-overall");
    if (dmOverall)
    {
      dmOverall.classList.toggle("swapped", isSwapped);
    }

    // Populate team names immediately
    const nameA = $("teamA").querySelector(".name-text").textContent;
    const nameB = $("teamB").querySelector(".name-text").textContent;
    const teamAColour = getComputedStyle(document.body).getPropertyValue("--teamAcolour").trim();
    const teamBColour = getComputedStyle(document.body).getPropertyValue("--teamBcolour").trim();
    if (isSwapped)
    {
      elements.detailsTeamAName.textContent = nameB;
      elements.detailsTeamBName.textContent = nameA;
      elements.detailsTeamAName.style.color = teamBColour;
      elements.detailsTeamBName.style.color = teamAColour;
      elements.detailsSetsA.style.color = teamAColour;
      elements.detailsSetsB.style.color = teamBColour;
    }
    else
    {
      elements.detailsTeamAName.textContent = nameA;
      elements.detailsTeamBName.textContent = nameB;
      elements.detailsTeamAName.style.color = teamAColour;
      elements.detailsTeamBName.style.color = teamBColour;
      elements.detailsSetsA.style.color = teamAColour;
      elements.detailsSetsB.style.color = teamBColour;
    }

    elements.detailsLoading.classList.remove("hidden");

    // Clear table rows, columns, and momentum graph safely
    const headRow = elements.dmHead.querySelector("tr");
    headRow.innerHTML = "";
    elements.dmBody.innerHTML = "";
    elements.dmMomentumWrap.classList.add("hidden");
    elements.dmStatsWrap.classList.add("hidden");
    elements.dmStatsTeamA.innerHTML = "";
    elements.dmStatsMeta.innerHTML = "";
    if (elements.dmEmptyState)
    {
      elements.dmEmptyState.classList.add("hidden");
    }
    setDetailsPanelExpanded(false);
    syncDetailsPanelAvailability();

    try
    {
      const getDetailedScore = httpsCallable(functions, "getDetailedScore");
      const result = await getDetailedScore({ courtId: currentCourtId });
      const { sets, currentGames, points, mode, scoringMode, matchComplete } = result.data;
      const resolvedMode = normalizeScoringOptions({ scoringMode: scoringMode || mode }).scoringMode;
      const dmTableWrap = document.querySelector(".dm-table-wrap");

      const hasCompletedSets = Array.isArray(sets) && sets.length > 0;
      const hasCurrentSetGames = (Number(currentGames?.A) || 0) > 0 || (Number(currentGames?.B) || 0) > 0;
      const hasAnyPoints = (Number(points?.A) || 0) > 0 || (Number(points?.B) || 0) > 0;
      const hasAnyMatchDetails = hasCompletedSets || hasCurrentSetGames || hasAnyPoints;

      if (elements.dmEmptyState)
      {
        elements.dmEmptyState.classList.toggle("hidden", hasAnyMatchDetails);
      }

      if (!hasAnyMatchDetails)
      {
        if (dmOverall)
        {
          dmOverall.classList.add("hidden");
        }
        if (dmTableWrap)
        {
          dmTableWrap.classList.add("hidden");
        }
        if (elements.dmDetailsPanel)
        {
          elements.dmDetailsPanel.classList.add("hidden");
        }
        return;
      }

      // Unpack sets safely or calculate fallbacks from historical sets tracking if missing
      let setsA = result.data.setsA;
      let setsB = result.data.setsB;
      if (setsA === undefined || setsB === undefined)
      {
        setsA = 0;
        setsB = 0;
        if (sets && Array.isArray(sets))
        {
          sets.forEach(s =>
          {
            if (s.A > s.B) setsA++;
            if (s.B > s.A) setsB++;
          });
        }
      }

      const isStraight = resolvedMode === "straight";
      const isTiebreakTen = resolvedMode === "tiebreakTen";

      if (dmOverall)
      {
        dmOverall.classList.remove("hidden");
      }

      if (isStraight || isTiebreakTen)
      {
        // 1) Hide the breakdown table completely since individual sets are not tracked
        if (dmTableWrap) dmTableWrap.classList.add("hidden");
        if (dmOverall) dmOverall.classList.add("large-points-mode");

        // 2) Populate the main sets labels with the cumulative match points
        elements.detailsSetsA.textContent = (points && points.A !== undefined) ? points.A : 0;
        elements.detailsSetsB.textContent = (points && points.B !== undefined) ? points.B : 0;

        const colourA = getComputedStyle(document.body).getPropertyValue("--teamAcolour").trim();
        const colourB = getComputedStyle(document.body).getPropertyValue("--teamBcolour").trim();
        renderMomentumGraph(result.data.pointHistory, colourA, colourB, result.data.setPointMarkers || []);
        renderAdvancedStats(result.data.advancedStats, { A: nameA, B: nameB }, isSwapped);
        syncDetailsPanelAvailability();
        return;
      }
      
      // Normal Scoring Mode remains perfectly untouched
      if (dmTableWrap) dmTableWrap.classList.remove("hidden");
      if (dmOverall) dmOverall.classList.remove("large-points-mode");

      // Populate overall set scores normally (e.g. 0 and 2)
      elements.detailsSetsA.textContent = setsA;
      elements.detailsSetsB.textContent = setsB;

      const hasCurrentSet = !matchComplete && hasCurrentSetGames;
      const allSets = hasCurrentSet ? [...sets, currentGames] : [...sets];

      // Build table header columns: [marker] S1 S2 S3 ...
      const mkTh = (text, extraClass) =>
      {
        const th = document.createElement("th");
        th.textContent = text;
        if (extraClass) th.className = extraClass;
        return th;
      };

      headRow.appendChild(mkTh(""));
      allSets.forEach((_, i) =>
      {
        const isCurrentSet = hasCurrentSet && i === allSets.length - 1;
        headRow.appendChild(mkTh(`S${i + 1}`, isCurrentSet ? "dm-current-set" : ""));
      });

      // Helper to construct team score table rows
      const mkRow = (team, setsData) =>
      {
        const tr = document.createElement("tr");
        tr.className = `dm-row-${team}`;

        const markerTd = document.createElement("td");
        markerTd.className = "dm-marker-cell";
        markerTd.appendChild(document.createElement("span"));
        tr.appendChild(markerTd);

        setsData.forEach((s, i) =>
        {
          if (s)
          {
            const td = document.createElement("td");
            const teamScore = team === "a" ? s.A : s.B;
            const opponentScore = team === "a" ? s.B : s.A;
            td.textContent = teamScore !== undefined ? teamScore : 0;

            const isCurrentSet = hasCurrentSet && i === setsData.length - 1;
            if (!isCurrentSet && teamScore > opponentScore) td.classList.add("dm-won");
            if (isCurrentSet) td.classList.add("dm-current-set");

            tr.appendChild(td);
          }
        });

        return tr;
      };

      // Render rows adhering to the visual swapped rotation state
      if (isSwapped)
      {
        elements.dmBody.appendChild(mkRow("b", allSets));
        elements.dmBody.appendChild(mkRow("a", allSets));
      } else
      {
        elements.dmBody.appendChild(mkRow("a", allSets));
        elements.dmBody.appendChild(mkRow("b", allSets));
      }

      const colourA = getComputedStyle(document.body).getPropertyValue("--teamAcolour").trim();
      const colourB = getComputedStyle(document.body).getPropertyValue("--teamBcolour").trim();
      renderMomentumGraph(result.data.pointHistory, colourA, colourB, result.data.setPointMarkers || []);
      renderAdvancedStats(result.data.advancedStats, { A: nameA, B: nameB }, isSwapped);
      syncDetailsPanelAvailability();
    }
    catch (err)
    {
      console.error("Match details initialization error:", err);
    }
    finally
    {
      elements.detailsLoading.classList.add("hidden");
    }
  }

  // =====================================================
  // TEAM NAME EDITING
  // =====================================================

  function startEditing(labelEl, team)
  {
    const input = document.createElement("input");
    input.className = "team-name-input";
    input.value = labelEl.textContent;

    labelEl.replaceWith(input);
    input.focus();
    input.select();

    let isSaving = false;

    async function save()
    {
      if (isSaving) return;
      isSaving = true;

      const name = input.value.trim() || `Team ${team}`;

      try
      {
        await updateDoc(doc(db, "courts", currentCourtId), {
          [`teamNames.${team}`]: name
        });
      }
      catch (error)
      {
        console.error("Error updating team name:", error);
      }

      labelEl.textContent = name;
      input.replaceWith(labelEl);

      fitTextToContainer(labelEl);
    }

    function cancel()
    {
      if (isSaving) return;
      input.replaceWith(labelEl);
    }

    input.addEventListener("blur", save);
    input.addEventListener("keydown", (e) =>
    {
      if (e.key === "Enter")
      {
        e.preventDefault();
        input.blur(); // Triggers blur event, which calls save()
      }
      if (e.key === "Escape") cancel();
    });
  }

  function fitTextToContainer(textEl)
  {
    const container = textEl.parentElement;

    textEl.style.transform = "scale(1)";

    const containerWidth = container.clientWidth;
    const textWidth = textEl.scrollWidth;

    if (textWidth > containerWidth)
    {
      const scale = containerWidth / textWidth;
      textEl.style.transform = `scale(${scale})`;
    }
  }

  document.querySelectorAll(".team-name .name-text").forEach(el =>
  {
    const team = el.closest(".team-name").dataset.team;

    el.addEventListener("click", () =>
    {
      if (isSpectating) return;
      startEditing(el, team);
    });

    fitTextToContainer(el);
  });

  window.addEventListener("resize", () =>
  {
    document.querySelectorAll(".team-name .name-text")
      .forEach(fitTextToContainer);
    updateMarqueeScrolling();
  });


  // =====================================================
  // INIT
  // =====================================================

  updateUI();
  initNfc();

  $("addPointA").addEventListener("click", () => addPoint(EVENT_TYPES.POINT_TEAM_A));
  $("addPointB").addEventListener("click", () => addPoint(EVENT_TYPES.POINT_TEAM_B));

  function DetermineThisDeviceId()
  {
    const ua = navigator.userAgent;
    let os = "Unknown";
    let browser = "Unknown";
    let mode = "WEB";
    let model = "Generic";

    // 1. OS & Model Detection
    if (/android/i.test(ua))
    {
      os = "Android";
      // Try to extract Android model: usually after "Android X.X;" and before next ";" or ")"
      const match = ua.match(/Android\s+[^;]+;\s+([^;)]+)/);
      if (match) model = match[1].trim();
    }
    else if (/iPad|iPhone|iPod/.test(ua))
    {
      os = "iOS";
      if (/iPhone/.test(ua)) model = "iPhone";
      else if (/iPad/.test(ua)) model = "iPad";
      else if (/iPod/.test(ua)) model = "iPod";
    }
    else if (/Win/i.test(ua)) os = "Windows";
    else if (/Mac/i.test(ua)) os = "macOS";
    else if (/Linux/i.test(ua)) os = "Linux";

    // 2. Browser Detection
    if (/edg/i.test(ua)) browser = "Edge";
    else if (/chrome|crios/i.test(ua)) browser = "Chrome";
    else if (/firefox|fxios/i.test(ua)) browser = "Firefox";
    else if (/safari/i.test(ua)) browser = "Safari";
    else if (/trident/i.test(ua)) browser = "IE";

    // 3. Platform Mode (Web / PWA / TWA)
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    if (isStandalone)
    {
      mode = "PWA";
      if (ua.includes('wv') || ua.includes('Version/'))
      {
        mode = "TWA";
      }
    }

    // 4. Persistence (Unique ID)
    let uuid = localStorage.getItem("punto_device_uuid");
    if (!uuid)
    {
      uuid = "uuid_" + Math.random().toString(36).substring(2, 8).toUpperCase();
      localStorage.setItem("punto_device_uuid", uuid);
    }

    // 5. Screen Info
    const res = `${window.screen.width}x${window.screen.height}`;

    // Clean up model string (remove spaces)
    const cleanModel = model.replace(/\s+/g, "_");

    // Format: MODE-OS-MODEL-BROWSER-RES-UUID
    // e.g. TWA-Android-Pixel_6-Chrome-412x915-uuid_X9Y8Z7
    let id = `${mode}-${os}-${cleanModel}-${browser}-${res}-${uuid}`;

    console.log(`Device ID: ${id}`);
    return id;
  }

  // =====================================================
  // FIREBASE SYNC
  // =====================================================

  let unsubscribe = null;

  async function listenToCourt(courtId)
  {
    console.log(`Setting up real-time sync for court: ${courtId}`);
    if (unsubscribe) unsubscribe();

    const scoreRef = doc(db, "courts", courtId, "score", "current");
    const courtRef = doc(db, "courts", courtId);

    // Warm reads
    await getDoc(scoreRef);
    await getDoc(courtRef);

    // 🔥 Listen to score changes
    const unsubscribeScore = onSnapshot(scoreRef, (snap) =>
    {
      if (!snap.exists()) return;

      const newData = snap.data();

      // Establish baseline on first successful Firebase sync
      if (!sessionInitialized)
      {
        lastKnownSets = { A: newData.A.sets, B: newData.B.sets };
        sessionInitialized = true;

        // Hide loading overlay on first real payload
        if (elements.scoreboardLoading)
        {
          elements.scoreboardLoading.classList.add("hidden");
        }
      }


      score = newData;
      updateUI();
    });

    // 🔥 Listen to court metadata changes (password + teamNames)
    const unsubscribeCourt = onSnapshot(courtRef, (snap) =>
    {
      if (!snap.exists())
      {
        // If we are already on a new court (redirected), ignore
        if (currentCourtId !== courtId) return;

        showToast("This court no longer exists.", TOAST_TYPES.ERROR);
        leaveCourt();
        return;
      }

      const data = snap.data();

      // 🚨 Redirect handling (Rename propagation)
      if (data.redirect && data.redirect !== currentCourtId)
      {
        showToast(`Court has been renamed to "${data.redirect}". Redirecting...`, TOAST_TYPES.INFO);
        const wasSpectating = isSpectating;
        // Clean up current listener
        if (unsubscribeScore) unsubscribeScore();
        if (unsubscribeCourt) unsubscribeCourt();
        unsubscribe = null;
        // Enter new court
        enterCourt(data.redirect, wasSpectating);
        return;
      }

      //Court made private
      if (data.status === STATUS.PRIVATE && currentCourtStatus !== STATUS.PRIVATE)
      {
        showToast("This court has been made private by admin.", TOAST_TYPES.INFO);
        leaveCourt();
        return;
      }

      // 🚨 Court Closure detection
      if (data.status === STATUS.CLOSED && !isAdmin)
      {
        showToast("The court has been closed by admin.", TOAST_TYPES.ERROR);
        leaveCourt();
        return;
      }

      // 🚨 Password change detection
      if (
        currentCourtPassword !== data.password &&
        !isSpectating
      )
      {
        showToast("Security notice: Court password changed. You are now a spectator.", TOAST_TYPES.ERROR);
        enableSpectateMode();
      }

      // Ensure local state tracks newest password
      currentCourtPassword = data.password;
      currentCourtStatus = data.status;

      const nextScoringOptions = normalizeScoringOptions({
        ...(data.scoringOptions || {}),
        scoringMode: data.scoringMode || data.scoringOptions?.scoringMode
      });
      if (!areScoringOptionsEqual(nextScoringOptions, currentScoringOptions))
      {
        currentScoringOptions = nextScoringOptions;
        syncScoringControls();
        updateScoreFormatBadge();
      }

      // Update UI title (Rename propagation for the display name)
      showCourtTitle(data.name || snap.id);

      const teamNames = data.teamNames || { A: "Team A", B: "Team B" };

      const nameA = $("teamA").querySelector(".name-text");
      const nameB = $("teamB").querySelector(".name-text");

      if (nameA)
      {
        nameA.textContent = teamNames.A;
        fitTextToContainer(nameA);
      }
      if (nameB)
      {
        nameB.textContent = teamNames.B;
        fitTextToContainer(nameB);
      }
    });

    // Combine both unsubscribes
    unsubscribe = () =>
    {
      unsubscribeScore();
      unsubscribeCourt();
    };
  }

  // Tab Switching Logic
  elements.adminTabs.forEach(btn =>
  {
    btn.addEventListener('click', () =>
    {
      elements.adminTabs.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const tab = btn.dataset.tab;
      if (tab === 'courts')
      {
        elements.courtsTab.classList.add("active");   // Added 'elements.'
        elements.devicesTab.classList.remove("active"); // Added 'elements.'
        displayAdminCourtList();
      } else
      {
        elements.devicesTab.classList.add("active");  // Added 'elements.'
        elements.courtsTab.classList.remove("active"); // Added 'elements.'
        loadDevices();
      }
    });
  });

  // =====================================================
  // COURT DROPDOWN HELPERS (for device combo widgets)
  // =====================================================

  /**
   * Fetches all courts from Firestore and populates a <select> element.
   * Keeps the first placeholder option intact.
   */
  async function populateCourtDropdown(selectEl)
  {
    // Clear existing options except the first placeholder
    while (selectEl.options.length > 1) selectEl.remove(1);

    try
    {
      const snapshot = await getDocs(collection(db, "courts"));
      const courts = [];
      snapshot.forEach(d => courts.push({ id: d.id, name: (d.data().name || d.id) }));
      courts.sort((a, b) => a.name.localeCompare(b.name));

      courts.forEach(court =>
      {
        const opt = document.createElement("option");
        opt.value = court.id;
        opt.textContent = `${court.name} (${court.id})`;
        selectEl.appendChild(opt);
      });
    }
    catch (err)
    {
      console.error("Failed to load courts for dropdown:", err);
    }
  }

  /**
   * Switch a combo widget into manual-text mode.
   */
  function switchComboToManual(selectWrapper, manualInput, manualToggleRow, dropdownToggleRow)
  {
    selectWrapper.style.display = "none";
    manualToggleRow.style.display = "none";
    manualInput.style.display = "";
    dropdownToggleRow.style.display = "";
    manualInput.focus();
  }

  /**
   * Switch a combo widget back to dropdown mode.
   */
  function switchComboToDropdown(selectWrapper, manualInput, manualToggleRow, dropdownToggleRow)
  {
    manualInput.style.display = "none";
    dropdownToggleRow.style.display = "none";
    selectWrapper.style.display = "";
    manualToggleRow.style.display = "";
  }

  /**
   * Read the currently active value from a combo widget.
   * Returns the selected court id (from dropdown) OR the typed manual value.
   */
  function getCourtIdFromCombo(selectEl, manualInputEl)
  {
    const isManual = manualInputEl.style.display !== "none";
    return isManual ? manualInputEl.value.trim() : selectEl.value.trim();
  }

  // Wire up combo toggle links — Add Device form
  elements.newDeviceManualToggle.addEventListener("click", (e) =>
  {
    e.preventDefault();
    switchComboToManual(
      elements.newDeviceManualToggle.closest(".court-id-combo").querySelector(".select-wrapper"),
      elements.newDeviceCourtIdManual,
      elements.newDeviceManualToggle.parentElement,
      elements.newDeviceDropdownToggleRow
    );
  });

  elements.newDeviceDropdownToggle.addEventListener("click", (e) =>
  {
    e.preventDefault();
    switchComboToDropdown(
      elements.newDeviceDropdownToggle.closest(".court-id-combo").querySelector(".select-wrapper"),
      elements.newDeviceCourtIdManual,
      elements.newDeviceManualToggle.parentElement,
      elements.newDeviceDropdownToggleRow
    );
  });

  // Wire up combo toggle links — Edit Device form
  elements.editDeviceManualToggle.addEventListener("click", (e) =>
  {
    e.preventDefault();
    switchComboToManual(
      elements.editDeviceManualToggle.closest(".court-id-combo").querySelector(".select-wrapper"),
      elements.editDeviceCourtIdManual,
      elements.editDeviceManualToggle.parentElement,
      elements.editDeviceDropdownToggleRow
    );
  });

  elements.editDeviceDropdownToggle.addEventListener("click", (e) =>
  {
    e.preventDefault();
    switchComboToDropdown(
      elements.editDeviceDropdownToggle.closest(".court-id-combo").querySelector(".select-wrapper"),
      elements.editDeviceCourtIdManual,
      elements.editDeviceManualToggle.parentElement,
      elements.editDeviceDropdownToggleRow
    );
  });

  // Device Management Functions
  async function loadDevices()
  {
    elements.adminDeviceList.innerHTML = '<div class="loading">Loading devices...</div>';
    try
    {
      const snapshot = await getDocs(collection(db, "devices"));
      allDevices = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      renderDeviceList(allDevices);
    } catch (error)
    {
      showToast("Error loading devices", TOAST_TYPES.ERROR);
    }
  }

  function renderDeviceList(devices)
  {
    elements.adminDeviceList.innerHTML = "";
    if (devices.length === 0)
    {
      elements.adminDeviceList.innerHTML = '<div class="no-courts">No devices registered.</div>';
      return;
    }

    devices.forEach(device =>
    {
      const item = document.createElement("div");
      item.className = "admin-court-item";
      item.innerHTML = `
      <div class="aci-field teams-cell">
        <div class="aci-label">deviceId:</div>
        <div class="aci-value">
          ${device.id}
        </div>
      </div>
      <div class="aci-field teams-cell">
        <div class="aci-label">Mapped to:</div>
        <div class="aci-value">
          ${device.courtId || '???'}
        </div>
      </div>
      <div class="aci-actions">
        <button class="edit-btn" data-id="${device.id}">Edit</button>
      </div>
      
    `;
      item.querySelector('.edit-btn').addEventListener('click', () => openEditDeviceModal(device));
      elements.adminDeviceList.appendChild(item);
    });
  }

  // Add Device Logic
  elements.showAddDeviceModalBtn.addEventListener('click', async () =>
  {
    elements.adminDashboardPage.style.display = "none";
    elements.addDevicePage.style.display = 'flex';

    // Reset combo to dropdown mode and refresh court list
    const addSelectWrapper = elements.newDeviceCourtIdSelect.closest(".select-wrapper");
    switchComboToDropdown(
      addSelectWrapper,
      elements.newDeviceCourtIdManual,
      elements.newDeviceManualToggle.parentElement,
      elements.newDeviceDropdownToggleRow
    );
    elements.newDeviceId.value = "";
    elements.newDeviceCourtIdManual.value = "";
    elements.newDeviceCourtIdSelect.value = "";
    await populateCourtDropdown(elements.newDeviceCourtIdSelect);
  });

  elements.saveNewDeviceBtn.addEventListener('click', async () =>
  {
    const deviceId = elements.newDeviceId.value.trim();
    const courtId = getCourtIdFromCombo(elements.newDeviceCourtIdSelect, elements.newDeviceCourtIdManual);

    if (!deviceId) return showToast("Device ID is required", TOAST_TYPES.ERROR);

    try
    {
      await setDoc(doc(db, "devices", deviceId), { courtId: courtId });
      showToast("Device added successfully", TOAST_TYPES.SUCCESS);
      elements.addDevicePage.style.display = 'none';
      elements.newDeviceId.value = "";
      elements.newDeviceCourtIdManual.value = "";
      elements.newDeviceCourtIdSelect.value = "";
      loadDevices();
      elements.adminDashboardPage.style.display = "flex";
    } catch (error)
    {
      showToast("Failed to add device", TOAST_TYPES.ERROR);
    }
  });

  // Edit/Delete Device Logic
  async function openEditDeviceModal(device)
  {
    elements.adminDashboardPage.style.display = "none";
    elements.editDeviceIdTitle.textContent = device.id;
    elements.editDevicePage.style.display = 'flex';

    // Populate dropdown with all courts
    await populateCourtDropdown(elements.editDeviceCourtIdSelect);

    const currentCourtId = device.courtId || "";
    const editSelectWrapper = elements.editDeviceCourtIdSelect.closest(".select-wrapper");

    // Check if the current courtId exists in the dropdown
    const matchingOption = [...elements.editDeviceCourtIdSelect.options].find(o => o.value === currentCourtId);

    if (matchingOption)
    {
      // Pre-select the matching court in the dropdown
      elements.editDeviceCourtIdSelect.value = currentCourtId;
      elements.editDeviceCourtIdManual.value = "";
      switchComboToDropdown(
        editSelectWrapper,
        elements.editDeviceCourtIdManual,
        elements.editDeviceManualToggle.parentElement,
        elements.editDeviceDropdownToggleRow
      );
    }
    else
    {
      // Fall back to manual mode with the raw value pre-filled
      elements.editDeviceCourtIdManual.value = currentCourtId;
      elements.editDeviceCourtIdSelect.value = "";
      switchComboToManual(
        editSelectWrapper,
        elements.editDeviceCourtIdManual,
        elements.editDeviceManualToggle.parentElement,
        elements.editDeviceDropdownToggleRow
      );
    }

    elements.saveEditDeviceBtn.onclick = async () =>
    {
      try
      {
        const courtId = getCourtIdFromCombo(elements.editDeviceCourtIdSelect, elements.editDeviceCourtIdManual);
        await updateDoc(doc(db, "devices", device.id), { courtId });
        showToast("Mapping updated", TOAST_TYPES.SUCCESS);
        elements.editDevicePage.style.display = 'none';
        loadDevices();
        elements.adminDashboardPage.style.display = "flex";
      } catch (e) { showToast("Update failed", TOAST_TYPES.ERROR); }
    };

    elements.deleteDeviceBtn.onclick = async () =>
    {
      if (!(await showConfirm("Delete this device registration?"))) return;
      try
      {
        await deleteDoc(doc(db, "devices", device.id));
        showToast("Device deleted", TOAST_TYPES.SUCCESS);
        elements.editDevicePage.style.display = 'none';
        loadDevices();
        elements.adminDashboardPage.style.display = "flex";
      } catch (e) { showToast("Delete failed", TOAST_TYPES.ERROR); }
    };
  }

  // Close buttons
  elements.closeAddDeviceBtn.onclick = () =>
  {
    elements.addDevicePage.style.display = 'none';
    if (isAdmin) elements.adminDashboardPage.style.display = "flex";
    else elements.menuPage.style.display = "flex";
  }

  elements.closeEditDeviceBtn.onclick = () =>
  {
    elements.editDevicePage.style.display = 'none';
    if (isAdmin) elements.adminDashboardPage.style.display = "flex";
    else elements.menuPage.style.display = "flex";
  }

  // Search logic for devices
  elements.adminDeviceSearch.addEventListener('input', (e) =>
  {
    const term = e.target.value.toLowerCase();
    const filtered = allDevices.filter(d =>
      d.id.toLowerCase().includes(term) ||
      (d.courtId && d.courtId.toLowerCase().includes(term))
    );
    renderDeviceList(filtered);
  });
});

// =====================================================
// WAKE LOCK STATE
// =====================================================

let wakeLock = null;

async function requestWakeLock()
{
  try
  {
    wakeLock = await navigator.wakeLock.request("screen");
    console.log("Wake lock acquired - device will stay awake.");

    // Re-acquire lock if user interacts with device
    wakeLock.addEventListener("release", () =>
    {
      console.warn("Wake lock released.");
    });
  }
  catch (error)
  {
    console.warn("Wake lock not supported or denied:", error);
  }
}

async function releaseWakeLock()
{
  if (wakeLock)
  {
    try
    {
      await wakeLock.release();
      wakeLock = null;
      console.log("Wake lock released.");
    }
    catch (error)
    {
      console.error("Error releasing wake lock:", error);
    }
  }
}
