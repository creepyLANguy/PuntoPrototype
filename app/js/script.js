import { app, db } from "./firebase.js";
import { applyActiveScoreSnapshot } from "./scoreSync.mjs";
import { toBlob } from "https://esm.sh/html-to-image@1.11.13";

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

export async function resetCourt(courtId, deepReset = false, newPassword = null, requirePassword = false)
{
  const resetFn = httpsCallable(functions, "resetCourt");
  const result = await resetFn({ courtId, deepReset, newPassword, requirePassword });
  return result;
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
  const DEFAULT_TEAM_NAMES = {
    A: "Team A",
    B: "Team B"
  };
  const DEFAULT_PLAYER_NAMES = {
    A1: "",
    A2: "",
    B1: "",
    B2: ""
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

  const LOAD_SPINNER_DELAY_MS = 750;

  const LOADING_SPINNER_MIN_DURATION_MS = 750;

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

  const NAV_HISTORY_STATE_KEY = "__puntoViewState";
  const NAV_PAGES = {
    MENU: "menu",
    PLAY: "play",
    SPECTATE: "spectate",
    SCOREBOARD: "scoreboard",
    ADMIN_AUTH: "adminAuth",
    ADMIN_DASHBOARD: "adminDashboard",
    CREATE_COURT: "createCourt",
    EDIT_COURT: "editCourt",
    ADD_DEVICE: "addDevice",
    EDIT_DEVICE: "editDevice"
  };
  const NAV_MODALS = {
    SETTINGS: "settings",
    DETAILS: "details",
    RESET: "reset",
    CONFIRM: "confirm",    
    PLAYER_NAMES: "playerNames"
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

  function normalizePlayerNames(playerNames = {})
  {
    return {
      A1: typeof playerNames?.A1 === "string" ? playerNames.A1 : "",
      A2: typeof playerNames?.A2 === "string" ? playerNames.A2 : "",
      B1: typeof playerNames?.B1 === "string" ? playerNames.B1 : "",
      B2: typeof playerNames?.B2 === "string" ? playerNames.B2 : ""
    };
  }

  function hasAnyPlayerNames(playerNames = {})
  {
    const normalized = normalizePlayerNames(playerNames);
    return Object.values(normalized).some(name => name.trim().length > 0);
  }

  function normalizeTeamNames(teamNames = {})
  {
    const normalizedA = typeof teamNames?.A === "string" ? teamNames.A.trim() : "";
    const normalizedB = typeof teamNames?.B === "string" ? teamNames.B.trim() : "";

    return {
      A: normalizedA || DEFAULT_TEAM_NAMES.A,
      B: normalizedB || DEFAULT_TEAM_NAMES.B
    };
  }

  function isDefaultTeamName(team, name)
  {
    const normalizedTeam = team === "B" ? "B" : "A";
    const normalizedName = typeof name === "string" ? name.trim() : "";
    return !normalizedName || normalizedName === DEFAULT_TEAM_NAMES[normalizedTeam];
  }

  function getTeamSlots(team)
  {
    return team === "B" ? ["B1", "B2"] : ["A1", "A2"];
  }

  function hasPlayersForTeam(team, playerNames = {})
  {
    const normalizedPlayers = normalizePlayerNames(playerNames);
    const [slot1, slot2] = getTeamSlots(team);
    return Boolean(normalizedPlayers[slot1].trim() || normalizedPlayers[slot2].trim());
  }

  function getTeamPlayerDisplayPair(team, playerNames = {})
  {
    const normalizedPlayers = normalizePlayerNames(playerNames);
    const [slot1, slot2] = getTeamSlots(team);
    const first = normalizedPlayers[slot1].trim() || slot1;
    const second = normalizedPlayers[slot2].trim() || slot2;
    
    if (first === slot1 && second === slot2) {
      return "";
    }
    
    return `${first} / ${second}`;
  }

  function resolvePersistedTeamNames(teamNames = {}, playerNames = {})
  {
    return normalizeTeamNames(teamNames);
  }

  function formatTeamDisplayName(team, persistedTeamName, playerNames = {})
  {
    const normalizedTeam = team === "B" ? "B" : "A";
    const baseName = typeof persistedTeamName === "string" && persistedTeamName.trim()
      ? persistedTeamName.trim()
      : DEFAULT_TEAM_NAMES[normalizedTeam];

    if (isDefaultTeamName(normalizedTeam, baseName))
    {
      if (hasPlayersForTeam(normalizedTeam, playerNames))
      {
        return getTeamPlayerDisplayPair(normalizedTeam, playerNames);
      }
      return DEFAULT_TEAM_NAMES[normalizedTeam];
    }

    var playerDisplayPair = getTeamPlayerDisplayPair(normalizedTeam, playerNames);
    playerDisplayPair = playerDisplayPair === "" ? "" : `- ${playerDisplayPair}`;
    return `${baseName} ${playerDisplayPair}`.trim();
  }

  function resolveTeamNames(teamNames = {}, playerNames = {})
  {
    const normalizedTeams = normalizeTeamNames(teamNames);

    return {
      A: formatTeamDisplayName("A", normalizedTeams.A, playerNames),
      B: formatTeamDisplayName("B", normalizedTeams.B, playerNames)
    };
  }

  function getPlayerDisplayName(slot, playerNames = currentPlayerNames, defaultToSlot = false)
  {
    const normalized = normalizePlayerNames(playerNames);
    const value = typeof normalized[slot] === "string" ? normalized[slot].trim() : "";
    return value || (defaultToSlot ? slot : "");
  }

  function getServerDisplayLabel(serverLabel)
  {
    return getPlayerDisplayName(serverLabel, currentPlayerNames, true); 
  }

  function getPlayerLineForTeam(team, playerNames = {})
  {
    const normalizedTeam = team === "B" ? "B" : "A";
    const normalizedPlayers = normalizePlayerNames(playerNames);
    const slots = normalizedTeam === "A" ? ["A1", "A2"] : ["B1", "B2"];
    const playerValues = slots
      .map(slot => (typeof normalizedPlayers[slot] === "string" ? normalizedPlayers[slot].trim() : ""))
      .filter(Boolean);

    return playerValues.length > 0 ? playerValues.join(" / ") : "";
  }

  function buildTeamsShareLines(teamNames = {}, playerNames = {})
  {
    const lines = [];

    const normalizedTeams = normalizeTeamNames(teamNames);
    if (!isDefaultTeamName("A", normalizedTeams.A) && !isDefaultTeamName("B", normalizedTeams.B))
    {
      lines.push(`${normalizedTeams.A} vs ${normalizedTeams.B}`);
    }

    const playersA = getPlayerLineForTeam("A", playerNames);
    const playersB = getPlayerLineForTeam("B", playerNames);
    if (playersA && playersB)
    {
      lines.push(`${playersA} vs ${playersB}`);
    }

    return lines;
  }

  function buildCurrentScoreSummary()
  {
    if (!score || !score.A || !score.B)
    {
      return "";
    }

    const options = resolveScoringOptions(score);
    if (options.scoringMode === "straight" || options.scoringMode === "tiebreakTen")
    {
      const pointsA = Number(score.A.totalPoints ?? score.A.points) || 0;
      const pointsB = Number(score.B.totalPoints ?? score.B.points) || 0;
      return `Score: ${pointsA}-${pointsB} points`;
    }

    let buff = "";
    score.completedSets.forEach((set, index) => {
      const gamesA = set.A || 0;
      const gamesB = set.B || 0;
      buff += `${gamesA}-${gamesB}, `;
    });

    if (score.A.games > 0 || score.B.games > 0) 
    {
      const gamesA = score.A.games || 0;
      const gamesB = score.B.games || 0;
      buff += `${gamesA}-${gamesB}`;
    }

    buff.at(-2) === "," ? buff = buff.slice(0, -2) : null;

    return buff;
  }

  function getSharePayload(context)
  {  
    const payload = { title: "", text: "", files: [] };

    const lines = [];
    lines.push("Padel Push\n");

    lines.push(...buildTeamsShareLines(currentRawTeamNames || {}, currentPlayerNames || {}));
    const scoreSummary = buildCurrentScoreSummary();
    if (scoreSummary)
    {
      lines.push(scoreSummary + "\n");
    }

    lines.push(`${currentCourtName} (${currentCourtId.toUpperCase()})\n`);

    lines.push( context === "details" ? `View full match details:` : `View live scoreboard:`);
    lines.push(buildCourtQrUrl(currentCourtId));

    payload.text = lines.join("\n");

    if (context === "details" && shareableScoreCardImage)
    {        
      payload.files.push(shareableScoreCardImage);
    }
    
    return payload;
  }

  //AL.
  //TODO - test all branches. 
  async function share(context)
  {
    const share_payload = getSharePayload(context);

    let result = { done: false, method: "unavailable" };

    try
    {      
      // 1. Try native sharing with files
      if (navigator.share)
      {
        if
          (
          result.done === false &&
          share_payload.files?.length > 0 &&
          navigator.canShare &&
          navigator.canShare(share_payload)
        )
        {
          try
          {
            await navigator.share({
              title: share_payload.title,
              text: share_payload.text,
              files: share_payload.files
            });
            result = { done: true, method: "native", files: true };
          }
          catch (error)
          {
            if (error?.name === "AbortError")
            {
              result = { done: true, method: "cancelled" };              
            }

            console.warn("Native file share failed:", error);
          }
        }

        // 2. Try native text/URL sharing
        if (result.done === false)
        {
          try
          {
            await navigator.share({
              title: share_payload.title,
              text: share_payload.text,
            });

            result = { done: true, method: "native", files: false };
          }
          catch (error)
          {
            if (error?.name === "AbortError")
            {
              result = { done: true, method: "cancelled" };
            }

            console.warn("Native text share failed:", error);
          }
        }        
      }

      // 3. Clipboard fallback
      if (result.done === false && navigator.clipboard?.writeText)
      {
        try
        {
          await navigator.clipboard.writeText(share_payload.text);
          result = { done: true, method: "clipboard" };
        }
        catch (error)
        {
          console.warn("Clipboard share fallback failed:", error);
        }
      }

      // 4. Last-resort prompt
      if (result.done === false && window.prompt("Copy this share text:", share_payload.text) !== null) 
      {
        result = { done: true, method: "prompt" };
      }
      

      //Toast based on the result of the share attempts
      if (result.method === "native")
      {
        showToast("Shared.", TOAST_TYPES.SUCCESS);
        return;
      }
      if (result.method === "clipboard")
      {
        showToast("Share text copied.", TOAST_TYPES.SUCCESS);
        return;
      }
      if (result.method === "prompt")
      {
        return;
      }
      if (result.method !== "cancelled")
      {
        showToast("Sharing was cancelled.", TOAST_TYPES.ERROR);
      }
      if (result.method === "unavailable")
      {
        showToast("Sharing is unavailable on this device.", TOAST_TYPES.ERROR);
      }
    }
    catch (error)
    {
      console.warn("Share failed:", error);
      showToast("Sharing failed.", TOAST_TYPES.ERROR);
    }
  }

  let score = defaultScore();
  let activeCourtListenerToken = 0;
  let isMatchDetailsCacheValid = false;
  let matchDetailsCache = null;
  let matchDetailsCacheCourtId = null;
  let lastKnownSets = { A: 0, B: 0 };
  let sessionInitialized = false;

  let shareableScoreCardImage = null;

  function invalidateMatchDetailsCache()
  {
    isMatchDetailsCacheValid = false;
    matchDetailsCache = null;
    matchDetailsCacheCourtId = null;
  }

  let muted = false;

  let currentCourtId = null;
  let currentCourtPassword = null;
  let pendingLocalPasswordUpdate = null;
  let currentCourtStatus = null;
  let currentScoreVersion = 0;
  let currentScoringOptions = { ...DEFAULT_SCORING_OPTIONS };
  let currentRawTeamNames = { ...DEFAULT_TEAM_NAMES };
  let currentPlayerNames = { ...DEFAULT_PLAYER_NAMES };

  let isSpectating = false;

  let isAdmin = false;

  let thisDeviceId = DetermineThisDeviceId();

  let lastScannedCourtId = null;
  let lastScannedDeviceId = null;

  let loadingSpinnerStartTime = 0;
  let isDraggingQrPanel = false;
  let qrPointerId = null;
  let qrDragOffsetX = 0;
  let qrDragOffsetY = 0;
  let hasInitializedQrPanelInteractions = false;

  let isPickingColour = false;

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

  let isLightMode = localStorage.getItem("theme") === "light";
  let isWavesEnabled = localStorage.getItem("waves") !== "false";
  let isServerBadgeVisible = localStorage.getItem("serverBadge") !== "false";
  let teamColoursByTheme = loadStoredTeamColours();

  const DEFAULT_TEAM_COLOURS = {
    dark: { A: "#ffff00", B: "#00ffff" },
    light: { A: "#ad7535", B: "#0a91ac" }
  };
  let activeTeamColourPickerPanel = null;
  let activeTeamColourPickerId = 0;
  const TEAM_COLOUR_PICKER_OPTIONS = {
    format: "hex",
    hash: true,
    uppercase: false,
    required: true,
    width: 180,
    height: 180,
    sliderSize: 24,
    padding: 8,
    borderRadius: 4,
    smartPosition: true,
    zIndex: 20000,
    forceStyle: false,
    backgroundColor: isLightMode ? "#ffffff" : "#000000",
    borderColor: isLightMode ? "#00000030" : "#ffffff3a",
    controlBorderColor: isLightMode ? "#ffffff" : "#000000",
    pointerBorderColor: isLightMode ? "#ffffff" : "#000000",
    pointerColor: isLightMode ? "#000000" : "#ffffff",

  };


  let appNavigationStack = [];
  let appNavigationIndex = -1;
  let isRestoringNavigation = false;
  let currentCourtHistorySessionId = 0;

  function getTeamColourPickerPanel()
  {
    const pickerZIndex = String(TEAM_COLOUR_PICKER_OPTIONS.zIndex);
    const bodyChildren = Array.from(document.body.children);

    for (let index = bodyChildren.length - 1; index >= 0; index -= 1)
    {
      const candidate = bodyChildren[index];
      if (!(candidate instanceof HTMLElement)) continue;
      if (candidate.id === "content-container") continue;

      const computedStyle = window.getComputedStyle(candidate);
      if (computedStyle.zIndex !== pickerZIndex) continue;
      if (computedStyle.position !== "absolute" && computedStyle.position !== "fixed") continue;

      return candidate;
    }

    return null;
  }

  function clearTeamColourPickerReveal()
  {
    if (!activeTeamColourPickerPanel) return;

    activeTeamColourPickerPanel.classList.remove("is-revealing");
    activeTeamColourPickerPanel.style.removeProperty("--picker-reveal-x");
    activeTeamColourPickerPanel.style.removeProperty("--picker-reveal-y");
  }

  function bindTeamColourPickerPanel()
  {
    const panel = getTeamColourPickerPanel();
    if (!panel || panel === activeTeamColourPickerPanel) return;

    activeTeamColourPickerPanel = panel;
    activeTeamColourPickerId += 1;
    panel.dataset.teamColourPickerId = String(activeTeamColourPickerId);
    panel.classList.add("team-colour-picker-panel");
    clearTeamColourPickerReveal();
  }

  function updateTeamColourPickerReveal(clientX, clientY)
  {
    const panel = getTeamColourPickerPanel();
    if (!panel) return;

    if (panel !== activeTeamColourPickerPanel)
    {
      bindTeamColourPickerPanel();
    }

    const panelRect = panel.getBoundingClientRect();
    const revealX = Math.max(0, Math.min(clientX - panelRect.left, panelRect.width));
    const revealY = Math.max(0, Math.min(clientY - panelRect.top, panelRect.height));

    panel.style.setProperty("--picker-reveal-x", `${revealX}px`);
    panel.style.setProperty("--picker-reveal-y", `${revealY}px`);
    panel.classList.add("is-revealing");
  }

  const teamColourPickerObserver = new MutationObserver(() =>
  {
    bindTeamColourPickerPanel();

    if (!getTeamColourPickerPanel())
    {
      activeTeamColourPickerPanel = null;
    }
  });

  teamColourPickerObserver.observe(document.body, { childList: true });

  document.addEventListener("pointerdown", (event) =>
  {
    const panel = getTeamColourPickerPanel();
    if (!panel || !panel.contains(event.target)) return;

    isPickingColour = true;
    updateTeamColourPickerReveal(event.clientX, event.clientY);
  });

  document.addEventListener("pointermove", (event) =>
  {
    if (!isPickingColour) return;
    updateTeamColourPickerReveal(event.clientX, event.clientY);
  });

  document.addEventListener("pointerup", () =>
  {
    clearTeamColourPickerReveal();
  });

  document.addEventListener("pointercancel", () =>
  {
    clearTeamColourPickerReveal();
  });

  function normalizeCourtId(value)
  {
    if (typeof value !== "string") return null;

    const normalized = value.trim().toLowerCase();
    return normalized || null;
  }

  function normalizeViewState(viewState = {})
  {
    const page = typeof viewState.page === "string" ? viewState.page : NAV_PAGES.MENU;
    const normalized = {
      page,
      courtId: normalizeCourtId(viewState.courtId),
      selectedCourtId: normalizeCourtId(viewState.selectedCourtId),
      spectate: Boolean(viewState.spectate),
      modal: typeof viewState.modal === "string" ? viewState.modal : null,
      returnToScoreboard: Boolean(viewState.returnToScoreboard),
      entityId: typeof viewState.entityId === "string" ? viewState.entityId : null
    };

    if (normalized.page !== NAV_PAGES.SCOREBOARD)
    {
      normalized.modal = null;
    }

    if (normalized.page !== NAV_PAGES.SCOREBOARD && !(normalized.page === NAV_PAGES.PLAY && normalized.returnToScoreboard))
    {
      normalized.courtId = null;
      normalized.spectate = false;
    }

    return normalized;
  }

  function createViewState(overrides = {})
  {
    return normalizeViewState({ page: NAV_PAGES.MENU, ...overrides });
  }

  function isAdminProtectedPage(page)
  {
    return [
      NAV_PAGES.ADMIN_DASHBOARD,
      NAV_PAGES.CREATE_COURT,
      NAV_PAGES.EDIT_COURT,
      NAV_PAGES.ADD_DEVICE,
      NAV_PAGES.EDIT_DEVICE
    ].includes(page);
  }

  function isAdminProtectedViewVisible()
  {
    return isElementVisible(elements.adminDashboardPage) ||
      isElementVisible(elements.createPage) ||
      isElementVisible(elements.editCourtPage) ||
      isElementVisible(elements.addDevicePage) ||
      isElementVisible(elements.editDevicePage);
  }

  function viewStatesEqual(left, right)
  {
    const a = normalizeViewState(left);
    const b = normalizeViewState(right);

    return a.page === b.page &&
      a.courtId === b.courtId &&
      a.selectedCourtId === b.selectedCourtId &&
      a.spectate === b.spectate &&
      a.modal === b.modal &&
      a.returnToScoreboard === b.returnToScoreboard &&
      a.entityId === b.entityId;
  }

  function isElementVisible(el)
  {
    return Boolean(el) && window.getComputedStyle(el).display !== "none";
  }

  function isOverlayVisible(el)
  {
    return Boolean(el) && !el.classList.contains("hidden");
  }

  function getAppBasePath()
  {
    return window.location.pathname === "/app" || window.location.pathname.startsWith("/app/")
      ? "/app"
      : "";
  }

  function buildUrlForViewState(viewState)
  {
    const state = normalizeViewState(viewState);
    const basePath = getAppBasePath();

    if (state.page === NAV_PAGES.SCOREBOARD && state.courtId)
    {
      return `${basePath}/c/${encodeURIComponent(state.courtId)}`;
    }

    return basePath ? `${basePath}/` : "/";
  }

  function buildHistoryPayload(viewState, index)
  {
    return {
      [NAV_HISTORY_STATE_KEY]: true,
      index,
      viewState: normalizeViewState(viewState),
      courtSessionId: currentCourtHistorySessionId
    };
  }

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
    const pickers = document.querySelectorAll("[data-team-colour]");
    const JsColor = window.JSColor || window.jscolor;

    if (!JsColor)
    {
      return;
    }

    pickers.forEach((picker) =>
    {
      if (!picker.jscolor)
      {
        new JsColor(picker, {
          ...TEAM_COLOUR_PICKER_OPTIONS,
          onInput()
          {
            isPickingColour = true;
            bindTeamColourPickerPanel();
            elements.settingsModal.classList.add("hidden");
            
            const pickedColour = normalizeHexColour(this.toHEXString());
            if (!pickedColour) return;
            setTeamColour(picker.dataset.teamColour, pickedColour);
          },
          onChange()
          {
            isPickingColour = false;
            clearTeamColourPickerReveal();
            if (currentCourtId)
            {
              elements.settingsModal.classList.remove("hidden");
            }
            
            const pickedColour = normalizeHexColour(this.toHEXString());
            if (!pickedColour) return;
            setTeamColour(picker.dataset.teamColour, pickedColour);
          },

        });
      }
    });
  }

  function updateTeamColourInput(picker, colour)
  {
    picker.value = colour;
    picker.style.setProperty("--picker-colour", colour);

    if (!picker.jscolor) return;

    const pickerColour = normalizeHexColour(picker.jscolor.toHEXString());
    if (pickerColour !== colour)
    {
      picker.jscolor.fromString(colour);
    }

    picker.jscolor.backgroundColor = isLightMode ? "#ffffff" : "#000000";
    picker.jscolor.borderColor = isLightMode ? "#00000030" : "#ffffff3a";
    picker.jscolor.controlBorderColor = isLightMode ? "#ffffff" : "#000000";
    picker.jscolor.pointerBorderColor = isLightMode ? "#ffffff" : "#000000";
    picker.jscolor.pointerColor = isLightMode ? "#000000" : "#ffffff";
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
      const readableTextColour = getReadableTextColour(previewColours);

      button.style.setProperty("--theme-choice-a", previewColours.A);
      button.style.setProperty("--theme-choice-b", previewColours.B);
      button.style.setProperty("--theme-choice-text", readableTextColour);
      button.style.setProperty("--theme-choice-shadow", readableTextColour === "#000000" ? "#ffffff" : "#000000");
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
    elements.waveToggleScoreboardBtn.textContent = isWavesEnabled ? "♒︎" : "═";

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

    elements.fullscreenBtn.textContent = isActive ? "⬚" : "⛶";
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
    startupLoading: $("startupLoading"),
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
    playerNamesModal: $("playerNamesModal"),
    closePlayerNamesBtn: $("closePlayerNamesBtn"),
    playerNamesForm: $("playerNamesForm"),
    cancelPlayerNamesBtn: $("cancelPlayerNamesBtn"),
    playerTeamAName: $("playerTeamAName"),
    playerTeamBName: $("playerTeamBName"),
    playerNameA1: $("playerNameA1"),
    playerNameA2: $("playerNameA2"),
    playerNameB1: $("playerNameB1"),
    playerNameB2: $("playerNameB2"),
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
    editPlayersBtn: $("editPlayersBtn"),
    editPlayersTile: $("editPlayersTile"),
    resetSettingsBtn: $("resetSettingsBtn"),
    resetSettingsTile: $("resetSettingsTile"),
    obsOverlayBtn: $("obsOverlayBtn"),
    joinCourtBtn: $("joinCourtBtn"),
    joinCourtTile: $("joinCourtTile"),
    switchToSpectateBtn: $("switchToSpectateBtn"),
    switchToSpectateTile: $("switchToSpectateTile"),

    sep1: $("sep1"),
    sep2: $("sep2"),
    sep3: $("sep3"),

    detailsBtn: $("detailsBtn"),
    detailsModal: $("detailsModal"),
    closeDetailsBtn: $("closeDetailsBtn"),
    shareDetailsBtn: $("shareDetailsBtn"),
    shareCourtBtn: $("shareCourtBtn"),
    matchDetailsCourtName: $("matchDetailsCourtName"),
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
    dmErrorState: $("dmErrorState"),
    dmStatsWrap: $("dmStatsWrap"),
    dmStatsTeam: $("dmStatsTeam"),
    courtQrPanel: $("courtQrPanel"),
    courtQrCode: $("courtQrCode"),
    courtQrLabel: $("courtQrLabel"),

    confirmModal: $("confirmModal"),
    confirmMessage: $("confirmMessage"),
    confirmOkBtn: $("confirmOkBtn"),
    confirmCancelBtn: $("confirmCancelBtn"),

    setWinOverlay: $("setWinOverlay"),
    scoreboardLoading: $("scoreboardLoading"),
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
  elements.editPlayerA1Name = $("editPlayerA1Name");
  elements.editPlayerA2Name = $("editPlayerA2Name");
  elements.editPlayerB1Name = $("editPlayerB1Name");
  elements.editPlayerB2Name = $("editPlayerB2Name");
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
  let isJoiningCourt = false;

  let allAdminCourts = [];

  //RESET COURT ELEMENTS
  elements.resetCourtPassword = $("resetCourtPassword");
  elements.resetPasswordError = $("resetPasswordError");

  initializeCourtQrPanelInteractions();

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
  let startupLoadingDelayTimer = null;
  let scoreboardLoadingDelayTimer = null;

  // =====================================================
  // INITIALIZE THEME
  // =====================================================

  function scheduleLoadingIndicator(overlayEl, onSpinnerShown = null)
  {
    if (!overlayEl) return null;

    overlayEl.classList.remove("show-spinner");

    const revealSpinner = () =>
    {
      overlayEl.classList.add("show-spinner");
      if (typeof onSpinnerShown === "function")
      {
        onSpinnerShown();
      }
    };

    if (LOAD_SPINNER_DELAY_MS <= 0)
    {
      revealSpinner();
      return null;
    }

    return window.setTimeout(revealSpinner, LOAD_SPINNER_DELAY_MS);
  }

  function beginStartupLoading()
  {
    if (!elements.startupLoading) return;

    if (startupLoadingDelayTimer)
    {
      window.clearTimeout(startupLoadingDelayTimer);
      startupLoadingDelayTimer = null;
    }

    elements.startupLoading.classList.remove("hidden");
    startupLoadingDelayTimer = scheduleLoadingIndicator(elements.startupLoading);
  }

  function finishStartupLoading()
  {
    if (!elements.startupLoading) return;

    if (startupLoadingDelayTimer)
    {
      window.clearTimeout(startupLoadingDelayTimer);
      startupLoadingDelayTimer = null;
    }

    elements.startupLoading.classList.remove("show-spinner");
    elements.startupLoading.classList.add("hidden");
  }

  function beginScoreboardLoading()
  {
    if (!elements.scoreboardLoading) return;

    if (scoreboardLoadingDelayTimer)
    {
      window.clearTimeout(scoreboardLoadingDelayTimer);
      scoreboardLoadingDelayTimer = null;
    }

    loadingSpinnerStartTime = 0;
    elements.scoreboardLoading.classList.remove("hidden");
    scoreboardLoadingDelayTimer = scheduleLoadingIndicator(elements.scoreboardLoading, () =>
    {
      loadingSpinnerStartTime = Date.now();
    });
  }

  function finishScoreboardLoading()
  {
    if (!elements.scoreboardLoading) return;

    if (scoreboardLoadingDelayTimer)
    {
      window.clearTimeout(scoreboardLoadingDelayTimer);
      scoreboardLoadingDelayTimer = null;
    }

    const hideOverlay = () =>
    {
      elements.scoreboardLoading.classList.remove("show-spinner");
      elements.scoreboardLoading.classList.add("hidden");
      loadingSpinnerStartTime = 0;
    };

    if (!loadingSpinnerStartTime)
    {
      hideOverlay();
      return;
    }

    const spinnerTimeElapsed = Date.now() - loadingSpinnerStartTime;
    if (spinnerTimeElapsed >= LOADING_SPINNER_MIN_DURATION_MS)
    {
      hideOverlay();
      return;
    }

    window.setTimeout(hideOverlay, LOADING_SPINNER_MIN_DURATION_MS - spinnerTimeElapsed);
  }

  initializeTheme();
  initializeWaves();
  updateFullscreenButton();
  beginStartupLoading();
  void initializeAppNavigation();

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

  // ADD DEVICE PAGE
  submitOnEnter(elements.newDeviceId, elements.saveNewDeviceBtn);
  submitOnEnter(elements.newDeviceCourtIdManual, elements.saveNewDeviceBtn);
  submitOnEnter(elements.newDeviceCourtIdSelect, elements.saveNewDeviceBtn);
  submitFormOnEnter(elements.addDevicePage);

  // EDIT DEVICE PAGE
  submitOnEnter(elements.editDeviceCourtIdManual, elements.saveEditDeviceBtn);
  submitOnEnter(elements.editDeviceCourtIdSelect, elements.saveEditDeviceBtn);
  submitFormOnEnter(elements.editDevicePage);

  // EDIT COURT PAGE
  submitOnEnter(elements.editCourtName, elements.saveEditBtn);
  submitOnEnter(elements.editTeamAName, elements.saveEditBtn);
  submitOnEnter(elements.editTeamBName, elements.saveEditBtn);
  submitOnEnter(elements.editCourtPassword, elements.saveEditBtn);
  submitOnEnter(elements.editCourtStatus, elements.saveEditBtn);
  submitOnEnter(elements.editCourtScoringMode, elements.saveEditBtn);
  submitFormOnEnter(elements.editCourtPage);

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
      void closePlayPage();
      return;
    }

    if (isVisible(elements.resetModal))
    {
      void stepBackInApp(createViewState({
        page: NAV_PAGES.SCOREBOARD,
        courtId: currentCourtId,
        spectate: isSpectating
      }));
      return;
    }

    if (isVisible(elements.settingsModal))
    {
      void stepBackInApp(createViewState({
        page: NAV_PAGES.SCOREBOARD,
        courtId: currentCourtId,
        spectate: isSpectating
      }));
      return;
    }

    if (isVisible(elements.detailsModal))
    {
      void stepBackInApp(createViewState({
        page: NAV_PAGES.SCOREBOARD,
        courtId: currentCourtId,
        spectate: isSpectating
      }));
      return;
    }

    if (isVisible(elements.confirmModal))
    {
      elements.confirmCancelBtn.click();
      return;
    }

    if (isVisible(elements.playPage))
    {
      void stepBackInApp(createViewState({
        page: playPageReturnToScoreboard && currentCourtId ? NAV_PAGES.SCOREBOARD : NAV_PAGES.MENU,
        courtId: currentCourtId,
        spectate: isSpectating
      }));
      return;
    }

    if (isVisible(elements.spectatePage))
    {
      void stepBackInApp(createViewState({ page: NAV_PAGES.MENU }));
      return;
    }

    if (isVisible(elements.scoreboardPage))
    {
      void stepBackInApp(createViewState({ page: NAV_PAGES.MENU }));
      return;
    }

    if (isVisible(elements.adminAuthPage))
    {
      void stepBackInApp(createViewState({ page: NAV_PAGES.MENU }));
      return;
    }

    if (isVisible(elements.adminDashboardPage))
    {
      isAdmin = false;
      void stepBackInApp(createViewState({ page: NAV_PAGES.MENU }));
      return;
    }

    if (isVisible(elements.createPage))
    {
      void stepBackInApp(createViewState({ page: NAV_PAGES.ADMIN_DASHBOARD }));
      return;
    }

    if (isVisible(elements.addDevicePage))
    {
      void stepBackInApp(createViewState({ page: NAV_PAGES.ADMIN_DASHBOARD }));
      return;
    }

    if (isVisible(elements.editCourtPage))
    {
      void stepBackInApp(createViewState({ page: NAV_PAGES.ADMIN_DASHBOARD }));
      return;
    }

    if (isVisible(elements.editDevicePage))
    {
      void stepBackInApp(createViewState({ page: NAV_PAGES.ADMIN_DASHBOARD }));
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

  function getCourtIdFromPathname()
  {
    const match = window.location.pathname.match(/^\/(?:app\/)?(?:court|c)\/([^/]+)\/?$/i);
    if (!match) return null;

    try
    {
      return decodeURIComponent(match[1]).trim().toLowerCase() || null;
    }
    catch
    {
      return match[1].trim().toLowerCase() || null;
    }
  }

  function getCurrentViewState()
  {
    if (currentCourtId)
    {
      const modalMap = [
        [elements.resetModal, NAV_MODALS.RESET],
        [elements.detailsModal, NAV_MODALS.DETAILS],
        [elements.settingsModal, NAV_MODALS.SETTINGS],
        [elements.confirmModal, NAV_MODALS.CONFIRM],
        [elements.playerNamesModal, NAV_MODALS.PLAYER_NAMES]
      ];

      for (const [element, modal] of modalMap)
      {
        if (isOverlayVisible(element))
        {
          return createViewState({
            page: NAV_PAGES.SCOREBOARD,
            courtId: currentCourtId,
            spectate: isSpectating,
            modal
          });
        }
      }
    }

    if (isElementVisible(elements.editDevicePage))
    {
      return createViewState({
        page: NAV_PAGES.EDIT_DEVICE,
        entityId: currentDeviceToEdit?.id || null
      });
    }

    if (isElementVisible(elements.addDevicePage))
    {
      return createViewState({ page: NAV_PAGES.ADD_DEVICE });
    }

    if (isElementVisible(elements.editCourtPage))
    {
      return createViewState({
        page: NAV_PAGES.EDIT_COURT,
        entityId: courtToEdit?.id || null
      });
    }

    if (isElementVisible(elements.createPage))
    {
      return createViewState({ page: NAV_PAGES.CREATE_COURT });
    }

    if (isElementVisible(elements.adminDashboardPage))
    {
      return createViewState({ page: NAV_PAGES.ADMIN_DASHBOARD });
    }

    if (isElementVisible(elements.adminAuthPage))
    {
      return createViewState({ page: NAV_PAGES.ADMIN_AUTH });
    }

    if (currentCourtId && isElementVisible(elements.playPage) && playPageReturnToScoreboard)
    {
      return createViewState({
        page: NAV_PAGES.PLAY,
        courtId: currentCourtId,
        selectedCourtId: selectedPlayCourt || currentCourtId,
        returnToScoreboard: true
      });
    }

    if (currentCourtId && isElementVisible(elements.scoreboardPage))
    {
      return createViewState({
        page: NAV_PAGES.SCOREBOARD,
        courtId: currentCourtId,
        spectate: isSpectating
      });
    }

    if (isElementVisible(elements.spectatePage))
    {
      return createViewState({ page: NAV_PAGES.SPECTATE });
    }

    if (isElementVisible(elements.playPage))
    {
      return createViewState({
        page: NAV_PAGES.PLAY,
        selectedCourtId: selectedPlayCourt
      });
    }

    return createViewState({ page: NAV_PAGES.MENU });
  }

  function replaceNavigationState(viewState)
  {
    const normalized = normalizeViewState(viewState);

    if (appNavigationIndex === -1)
    {
      appNavigationStack = [normalized];
      appNavigationIndex = 0;
    }
    else
    {
      if (viewStatesEqual(appNavigationStack[appNavigationIndex], normalized))
      {
        return;
      }

      appNavigationStack[appNavigationIndex] = normalized;
    }

    window.history.replaceState(
      buildHistoryPayload(normalized, appNavigationIndex),
      "",
      buildUrlForViewState(normalized)
    );
  }

  function pushNavigationState(viewState)
  {
    const normalized = normalizeViewState(viewState);

    if (appNavigationIndex >= 0 && viewStatesEqual(appNavigationStack[appNavigationIndex], normalized))
    {
      return;
    }

    if (appNavigationIndex < appNavigationStack.length - 1)
    {
      appNavigationStack = appNavigationStack.slice(0, appNavigationIndex + 1);
    }

    appNavigationStack.push(normalized);
    appNavigationIndex = appNavigationStack.length - 1;

    window.history.pushState(
      buildHistoryPayload(normalized, appNavigationIndex),
      "",
      buildUrlForViewState(normalized)
    );
  }

  function syncCurrentViewState(mode = "push")
  {
    if (isRestoringNavigation) return;

    let f = mode === "replace" ? replaceNavigationState : pushNavigationState;
    f(getCurrentViewState());
  }

  function getViewStateFromLocation()
  {
    const courtId = getCourtIdFromPathname();

    if (courtId)
    {
      return createViewState({
        page: NAV_PAGES.SCOREBOARD,
        courtId,
        spectate: true
      });
    }

    return createViewState({ page: NAV_PAGES.MENU });
  }

  function closeManagedModals()
  {
    elements.settingsModal.classList.add("hidden");
    elements.detailsModal.classList.add("hidden");
    elements.resetModal.classList.add("hidden");
    elements.confirmModal.classList.add("hidden");
    elements.playerNamesModal.classList.add("hidden");
  }

  function bumpCourtHistorySessionId()
  {
    currentCourtHistorySessionId += 1;
  }

  function hideManagedPages()
  {
    elements.menuPage.style.display = "none";
    elements.createPage.style.display = "none";
    setPlayPageVisible(false);
    elements.spectatePage.style.display = "none";
    elements.adminAuthPage.style.display = "none";
    elements.adminDashboardPage.style.display = "none";
    elements.editCourtPage.style.display = "none";
    elements.addDevicePage.style.display = "none";
    elements.editDevicePage.style.display = "none";
    elements.scoreboardPage.style.display = "none";
  }

  function syncPlaySelection(courtId)
  {
    selectedPlayCourt = normalizeCourtId(courtId);

    elements.playCourtList.querySelectorAll(".court-item").forEach(item =>
    {
      item.classList.toggle("active", item.dataset.courtId === selectedPlayCourt);
    });

    elements.playPasswordSection.style.display = selectedPlayCourt ? "block" : "none";
  }

  function showCurrentScoreboardView()
  {
    elements.menuPage.style.display = "none";
    elements.createPage.style.display = "none";
    setPlayPageVisible(false);
    elements.spectatePage.style.display = "none";
    elements.adminAuthPage.style.display = "none";
    elements.adminDashboardPage.style.display = "none";
    elements.editCourtPage.style.display = "none";
    elements.addDevicePage.style.display = "none";
    elements.editDevicePage.style.display = "none";

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
  }

  async function restoreViewState(viewState)
  {
    const state = normalizeViewState(viewState);
    const wasOnAdminProtectedView = isAdminProtectedViewVisible();
    const navigatingToAdminProtectedView = isAdminProtectedPage(state.page);

    if (wasOnAdminProtectedView && !navigatingToAdminProtectedView)
    {
      isAdmin = false;
    }

    if (navigatingToAdminProtectedView && !isAdmin)
    {
      state.page = NAV_PAGES.ADMIN_AUTH;
      state.entityId = null;
    }

    isRestoringNavigation = true;

    try
    {
      closeManagedModals();

      const shouldKeepCurrentCourt = (
        state.page === NAV_PAGES.SCOREBOARD &&
        state.courtId === currentCourtId &&
        state.spectate === isSpectating
      ) || (
        state.page === NAV_PAGES.PLAY &&
        state.returnToScoreboard &&
        state.courtId === currentCourtId
      );

      if (currentCourtId && !shouldKeepCurrentCourt)
      {
        leaveCourt("skip");
      }

      hideManagedPages();

      if (state.page === NAV_PAGES.SCOREBOARD)
      {
        if (!state.courtId)
        {
          elements.menuPage.style.display = "flex";
          return;
        }

        if (currentCourtId !== state.courtId)
        {
          if (state.spectate)
          {
            await enterCourt(state.courtId, true, { historyMode: "skip" });
          }
          else 
          {
            await restoreViewState(createViewState({ page: NAV_PAGES.PLAY }));
            return;
          }
        }
        else 
        {
          showCurrentScoreboardView();
        }              

        if (state.modal === NAV_MODALS.SETTINGS)
        {
          updateFullscreenButton();
          syncScoringControls();
          elements.settingsModal.classList.remove("hidden");
          syncSettingsTiles();
        }
        else if (state.modal === NAV_MODALS.DETAILS)
        {
          await showMatchDetails(false);
        }      

        return;
      }

      if (state.page === NAV_PAGES.PLAY)
      {
        playPageReturnToScoreboard = state.returnToScoreboard;

        if (state.returnToScoreboard && currentCourtId === state.courtId)
        {
          showCurrentScoreboardView();
        }

        setPlayPageVisible(true);
        elements.playCourtSearch.value = "";
        elements.playCourtPassword.value = "";
        elements.playCourtNameError.style.display = "none";
        elements.playCourtNameError.textContent = "";
        elements.playCourtPasswordError.textContent = "";
        await loadCourtsWithInlineLoader(elements.playCourtList, true);
        displayPlayCourtList(allCourts);
        syncPlaySelection(state.selectedCourtId || state.courtId);
        if (selectedPlayCourt)
        {
          const selectedCourt = allCourts.find((court) => court.id === selectedPlayCourt);
          elements.playCourtSearch.value = selectedCourt?.name || selectedPlayCourt;
        }
        return;
      }

      playPageReturnToScoreboard = false;

      if (state.page === NAV_PAGES.SPECTATE)
      {
        elements.spectatePage.style.display = "flex";
        elements.spectateCourtSearch.value = "";
        elements.spectateCourtNameError.style.display = "none";
        elements.spectateCourtNameError.textContent = "";
        await loadCourtsWithInlineLoader(elements.spectateCourtList, false);
        displaySpectateCourtList(allCourts);
        return;
      }

      if (state.page === NAV_PAGES.ADMIN_AUTH)
      {
        elements.adminAuthPage.style.display = "flex";
        elements.adminAuthPassword.value = "";
        elements.adminAuthError.textContent = "";
        return;
      }

      if (state.page === NAV_PAGES.ADMIN_DASHBOARD)
      {
        elements.adminDashboardPage.style.display = "flex";
        void displayAdminCourtList();
        return;
      }

      if (state.page === NAV_PAGES.CREATE_COURT)
      {
        elements.createPage.style.display = "flex";
        return;
      }

      if (state.page === NAV_PAGES.EDIT_COURT)
      {
        if (courtToEdit?.id === state.entityId)
        {
          elements.editCourtPage.style.display = "flex";
          return;
        }

        if (state.entityId)
        {
          const snap = await getDoc(doc(db, "courts", state.entityId));
          if (snap.exists())
          {
            openEditModal({ id: snap.id, ...snap.data() }, false);
            return;
          }
        }

        elements.adminDashboardPage.style.display = "flex";
        void displayAdminCourtList();
        return;
      }

      if (state.page === NAV_PAGES.ADD_DEVICE)
      {
        elements.addDevicePage.style.display = "flex";
        return;
      }

      if (state.page === NAV_PAGES.EDIT_DEVICE)
      {
        if (currentDeviceToEdit?.id === state.entityId)
        {
          elements.editDevicePage.style.display = "flex";
          return;
        }

        if (state.entityId)
        {
          const snap = await getDoc(doc(db, "devices", state.entityId));
          if (snap.exists())
          {
            await openEditDeviceModal({ id: snap.id, ...snap.data() }, false);
            return;
          }
        }

        elements.adminDashboardPage.style.display = "flex";
        void loadDevices();
        return;
      }

      elements.menuPage.style.display = "flex";
    }
    finally
    {
      isRestoringNavigation = false;
    }
  }

  async function stepBackInApp(fallbackViewState = createViewState({ page: NAV_PAGES.MENU }))
  {
    if (appNavigationIndex > 0)
    {
      window.history.back();
      return;
    }

    await restoreViewState(fallbackViewState);
    replaceNavigationState(fallbackViewState);
  }

  async function initializeAppNavigation()
  {
    try
    {
      const routeState = getViewStateFromLocation();
      replaceNavigationState(createViewState({ page: NAV_PAGES.MENU }));

      if (routeState.page === NAV_PAGES.SCOREBOARD && routeState.courtId)
      {
        const opened = await openCourtFromRoute("skip", routeState.courtId);
        if (opened)
        {
          pushNavigationState(getCurrentViewState());
          return;
        }
      }

      await restoreViewState(createViewState({ page: NAV_PAGES.MENU }));
      replaceNavigationState(getCurrentViewState());
    }
    finally
    {
      finishStartupLoading();
    }
  }

  window.addEventListener("popstate", (event) =>
  {
    const nextState = event.state?.[NAV_HISTORY_STATE_KEY]
      ? event.state.viewState
      : getViewStateFromLocation();

    if (nextState.modal && event.state?.courtSessionId !== currentCourtHistorySessionId)
    {
      window.history.back();
      return;
    }

    if (typeof event.state?.index === "number")
    {
      appNavigationIndex = event.state.index;
    }
    else if (appNavigationIndex > 0)
    {
      appNavigationIndex -= 1;
    }

    void restoreViewState(nextState);
  });

  async function openCourtFromRoute(historyMode = "replace", courtId = null)
  {
    const resolvedCourtId = courtId !== null ? courtId : getCourtIdFromPathname();
    if (!resolvedCourtId) return false;

    const courtSnap = await getDoc(doc(db, "courts", resolvedCourtId));
    if (!courtSnap.exists())
    {
      showToast(`Court "${resolvedCourtId}" not found.`, TOAST_TYPES.ERROR);
      return false;
    }

    elements.menuPage.style.display = "none";
    elements.spectatePage.style.display = "none";

    await enterCourt(resolvedCourtId, true, { historyMode });
    if (!currentCourtId)
    {
      elements.menuPage.style.display = "flex";
      showToast(`Court "${resolvedCourtId}" not found.`, TOAST_TYPES.ERROR);
      return false;
    }

    return currentCourtId !== null;
  }

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
            status: data.status,
            teamNames: normalizeTeamNames(data.teamNames || {}),
            playerNames: normalizePlayerNames(data.playerNames || {})
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

  function showCourtListLoading(listContainer)
  {
    if (!listContainer) return;

    listContainer.innerHTML = `
      <div class="loading"><span class="loader"></span></div>
    `;

    syncCourtListFadeState(listContainer);
  }

  function syncCourtListFadeState(listContainer)
  {
    if (!listContainer) return;

    const hasOverflow = listContainer.scrollHeight > listContainer.clientHeight + 1;
    const atTop = listContainer.scrollTop <= 1;
    const atBottom = listContainer.scrollTop + listContainer.clientHeight >= listContainer.scrollHeight - 1;

    listContainer.classList.toggle("has-overflow", hasOverflow);
    listContainer.classList.toggle("fade-top", hasOverflow && !atTop);
    listContainer.classList.toggle("fade-bottom", hasOverflow && !atBottom);
  }

  function ensureCourtListFadeBinding(listContainer)
  {
    if (!listContainer || listContainer.dataset.fadeBound === "true") return;

    listContainer.dataset.fadeBound = "true";
    listContainer.addEventListener("scroll", () =>
    {
      syncCourtListFadeState(listContainer);
    }, { passive: true });
  }

  async function ensureMinimumLoadingDuration(startedAt)
  {
    if (!Number.isFinite(startedAt)) return;

    const elapsed = Date.now() - startedAt;
    const remaining = LOADING_SPINNER_MIN_DURATION_MS - elapsed;
    if (remaining <= 0) return;

    await new Promise(resolve => window.setTimeout(resolve, remaining));
  }

  async function loadCourtsWithInlineLoader(listContainer, includePrivateCourts = true)
  {
    showCourtListLoading(listContainer);
    const startedAt = Date.now();

    await loadAllActiveCourts(includePrivateCourts);
    await ensureMinimumLoadingDuration(startedAt);
  }

  function displayPlayCourtList(courts)
  {
    const listContainer = elements.playCourtList;
    ensureCourtListFadeBinding(listContainer);
    listContainer.innerHTML = "";

    if (courts.length === 0)
    {
      listContainer.innerHTML = '<div class="no-courts">No courts found</div>';
      syncCourtListFadeState(listContainer);
      return;
    }

    courts.forEach((court, index) =>
    {
      const item = document.createElement("div");
      item.className = "court-item";
      item.dataset.courtName = court.name;
      item.dataset.courtId = court.id;
      item.tabIndex = 0;
      item.role = "button";
      item.setAttribute("aria-label", `${court.name} - ${court.id}`);

      item.innerHTML = `
        <div class="court-item-name">${court.name}</div>
        <span class="court-item-id">${court.id}</span>
    `;

      const selectCourt = () =>
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
        elements.playCourtNameError.style.display = "none";
        elements.playCourtNameError.textContent = "";
        elements.playCourtPasswordError.textContent = "";
      };

      item.addEventListener("click", selectCourt);
      
      item.addEventListener("keydown", (e) =>
      {
        if (e.key === "Enter" || e.key === " ")
        {
          e.preventDefault();
          selectCourt();
        }
        else if (e.key === "ArrowDown")
        {
          e.preventDefault();
          const nextItem = item.nextElementSibling;
          if (nextItem && nextItem.classList.contains("court-item"))
          {
            nextItem.focus();
          }
        }
        else if (e.key === "ArrowUp")
        {
          e.preventDefault();
          const prevItem = item.previousElementSibling;
          if (prevItem && prevItem.classList.contains("court-item"))
          {
            prevItem.focus();
          }
        }
      });

      listContainer.appendChild(item);
    });

    syncCourtListFadeState(listContainer);
  }

  function displaySpectateCourtList(courts)
  {
    const listContainer = elements.spectateCourtList;
    ensureCourtListFadeBinding(listContainer);
    listContainer.innerHTML = "";

    if (courts.length === 0)
    {
      listContainer.innerHTML = '<div class="no-courts">No courts found</div>';
      syncCourtListFadeState(listContainer);
      return;
    }

    courts.forEach(court =>
    {
      const item = document.createElement("div");
      item.className = "court-item";
      item.dataset.courtName = court.name;
      item.dataset.courtId = court.id;
      item.tabIndex = 0;
      item.role = "button";
      item.setAttribute("aria-label", `${court.name} - ${court.id}`);

      item.innerHTML = `
        <div class="court-item-name">${court.name}</div>
        <span class="court-item-id">${court.id}</span>
    `;

      const selectCourt = async () =>
      {
        await enterCourt(court.id, true, { historyMode: "replace" });
      };

      item.addEventListener("click", selectCourt);

      item.addEventListener("keydown", (e) =>
      {
        if (e.key === "Enter" || e.key === " ")
        {
          e.preventDefault();
          void selectCourt();
        }
        else if (e.key === "ArrowDown")
        {
          e.preventDefault();
          const nextItem = item.nextElementSibling;
          if (nextItem && nextItem.classList.contains("court-item"))
          {
            nextItem.focus();
          }
        }
        else if (e.key === "ArrowUp")
        {
          e.preventDefault();
          const prevItem = item.previousElementSibling;
          if (prevItem && prevItem.classList.contains("court-item"))
          {
            prevItem.focus();
          }
        }
      });

      listContainer.appendChild(item);
    });

    syncCourtListFadeState(listContainer);
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

    //sort courts by name, then by id
    courts.sort((a, b) => {
      const nameComparison = (a.name || "").localeCompare(b.name || "");
      if (nameComparison !== 0) return nameComparison;
      return a.id.localeCompare(b.id);
    });

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

      const resolvedTeamNames = resolveTeamNames(court.teamNames || {}, court.playerNames || {});
      const teamsValue = item.querySelector(".teams-cell .aci-value");
      if (teamsValue)
      {
        teamsValue.textContent = `${resolvedTeamNames.A} vs ${resolvedTeamNames.B}`;
      }

      item.querySelector(".edit-btn").addEventListener("click", () =>
      {
        openEditModal(court);
      });

      elements.adminCourtList.appendChild(item);
    });
  }

  let courtToEdit = null;
  let currentDeviceToEdit = null;

  function openEditModal(court, syncHistory = true)
  {
    courtToEdit = court;
    const scoringOptions = normalizeScoringOptions({
      ...(court.scoringOptions || {}),
      scoringMode: court.scoringMode || court.scoringOptions?.scoringMode
    });

    elements.editCourtNameTitle.innerHTML = `${court.name}<br/>ID: ${court.id}`;
    elements.editCourtName.value = court.name || "";
    const rawTeamNames = normalizeTeamNames(court.teamNames || {});
    const playerNames = normalizePlayerNames(court.playerNames || {});
    elements.editTeamAName.value = rawTeamNames.A || "";
    elements.editTeamBName.value = rawTeamNames.B || "";
    elements.editPlayerA1Name.value = playerNames.A1;
    elements.editPlayerA2Name.value = playerNames.A2;
    elements.editPlayerB1Name.value = playerNames.B1;
    elements.editPlayerB2Name.value = playerNames.B2;
    elements.editCourtPassword.value = court.password || "";
    elements.editCourtStatus.value = court.status || STATUS.CLOSED;
    elements.editCourtScoringMode.value = scoringOptions.scoringMode;

    elements.adminDashboardPage.style.display = "none";
    elements.editCourtPage.style.display = "flex";

    if (syncHistory)
    {
      syncCurrentViewState();
    }
  }

  elements.saveEditBtn.addEventListener("click", async () =>
  {
    if (!courtToEdit) return;

    showSpinner(elements.editCourtPage);

    try
    {
      const courtId = courtToEdit.id;
      const newName = elements.editCourtName.value.trim();

      if (!newName) throw new Error("Court name cannot be empty");

      const scoringOptions = normalizeScoringOptions({
        ...(courtToEdit.scoringOptions || {}),
        scoringMode: elements.editCourtScoringMode.value
      });
      const playerNames = normalizePlayerNames({
        A1: elements.editPlayerA1Name.value.trim(),
        A2: elements.editPlayerA2Name.value.trim(),
        B1: elements.editPlayerB1Name.value.trim(),
        B2: elements.editPlayerB2Name.value.trim()
      });
      const manualTeamNames = {
        A: elements.editTeamAName.value.trim(),
        B: elements.editTeamBName.value.trim()
      };
      const normalizedTeamNames = normalizeTeamNames(manualTeamNames);
      const resolvedTeamNames = resolvePersistedTeamNames(normalizedTeamNames, playerNames);
      const courtRef = doc(db, "courts", courtId);

      await updateDoc(courtRef, {
        name: newName,
        teamNames: resolvedTeamNames,
        playerNames,
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
      currentScoringOptions = serverOptions;
      syncScoringControls();
      updateUI();

      showToast("Court updated successfully!", TOAST_TYPES.SUCCESS);
      elements.editCourtPage.style.display = "none";
      elements.adminDashboardPage.style.display = "flex";
      displayAdminCourtList();
      syncCurrentViewState("replace");
    }
    catch (err)
    {
      showToast("Failed to update: " + err.message, TOAST_TYPES.ERROR);
    }
    finally
    {
      hideSpinner(elements.editCourtPage);
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
      syncCurrentViewState("replace");
    }
    catch (err)
    {
      showToast("Delete failed: " + err.message, TOAST_TYPES.ERROR);
    }
  });

  elements.closeEditBtn.addEventListener("click", () =>
  {
    void stepBackInApp(createViewState({ page: isAdmin ? NAV_PAGES.ADMIN_DASHBOARD : NAV_PAGES.MENU }));
  });

  elements.adminLoginBtn.addEventListener("click", () =>
  {
    elements.menuPage.style.display = "none";
    elements.adminAuthPage.style.display = "flex";
    elements.adminAuthPassword.value = "";
    elements.adminAuthError.textContent = "";
    elements.adminAuthPassword.focus();
    syncCurrentViewState();
  });

  elements.closeAdminAuthBtn.addEventListener("click", () =>
  {
    void stepBackInApp(createViewState({ page: NAV_PAGES.MENU }));
  });

  elements.submitAdminAuthBtn.addEventListener("click", async () =>
  {
    const pass = elements.adminAuthPassword.value.trim();
    if (!pass)
    {
      elements.adminAuthError.textContent = "Admin password cannot be empty.";
      return;
    }

    showSpinner(elements.adminAuthPage);

    const skeleton = await getSkeleton();

    if (pass === skeleton)
    {
      isAdmin = true;
      elements.adminAuthPage.style.display = "none";
      elements.adminDashboardPage.style.display = "flex";
      displayAdminCourtList();
      syncCurrentViewState("replace");
    }
    else
    {
      elements.adminAuthError.textContent = "Incorrect admin password.";
      elements.adminAuthPassword.value = "";
      elements.adminAuthPassword.focus();
    }

    hideSpinner(elements.adminAuthPage);
  });

  elements.closeAdminDashboardBtn.addEventListener("click", () =>
  {
    isAdmin = false;
    void stepBackInApp(createViewState({ page: NAV_PAGES.MENU }));
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
    syncCurrentViewState();
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
        elements.playCourtNameError.style.display = "none";
        elements.playCourtNameError.textContent = "";
        elements.playCourtPasswordError.textContent = "";

        await loadCourtsWithInlineLoader(elements.playCourtList, true);
        displayPlayCourtList(allCourts);
        elements.playCourtSearch.focus();
        syncCurrentViewState();
        return;
      }
      else if (action === "Spectate")
      {
        elements.menuPage.style.display = "none";
        elements.spectatePage.style.display = "flex";
        elements.spectateCourtSearch.value = "";
        elements.spectateCourtNameError.style.display = "none";
        elements.spectateCourtNameError.textContent = "";

        await loadCourtsWithInlineLoader(elements.spectateCourtList, false);
        displaySpectateCourtList(allCourts);
        elements.spectateCourtSearch.focus();
        syncCurrentViewState();
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
    void stepBackInApp(createViewState({ page: isAdmin ? NAV_PAGES.ADMIN_DASHBOARD : NAV_PAGES.MENU }));
  });

  elements.closePlayBtn.addEventListener("click", () =>
  {
    void closePlayPage();
  });

  elements.closeSpectateBtn.addEventListener("click", () =>
  {
    void stepBackInApp(createViewState({ page: NAV_PAGES.MENU }));
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

  // Fix for mobile soft keyboard not re-opening when tapping an input box that remained activeElement
  let lastInputTapTime = 0;
  let lastInputTapTarget = null;

  function handleInputTap(e)
  {
    const target = e.target?.closest?.("input, textarea, [contenteditable='true']");
    if (!target) return;
    if (target.readOnly || target.disabled) return;

    const now = Date.now();
    if (lastInputTapTarget === target && (now - lastInputTapTime < 300))
    {
      return;
    }
    lastInputTapTime = now;
    lastInputTapTarget = target;

    if (document.activeElement === target)
    {
      target.blur();
      target.focus();
    }
  }

  document.addEventListener("pointerdown", handleInputTap, { capture: true });
  document.addEventListener("touchstart", handleInputTap, { capture: true, passive: true });

  document.addEventListener("pointerdown", (e) =>
  {
    const active = document.activeElement;
    if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable))
    {
      const isInteractive = e.target?.closest?.("input, textarea, [contenteditable='true'], label, button, .court-item, .admin-court-item, select, option, a");
      if (!isInteractive)
      {
        active.blur();
      }
    }
  }, { capture: true });

  document.addEventListener("click", (e) =>
  {
    if (!elements.appearanceMenu || elements.appearanceMenu.classList.contains("hidden")) return;
    if (elements.appearanceMenu.contains(e.target) || elements.appearanceMenuBtn?.contains(e.target)) return;
    if (document.querySelector("[data-team-colour].jscolor-active")) return;

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
      void closePlayPage();
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
      await loadCourtsWithInlineLoader(elements.playCourtList, true);
    }

    displayPlayCourtList(allCourts);

    const court = allCourts.find((item) => item.id === courtId);
    setPlayPageVisible(true);
    elements.playPasswordSection.style.display = "block";
    elements.playCourtSearch.value = court?.name || currentCourtName || courtId;
    elements.courtNameError.style.display = "none";
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
    syncCurrentViewState();
  }

  function openPlayerNamesModal()
  {
    const existingPlayers = normalizePlayerNames(currentPlayerNames);
    const existingTeams = normalizeTeamNames(currentRawTeamNames);

    elements.playerTeamAName.value = existingTeams.A;
    elements.playerTeamBName.value = existingTeams.B;
    elements.playerNameA1.value = existingPlayers.A1;
    elements.playerNameA2.value = existingPlayers.A2;
    elements.playerNameB1.value = existingPlayers.B1;
    elements.playerNameB2.value = existingPlayers.B2;
    elements.settingsModal.classList.add("hidden");
    elements.playerNamesModal.classList.remove("hidden");
    elements.playerTeamAName.focus();
    syncCurrentViewState();
  }

  function closePlayerNamesModal()
  {
    elements.playerNamesModal.classList.add("hidden");
    elements.settingsModal.classList.remove("hidden");
    syncCurrentViewState();
  }

  async function savePlayerNamesFromModal()
  {
    if (!currentCourtId)
    {
      showToast("No court is currently open.", TOAST_TYPES.ERROR);
      return;
    }

    const nextTeamNames = normalizeTeamNames({
      A: elements.playerTeamAName.value.trim(),
      B: elements.playerTeamBName.value.trim()
    });
    const nextPlayerNames = normalizePlayerNames({
      A1: elements.playerNameA1.value.trim(),
      A2: elements.playerNameA2.value.trim(),
      B1: elements.playerNameB1.value.trim(),
      B2: elements.playerNameB2.value.trim()
    });
    const derivedTeamNames = resolvePersistedTeamNames(nextTeamNames, nextPlayerNames);

    try
    {
      await updateDoc(doc(db, "courts", currentCourtId), {
        playerNames: nextPlayerNames,
        teamNames: derivedTeamNames
      });

      currentPlayerNames = normalizePlayerNames(nextPlayerNames);
      currentRawTeamNames = normalizeTeamNames(derivedTeamNames);
      applyTeamNamesToScoreboard(resolveTeamNames(currentRawTeamNames, currentPlayerNames));
      updateServerIndicator();
      elements.playerNamesModal.classList.add("hidden");
      elements.settingsModal.classList.remove("hidden");
      showToast("Player/Team names updated.", TOAST_TYPES.SUCCESS);
    }
    catch (error)
    {
      console.error("Error updating player names:", error);
      showToast("Failed to update player names.", TOAST_TYPES.ERROR);
    }
  }

  async function closePlayPage()
  {
    await stepBackInApp(createViewState({
      page: playPageReturnToScoreboard && currentCourtId ? NAV_PAGES.SCOREBOARD : NAV_PAGES.MENU,
      courtId: currentCourtId,
      spectate: isSpectating
    }));
  }

  elements.spectatePage.addEventListener("click", (e) =>
  {
    if (e.target === elements.spectatePage)
    {
      void stepBackInApp(createViewState({ page: NAV_PAGES.MENU }));
    }
  });

  elements.adminAuthPage.addEventListener("click", (e) =>
  {
    if (e.target === elements.adminAuthPage)
    {
      void stepBackInApp(createViewState({ page: NAV_PAGES.MENU }));
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

  function updatePageTitle(courtName = null, courtId = null)
  {
    if (!courtName || !courtId)
    {
      document.title = "Padel Push - Live Scoreboard";
      return;
    }

    document.title = `${courtName} (${courtId.toUpperCase()}) | Padel Push`;
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
      scoreVersion: 0,
      teamNames: { A: "Team A", B: "Team B" },
      playerNames: { ...DEFAULT_PLAYER_NAMES },
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
    syncCurrentViewState("replace");
  });

  elements.enterCourtBtn.addEventListener("click", async () =>
  {
    if (isJoiningCourt) return;
    isJoiningCourt = true;

    try
    {
      const courtId = selectedPlayCourt;
      const password = elements.playCourtPassword.value.trim();


      elements.playCourtNameError.style.display = "none";
      elements.playCourtNameError.textContent = "";
      elements.playCourtPasswordError.textContent = "";

      if (!courtId)
      {
        elements.playCourtNameError.style.display = "block";
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
        elements.playCourtNameError.style.display = "block";
        elements.playCourtNameError.textContent = "Court not found.";
        return;
      }

      var adminPassword = await getSkeleton();
      if (password === adminPassword)
      {
        await enterCourt(courtId, false, { historyMode: "replace" });
        return;
      }

      if (snap.data().password !== password)
      {
        elements.playCourtPasswordError.textContent = "Incorrect password.";
        return;
      }

      currentCourtPassword = password;
      await enterCourt(courtId, false, { historyMode: "replace" });
      playPageReturnToScoreboard = false;

      elements.playCourtPassword.value = "";
    }
    finally
    {
      isJoiningCourt = false;
    }
  });

  async function enterCourt(courtId, spectate, { historyMode = "push" } = {})
  {
    //console.log(`Entering court: ${courtId}, spectate: ${spectate}`);
    pendingLocalPasswordUpdate = null;
    bumpCourtHistorySessionId();
    invalidateMatchDetailsCache();

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
      errorEl.style.display = "block";
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
    currentScoreVersion = Number(data.scoreVersion) || 0;
    currentRawTeamNames = normalizeTeamNames(data.teamNames || {});
    currentPlayerNames = normalizePlayerNames(data.playerNames || {});
    currentScoringOptions = normalizeScoringOptions({
      ...(data.scoringOptions || {}),
      scoringMode: data.scoringMode || data.scoringOptions?.scoringMode
    });
    applyTeamNamesToScoreboard(resolveTeamNames(currentRawTeamNames, currentPlayerNames));
    updateServerIndicator();
    syncScoringControls();
    renderCourtQr(courtId);

    if (muted)
    {
      elements.muteBtn.textContent = "♫⃠";
    }

    if (isWavesEnabled == false)
    {
      elements.waveToggleScoreboardBtn.textContent = "═";
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

    beginScoreboardLoading();

    BlankOutScoreboard();

    if (spectate) enableSpectateMode();
    else disableSpectateMode();

    listenToCourt(courtId).catch((err) =>
    {
      console.error("Court listener setup failed:", err);
      scheduleCourtListenerReconnect(courtId, activeCourtListenerToken);
    });

    requestWakeLock();

    if (historyMode !== "skip")
    {
      syncCurrentViewState(historyMode);
    }

    updatePageTitle(currentCourtName, currentCourtId);
  }

  function leaveCourt(historyMode = "push")
  {
    //console.log("Leaving court: " + currentCourtId);
    activeCourtListenerToken++;
    cancelCourtListenerReconnect();
    pendingLocalPasswordUpdate = null;
    bumpCourtHistorySessionId();
    invalidateMatchDetailsCache();

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
    currentScoreVersion = 0;
    currentScoringOptions = { ...DEFAULT_SCORING_OPTIONS };
    syncScoringControls();
    clearCourtQr();
    finishScoreboardLoading();
    updatePageTitle();

    document.body.classList.remove("scoreboard-active");
    if (elements.appearanceMenuBtn) elements.appearanceMenuBtn.style.display = "";
    if (elements.adminLoginBtn) elements.adminLoginBtn.style.display = "";

    if (nfcDenied && elements.activateNfcBtn)
    {
      elements.activateNfcBtn.classList.remove("hidden");
    }

    elements.scoreboardPage.style.display = "none";
    elements.menuPage.style.display = "flex";

    if (historyMode !== "skip")
    {
      syncCurrentViewState(historyMode);
    }
  }

  function BlankOutScoreboard()
  {
    showCourtTitle("Padel Push - Live Scoreboard");
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

  function buildCourtQrUrl(courtId)
  {
    const baseUrl = window.location.origin.replace(/\/$/, "");

    if (!courtId)
    {
      return baseUrl;
    }

    return `${baseUrl}/c/${encodeURIComponent(courtId)}`;
  }

  function updateCourtQrPanelScale()
  {
    if (!elements.courtQrPanel)
    {
      return;
    }

    const panelWidth = Math.floor(elements.courtQrPanel.clientWidth);    
  }

  function clampCourtQrPanelToViewport()
  {
    if (!elements.courtQrPanel || !elements.scoreboardPage)
    {
      return;
    }

    const panel = elements.courtQrPanel;
    if (panel.classList.contains("hidden"))
    {
      return;
    }

    const parentRect = elements.scoreboardPage.getBoundingClientRect();
    const safeGap = 8;
    const minSize = 72;
    const panelAspectRatio = 1.24;

    const maxWidth = Math.max(minSize, parentRect.width - safeGap * 2);
    const maxHeight = Math.max(minSize, parentRect.height - safeGap * 2);

    const maxWidthByHeight = maxHeight / panelAspectRatio;
    const maxAllowedWidth = Math.max(24, Math.min(maxWidth, maxWidthByHeight));
    const minAllowedWidth = Math.min(minSize, maxAllowedWidth);

    const panelRectNow = panel.getBoundingClientRect();
    const nextWidth = Math.min(
      maxAllowedWidth,
      Math.max(minAllowedWidth, panelRectNow.width)
    );
    const nextHeight = nextWidth * panelAspectRatio;

    panel.style.width = `${nextWidth}px`;
    panel.style.height = `${nextHeight}px`;

    const panelRect = panel.getBoundingClientRect();
    const maxLeft = Math.max(safeGap, parentRect.width - panelRect.width - safeGap);
    const maxTop = Math.max(safeGap, parentRect.height - panelRect.height - safeGap);

    const currentLeft = Number.parseFloat(panel.style.left);
    const currentTop = Number.parseFloat(panel.style.top);

    const fallbackLeft = parentRect.width - panelRect.width - safeGap;
    const fallbackTop = parentRect.height - panelRect.height - safeGap;

    const nextLeft = Math.min(
      maxLeft,
      Math.max(safeGap, Number.isFinite(currentLeft) ? currentLeft : fallbackLeft)
    );
    const nextTop = Math.min(
      maxTop,
      Math.max(safeGap, Number.isFinite(currentTop) ? currentTop : fallbackTop)
    );

    panel.style.left = `${nextLeft}px`;
    panel.style.top = `${nextTop}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";

    updateCourtQrPanelScale();
  }

  function resetCourtQrPanelPosition()
  {
    if (!elements.courtQrPanel)
    {
      return;
    }

    elements.courtQrPanel.style.left = "";
    elements.courtQrPanel.style.top = "";
    elements.courtQrPanel.style.bottom = "";
    elements.courtQrPanel.style.right = "";
    elements.courtQrPanel.style.width = "";
    elements.courtQrPanel.style.height = "";
    updateCourtQrPanelScale();
  }

  function getCourtQrSize()
  {
    if (!elements.courtQrPanel)
    {
      return 100;
    }

    const panelWidth = Math.floor(elements.courtQrPanel.clientWidth);
    if (!panelWidth || panelWidth <= 0)
    {
      return 100;
    }

    return Math.max(72, panelWidth - 24);
  }

  function initializeCourtQrPanelInteractions()
  {
    if (hasInitializedQrPanelInteractions || !elements.courtQrPanel || !elements.scoreboardPage)
    {
      return;
    }

    const panel = elements.courtQrPanel;

    const stopDragging = () =>
    {
      isDraggingQrPanel = false;
      qrPointerId = null;
      panel.classList.remove("dragging");
    };

    panel.addEventListener("pointerdown", (event) =>
    {
      if (event.button !== 0)
      {
        return;
      }

      const panelRect = panel.getBoundingClientRect();
      const resizeHandleZone = 22;
      const isResizeAction = event.clientX >= panelRect.right - resizeHandleZone &&
        event.clientY >= panelRect.bottom - resizeHandleZone;

      if (isResizeAction)
      {
        return;
      }

      isDraggingQrPanel = true;
      qrPointerId = event.pointerId;
      qrDragOffsetX = event.clientX - panelRect.left;
      qrDragOffsetY = event.clientY - panelRect.top;

      panel.style.bottom = "auto";
      panel.style.right = "auto";
      panel.style.left = `${panelRect.left - elements.scoreboardPage.getBoundingClientRect().left}px`;
      panel.style.top = `${panelRect.top - elements.scoreboardPage.getBoundingClientRect().top}px`;
      panel.classList.add("dragging");

      panel.setPointerCapture(event.pointerId);
      event.preventDefault();
    });

    panel.addEventListener("pointermove", (event) =>
    {
      if (!isDraggingQrPanel || qrPointerId !== event.pointerId)
      {
        return;
      }

      const parentRect = elements.scoreboardPage.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();

      const maxLeft = Math.max(0, parentRect.width - panelRect.width);
      const maxTop = Math.max(0, parentRect.height - panelRect.height);

      const nextLeft = Math.min(
        maxLeft,
        Math.max(0, event.clientX - parentRect.left - qrDragOffsetX)
      );
      const nextTop = Math.min(
        maxTop,
        Math.max(0, event.clientY - parentRect.top - qrDragOffsetY)
      );

      panel.style.left = `${nextLeft}px`;
      panel.style.top = `${nextTop}px`;
    });

    panel.addEventListener("pointerup", stopDragging);
    panel.addEventListener("pointercancel", stopDragging);
    panel.addEventListener("lostpointercapture", stopDragging);

    if (window.ResizeObserver)
    {
      const observer = new ResizeObserver(() =>
      {
        clampCourtQrPanelToViewport();

        if (!currentCourtId || panel.classList.contains("hidden"))
        {
          return;
        }

        renderCourtQr(currentCourtId);
      });

      observer.observe(panel);
    }

    hasInitializedQrPanelInteractions = true;
  }

  function clearCourtQr()
  {
    if (!elements.courtQrPanel || !elements.courtQrCode || !elements.courtQrLabel)
    {
      return;
    }

    elements.courtQrCode.innerHTML = "";
    elements.courtQrLabel.textContent = "";
    elements.courtQrPanel.classList.add("hidden");
    resetCourtQrPanelPosition();
  }

  function renderCourtQr(courtId)
  {
    if (!elements.courtQrPanel || !elements.courtQrCode || !elements.courtQrLabel)
    {
      return;
    }

    if (!window.QRCode || !courtId)
    {
      clearCourtQr();
      return;
    }

    const qrUrl = buildCourtQrUrl(courtId);
    elements.courtQrPanel.classList.remove("hidden");
    clampCourtQrPanelToViewport();
    elements.courtQrCode.innerHTML = "";
    const qrSize = getCourtQrSize();

    new window.QRCode(elements.courtQrCode, {
      text: qrUrl,
      width: qrSize,
      height: qrSize,
      colorDark: "#000000",
      colorLight: "#ffffff",
      correctLevel: window.QRCode.CorrectLevel.H
    });

    elements.courtQrLabel.textContent = courtId;
  }

  function enableSpectateMode()
  {
    isSpectating = true;

    document.body.classList.add("spectating-mode");

    $("addPointA").style.pointerEvents = "none";
    $("addPointB").style.pointerEvents = "none";

    elements.undoBtn.style.display = "none";
    if (elements.sep1) elements.sep1.style.display = "none";
    if (elements.sep2) elements.sep2.style.display = "none";
    if (elements.sep3) elements.sep3.style.display = "none";

    // Hide player-only tiles in the settings modal
    if (elements.editPlayersTile) elements.editPlayersTile.style.display = "none";
    if (elements.resetSettingsTile) elements.resetSettingsTile.style.display = "none";
    if (elements.switchToSpectateTile) elements.switchToSpectateTile.style.display = "none";

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
    if (elements.sep1) elements.sep1.style.display = "";
    if (elements.sep2) elements.sep2.style.display = "";
    if (elements.sep3) elements.sep3.style.display = "";

    // Restore player-only tiles in the settings modal
    if (elements.editPlayersTile) elements.editPlayersTile.style.display = "";
    if (elements.resetSettingsTile) elements.resetSettingsTile.style.display = "";
    if (elements.switchToSpectateTile) elements.switchToSpectateTile.style.display = "";

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
      currentScoringOptions = serverOptions;

      // Apply the freshly replayed score returned by the Cloud Function
      // directly, instead of relying on the local `score` variable. The local
      // copy is only updated by the onSnapshot pipeline, so rendering it here
      // races the WebSocket delivery and can show a stale score.
      const serverScore = result?.data?.score;
      if (serverScore && serverScore.A && serverScore.B)
      {
        score = serverScore;
        invalidateMatchDetailsCache();
      }

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
    // Fire-and-forget animation/sound immediately so the UI stays snappy even
    // while the write is in flight; only surface an error if it actually fails.
    animate(addpointevent === EVENT_TYPES.POINT_TEAM_A ? "A" : "B");
    playSound(SOUND_IDS.POINT);

    try
    {
      await addDoc(
        collection(db, "courts", currentCourtId, "events"),
        {
          eventType: addpointevent,
          createdAt: serverTimestamp(),
          createdBy: thisDeviceId,
          scoreVersion: Number(currentScoreVersion) || 0
        }
      );
    }
    catch (err)
    {
      console.error("Add point failed:", err);
      showToast("Point failed to save: " + (err.message || "Unknown error"), TOAST_TYPES.ERROR);
    }
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
          createdBy: thisDeviceId,
          scoreVersion: Number(currentScoreVersion) || 0
        }
      );

      if (score.lastPointTeam)
      {
        animateUndo(score.lastPointTeam);
      }

      playSound(SOUND_IDS.UNDO);
    }
    catch (err)
    {
      console.error("Undo failed:", err);
      showToast("Undo failed to save: " + (err.message || "Unknown error"), TOAST_TYPES.ERROR);
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

    // Use ONLY score document's scoring options (not overridden by court settings)
    // This ensures critical points match what was calculated by the backend scoring engine
    const options = normalizeScoringOptions(currentScore?.scoringOptions || {});

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

    const teamAColour = getComputedStyle(document.body).getPropertyValue("--teamAcolour").trim();
    const teamBColour = getComputedStyle(document.body).getPropertyValue("--teamBcolour").trim();
    //elements.serverBadgeA.style.color = teamAColour;
    //elements.serverBadgeB.style.color = teamBColour;

    const label = getCurrentServerLabel(score);
    const teamAServing = isServerBadgeVisible && label?.startsWith("A");
    const teamBServing = isServerBadgeVisible && label?.startsWith("B");

    elements.serverBadgeA.classList.toggle("hidden", !teamAServing);
    elements.serverBadgeB.classList.toggle("hidden", !teamBServing);

    const displayLabel = getServerDisplayLabel(label);

    if (teamAServing)
    {
      elements.serverBadgeA.textContent = `${displayLabel}`;
    }
    if (teamBServing)
    {
      elements.serverBadgeB.textContent = `${displayLabel}`;
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

  function showSpinner(containerEl, message = "")
  {
    if (!containerEl) return;

    let overlay = containerEl.querySelector(":scope > .inline-loading-overlay");

    if (!overlay)
    {
      overlay = document.createElement("div");
      overlay.className = "inline-loading-overlay";
      overlay.innerHTML = `
        <div class="loading-content">
          <div class="spinner-wrapper">
            <div class="spinner"></div>
          </div>
          <div class="loading">${message}</div>
        </div>
      `;

      overlay.style.position = "absolute";
      overlay.style.inset = "0";
      overlay.style.zIndex = "1000";
      overlay.style.display = "flex";
      overlay.style.alignItems = "center";
      overlay.style.justifyContent = "center";
      overlay.style.background = isLightMode ? "rgba(255, 255, 255, 0.8)" : "rgba(0, 0, 0, 0.55)";
      overlay.style.backdropFilter = "blur(6px)";
      overlay.style.webkitBackdropFilter = "blur(6px)";

      const computedPosition = window.getComputedStyle(containerEl).position;
      if (computedPosition === "static")
      {
        containerEl.dataset.spinnerOriginalPosition = "static";
        containerEl.style.position = "relative";
      }

      containerEl.appendChild(overlay);
    }

    if (!overlay) return;

    //Make sure we do this for existing overlay as well, in case the theme changed
    overlay.style.background = isLightMode ? "rgba(255, 255, 255, 0.8)" : "rgba(0, 0, 0, 0.55)";

    overlay.style.display = "flex";
  }

  function hideSpinner(containerEl)
  {
    if (!containerEl) return;

    const overlay = containerEl.querySelector(":scope > .inline-loading-overlay");
    if (overlay)
    {
      overlay.style.display = "none";
    }
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

  function validateResetPassword()
  {
    const newPassword = elements.resetCourtPassword.value.trim();
    elements.resetPasswordError.textContent = "";

    if (newPassword.length < 4)
    {
      elements.resetPasswordError.textContent = "Password must be at least 4 characters.";
      return null;
    }
    else if (newPassword === currentCourtId)
    {
      elements.resetPasswordError.textContent = "Password must be different from court name.";
      return null;
    }

    return newPassword;
  }

  async function performShallowReset(requirePassword = false)
  {
    if (!currentCourtId) return;
    const newPassword = requirePassword ? validateResetPassword() : null;
    if (requirePassword && !newPassword) return;

    try
    {
      if (newPassword)
      {
        pendingLocalPasswordUpdate = newPassword;
      }

      const result = await resetCourt(currentCourtId, false, newPassword, requirePassword);
      if (newPassword)
      {
        currentCourtPassword = newPassword;
      }
      if (Number.isInteger(result?.data?.scoreVersion))
      {
        currentScoreVersion = result.data.scoreVersion;
      }

      elements.resetCourtPassword.value = "";
      elements.resetModal.classList.add("hidden");
      syncCurrentViewState("replace");
      playSound(SOUND_IDS.START);
      showToast("Score reset. Team and player names kept.", TOAST_TYPES.SUCCESS);
    }
    catch (err)
    {
      pendingLocalPasswordUpdate = null;
      console.error("Reset failed:", err);
      showToast("Reset Failed: " + (err.message || "Unknown error"), TOAST_TYPES.ERROR);
    }
  }

  elements.shallowResetBtn.addEventListener("click", async () =>
  {
    showSpinner(elements.resetModal);
    await performShallowReset(true);
    hideSpinner(elements.resetModal);
  });

  elements.confirmResetBtn.addEventListener("click", async () =>
  {
    if (!currentCourtId) return;
    const newPassword = validateResetPassword();
    if (!newPassword) return;

    try
    {
      showSpinner(elements.resetModal);
      
      pendingLocalPasswordUpdate = newPassword;
      const result = await resetCourt(currentCourtId, true, newPassword, true);
      currentCourtPassword = newPassword;
      if (Number.isInteger(result?.data?.scoreVersion))
      {
        currentScoreVersion = result.data.scoreVersion;
      }

      elements.resetCourtPassword.value = "";
      elements.resetModal.classList.add("hidden");
      syncCurrentViewState("replace");
      playSound(SOUND_IDS.START);
      showToast("Full reset complete. Team and player names restored.", TOAST_TYPES.SUCCESS);
    }
    catch (err)
    {
      pendingLocalPasswordUpdate = null;
      console.error("Reset failed:", err);
      showToast("Reset Failed: " + (err.message || "Unknown error"), TOAST_TYPES.ERROR);
    }
    finally
    {
      hideSpinner(elements.resetModal);
    }
  });


  function openResetModal()
  {
    playSound(SOUND_IDS.WARNING);
    elements.resetCourtPassword.value = "";
    elements.resetPasswordError.textContent = "";
    elements.resetModal.classList.remove("hidden");
    elements.resetCourtPassword.focus();
    syncCurrentViewState();
  }

  elements.cancelResetBtn.addEventListener("click", () =>
  {
    void stepBackInApp(createViewState({
      page: NAV_PAGES.SCOREBOARD,
      courtId: currentCourtId,
      spectate: isSpectating
    }));
  });

  elements.resetModal.addEventListener("click", (e) =>
  {
    if (e.target === elements.resetModal)
      void stepBackInApp(createViewState({
        page: NAV_PAGES.SCOREBOARD,
        courtId: currentCourtId,
        spectate: isSpectating
      }));
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

    elements.swapBtn.textContent = document.querySelector(".scoreboard").classList.contains("swapped") ? "⇄" : "⇆";

    // Keep the details modal synchronized with the currently visible side orientation.
    if (!elements.detailsModal.classList.contains("hidden"))
    {
      showMatchDetails(false);
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
      await stepBackInApp(createViewState({ page: NAV_PAGES.MENU }));
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

  // OBS overlay tile in settings modal
  if (elements.obsOverlayBtn)
  {
    elements.obsOverlayBtn.addEventListener("click", async () =>
    {
      if (!currentCourtId)
      {
        showToast("No court is currently open.", TOAST_TYPES.ERROR);
        return;
      }

      const baseUrl = window.location.origin.replace(/\/$/, "");
      const overlayUrl = `${baseUrl}/b/${encodeURIComponent(currentCourtId)}`;

      let copied = false;
      if (navigator.clipboard?.writeText)
      {
        try
        {
          await navigator.clipboard.writeText(overlayUrl);
          copied = true;
        }
        catch (error)
        {
          console.warn("Overlay URL clipboard copy failed:", error);
        }
      }

      window.open(overlayUrl, "_blank", "noopener");
      showToast(copied ? "Overlay opened. URL copied to clipboard." : "Overlay opened.", TOAST_TYPES.SUCCESS);
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

      elements.settingsModal.classList.add("hidden");
      openPlayerJoinPrompt(currentCourtId);
    });
  }

  if (elements.editPlayersBtn)
  {
    elements.editPlayersBtn.addEventListener("click", () =>
    {
      if (!currentCourtId)
      {
        showToast("No court is currently open.", TOAST_TYPES.ERROR);
        return;
      }

      openPlayerNamesModal();
    });
  }

  if (elements.playerNamesForm)
  {
    elements.playerNamesForm.addEventListener("submit", (e) =>
    {
      e.preventDefault();
      void savePlayerNamesFromModal();
    });
  }

  if (elements.closePlayerNamesBtn)
  {
    elements.closePlayerNamesBtn.addEventListener("click", closePlayerNamesModal);
  }

  if (elements.cancelPlayerNamesBtn)
  {
    elements.cancelPlayerNamesBtn.addEventListener("click", closePlayerNamesModal);
  }

  if (elements.playerNamesModal)
  {
    elements.playerNamesModal.addEventListener("click", (e) =>
    {
      if (e.target === elements.playerNamesModal)
      {
        closePlayerNamesModal();
      }
    });
  }

  if (elements.switchToSpectateBtn)
  {
    elements.switchToSpectateBtn.addEventListener("click", () =>
    {
      if (!currentCourtId)
      {
        showToast("No court is currently open.", TOAST_TYPES.ERROR);
        return;
      }

      elements.settingsModal.classList.add("hidden");
      enterCourt(currentCourtId, true, { historyMode: "replace" });
      showToast("Switched to Spectator view.", TOAST_TYPES.INFO);
    });
  }

  // Server visibility toggle tile (player-only)
  if (elements.serverToggleBtn)
  {
    elements.serverToggleBtn.addEventListener("click", () =>
    {
      isServerBadgeVisible = !isServerBadgeVisible;
      elements.serverToggleBtn.textContent = isServerBadgeVisible ? "⚾︎" : "⭘";
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
    elements.muteBtn.textContent = muted ? "♫⃠" : "♫";
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
    syncCurrentViewState();
  });

  elements.closeSettingsBtn.addEventListener("click", () =>
  {
    void stepBackInApp(createViewState({
      page: NAV_PAGES.SCOREBOARD,
      courtId: currentCourtId,
      spectate: isSpectating
    }));
  });

  elements.settingsModal.addEventListener("click", (e) =>
  {
    if (e.target === elements.settingsModal)
      void stepBackInApp(createViewState({
        page: NAV_PAGES.SCOREBOARD,
        courtId: currentCourtId,
        spectate: isSpectating
      }));
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
  elements.detailsBtn.addEventListener("click", () =>
  {
    void showMatchDetails();
  });

  if (elements.shareDetailsBtn)
  {
    const detailsShareLabel = navigator.share ? "Share match details" : "Copy match details link";
    elements.shareDetailsBtn.setAttribute("aria-label", detailsShareLabel);
    elements.shareDetailsBtn.title = detailsShareLabel;
    elements.shareDetailsBtn.addEventListener("click", () =>
    {
      if (!currentCourtId)
      {
        showToast("No court is currently open.", TOAST_TYPES.ERROR);
        return;
      }

      void share("details");
    });
  }

  if (elements.shareCourtBtn)
  {
    const courtShareLabel = navigator.share ? "Share court" : "Copy court link";
    elements.shareCourtBtn.setAttribute("aria-label", courtShareLabel);
    elements.shareCourtBtn.title = courtShareLabel;
    elements.shareCourtBtn.addEventListener("click", () =>
    {
      if (!currentCourtId)
      {
        showToast("No court is currently open.", TOAST_TYPES.ERROR);
        return;
      }

      void share("scoreboard");
    });
  }

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
    void stepBackInApp(createViewState({
      page: NAV_PAGES.SCOREBOARD,
      courtId: currentCourtId,
      spectate: isSpectating
    }));
  });

  elements.detailsModal.addEventListener("click", (e) =>
  {
    if (e.target === elements.detailsModal)
      void stepBackInApp(createViewState({
        page: NAV_PAGES.SCOREBOARD,
        courtId: currentCourtId,
        spectate: isSpectating
      }));
  });

  let momentumPulseAnimationFrame = null;

  function renderMomentumGraph(pointHistory, colourA, colourB, setPointMarkers = [], momentumTimeline = null, gameMarkers = [])
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

    if (momentumPulseAnimationFrame)
    {
      cancelAnimationFrame(momentumPulseAnimationFrame);
      momentumPulseAnimationFrame = null;
    }

    // Defer drawing so the canvas has a settled layout width
    const drawGraphFrame = (timestamp) =>
    {
      const dpr = window.devicePixelRatio || 1;
      const cssW = canvas.offsetWidth || canvas.parentElement.offsetWidth || CANVAS_FALLBACK_WIDTH;
      const cssH = 120;
      canvas.width = cssW * dpr;
      canvas.height = cssH * dpr;
      canvas.style.height = cssH + "px";

      const ctx = canvas.getContext("2d");
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const W = cssW;
      const H = cssH;
      const padX = 8;
      const padY = 10;
      const midY = H / 2;
      const MOMENTUM_CLAMP_MIN = -100;
      const MOMENTUM_CLAMP_MAX = 100;
      
      //const axisColour = document.body.classList.contains("light-mode") ? "rgba(0,0,0,0.5)" : "rgba(255,255,255,0.5)";
      const axisColour = document.body.classList.contains("light-mode") ? "rgba(185,185,185,1)" : "rgba(125,125,125,1)";

      // Map index → x, value → y
      const toX = i => padX + (i / (values.length - 1)) * (W - padX * 2);
      const toY = v => midY - (v / maxVal) * (midY - padY);

      const hasLiveMomentum = Array.isArray(momentumTimeline) &&
        momentumTimeline.length > 0 &&
        momentumTimeline.length === pointHistory.length;
      const values = hasLiveMomentum
        ? [0, ...momentumTimeline.map((value) =>
        {
          const numeric = Number(value);
          const safeNumeric = Number.isFinite(numeric) ? numeric : 0;
          // Defensive clamp in case older clients/servers exchange out-of-range values.
          return Math.max(MOMENTUM_CLAMP_MIN, Math.min(MOMENTUM_CLAMP_MAX, safeNumeric));
        })]
        : (() =>
        {
          const cumulative = [0];
          for (const p of pointHistory)
            cumulative.push(cumulative[cumulative.length - 1] + (p === "A" ? 1 : -1));
          return cumulative;
        })();

      // --- Centre balanced line ---
      const drawCentreLine = false;
      if (drawCentreLine)
      {
        ctx.beginPath();
        ctx.moveTo(padX, midY);
        ctx.lineTo(W - padX, midY);
        ctx.strokeStyle = axisColour;
        ctx.lineWidth = 1;
        //ctx.setLineDash([4, 4]);
        ctx.stroke();
        //ctx.setLineDash([]);
      }

      // --- Set point markers ---
      const markerIndices = Array.isArray(setPointMarkers)
        ? [...new Set(setPointMarkers
          .filter((index) => Number.isInteger(index) && index > 0 && index < values.length))]
        : [];

      markerIndices.forEach((index) =>
      {
        const x = toX(index);
        ctx.beginPath();
        ctx.moveTo(x, padY - 4);
        ctx.lineTo(x, H - padY + 4);
        ctx.strokeStyle = axisColour;
        ctx.lineWidth = 1;
        ctx.stroke();
      });

      // --- Game point markers ---
      const completedGameMarkers = Array.isArray(gameMarkers)
        ? [...new Set(gameMarkers
          .filter((index) => Number.isInteger(index) && index > 0 && index < values.length))]
          .filter((index) => !markerIndices.includes(index))
        : [];

      completedGameMarkers.forEach((index) =>
      {
        const x = toX(index);
        const radius = 1;
        const shouldClipGameMarkers = false; // Set to false to show full circle for game markers;
        const momentum = values[index];

        ctx.save();

        if (shouldClipGameMarkers) 
        {
          if (momentum === 0) 
          {
            return;
          }

          ctx.beginPath();
          momentum > 0 ? 
          ctx.rect(x - radius - 1, midY, radius * 2 + 2, radius + 2) : 
          ctx.rect(x - radius - 1, midY - radius - 2, radius * 2 + 2, radius + 2);
          ctx.clip();
        }
        
        ctx.beginPath();
        ctx.arc(x, midY, radius, 0, Math.PI * 2);
        ctx.fillStyle = axisColour;
        ctx.strokeStyle = axisColour;
        ctx.lineWidth = 1;
        ctx.fill();
        ctx.stroke();

        ctx.restore();
      });

      // Smooth sharp directional changes so peaks/troughs render less jagged.
      const smoothedValues = values.map((v, i, arr) =>
      {
        if (i === 0 || i === arr.length - 1) return v;
        return (arr[i - 1] + arr[i] * 2 + arr[i + 1]) / 4;
      });

      const maxVal = hasLiveMomentum ? MOMENTUM_CLAMP_MAX : Math.max(...values.map(Math.abs), 1);

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

      ctx.lineWidth = 2; 

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, W, midY);
      ctx.clip();

      ctx.beginPath();
      traceQuadraticPath(ctx, points);
      ctx.strokeStyle = colourA;
      ctx.stroke();

      ctx.restore();

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, midY, W, H - midY);
      ctx.clip();

      ctx.beginPath();
      traceQuadraticPath(ctx, points);
      ctx.strokeStyle = colourB;
      ctx.stroke();

      ctx.restore();

      // --- End dot ---
      const finalMomentum = values[values.length - 1];
      const finalMomentumColour =
        finalMomentum > 0 ? colourA :
          finalMomentum < 0 ? colourB :
            "#ffffff"; 

      const lastX = points[points.length - 1].x;
      const lastY = points[points.length - 1].y;
      const pulseWave = (Math.sin((timestamp || performance.now()) / 320) + 1) / 2;
      const pulseRadius = 4.5 + pulseWave * 3.2;
      const pulseAlpha = 0.18 + pulseWave * 0.22;

      ctx.save();
      ctx.beginPath();
      ctx.arc(lastX, lastY, pulseRadius, 0, Math.PI * 2);
      ctx.strokeStyle = finalMomentumColour;
      ctx.lineWidth = 1.2;
      ctx.globalAlpha = pulseAlpha;
      ctx.stroke();
      ctx.restore();

      ctx.beginPath();
      ctx.arc(lastX, lastY, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = finalMomentumColour;
      ctx.fill();
      ctx.shadowBlur = 0;

      if (canvas.isConnected && !wrap.classList.contains("hidden"))
      {
        momentumPulseAnimationFrame = requestAnimationFrame(drawGraphFrame);
      }
    };

    momentumPulseAnimationFrame = requestAnimationFrame(drawGraphFrame);
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

  function renderAdvancedStats(advancedStats, teamNames, isSwapped = false, playerNames = DEFAULT_PLAYER_NAMES)
  {
    if (!elements.dmStatsWrap || !elements.dmStatsTeam)
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

    const resolvedScoringMode = normalizeScoringOptions({ scoringMode: advancedStats.scoringMode }).scoringMode;
    const isGamesAndSetsMode = resolvedScoringMode === "standard";
    const isGoldenMode = isGamesAndSetsMode && advancedStats.deuceMode === "golden";
    const isSilverMode = isGamesAndSetsMode && advancedStats.deuceMode === "silver";
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
    const silverPointsPlayed = Number(matchStats.silverPointsPlayed) || 0;

    function row(label, valPrimary, valSecondary, primaryLeader = false, secondaryLeader = false)
    {
      return `<tr class="dm-st-row">
        <td class="dm-st-label">${label}</td>
        <td class="dm-st-val dm-st-${primaryClassSuffix} ${primaryLeader ? "is-leader" : ""} ${secondaryLeader ? "is-loser" : ""}">${valPrimary}</td>
        <td class="dm-st-val dm-st-${secondaryClassSuffix} ${secondaryLeader ? "is-leader" : ""} ${primaryLeader ? "is-loser" : ""}">${valSecondary}</td>
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

    function barRow(label, pctPrimary, pctSecondary, lblPrimary, lblSecondary, primaryLeader = false, secondaryLeader = false)
    {
      const safePrimary = Math.max(0, Math.min(100, Number(pctPrimary) || 0));
      const safeSecondary = Math.max(0, Math.min(100, Number(pctSecondary) || 0));
      return `<tr class="dm-st-row dm-st-bar-row">
        <td class="dm-st-label">${label}</td>
        <td class="dm-st-bar-cell" colspan="2">
          <div class="dm-split-bar">
            <span class="dm-split-lbl-a ${primaryLeader ? "is-leader" : ""} ${secondaryLeader ? "is-loser" : ""}" style="color:${primaryColour};">${lblPrimary}</span>
            <div class="dm-split-track">
              <div class="dm-split-fill-a" style="width:${safePrimary}%; background:${primaryColour};"></div>
              <div class="dm-split-fill-b" style="flex:0 0 ${safeSecondary}%; background:${secondaryColour};"></div>
            </div>
            <span class="dm-split-lbl-b ${secondaryLeader ? "is-leader" : ""} ${primaryLeader ? "is-loser" : ""}" style="color:${secondaryColour};">${lblSecondary}</span>
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
    const primarySilverWon = Number(primaryTeamStats.silverPointsWon) || 0;
    const secondarySilverWon = Number(secondaryTeamStats.silverPointsWon) || 0;
    const primarySilverPctRaw = Number(primaryTeamStats.silverPointWinPct);
    const secondarySilverPctRaw = Number(secondaryTeamStats.silverPointWinPct);
    const primarySilverPct = Number.isFinite(primarySilverPctRaw)
      ? primarySilverPctRaw
      : (silverPointsPlayed > 0 ? (primarySilverWon / silverPointsPlayed) * 100 : 0);
    const secondarySilverPct = Number.isFinite(secondarySilverPctRaw)
      ? secondarySilverPctRaw
      : (silverPointsPlayed > 0 ? (secondarySilverWon / silverPointsPlayed) * 100 : 0);
    const deuceGamesLabel = isGoldenMode ? "Golden Pts" : "Games";

    const rows = [
      barRow(
        "Points Won",
        primaryTeamStats.pointWinPct,
        secondaryTeamStats.pointWinPct,
        `${primaryTeamStats.pointsWon}/${totalPoints} (${formatPct(primaryTeamStats.pointWinPct)})`,
        `${secondaryTeamStats.pointsWon}/${totalPoints} (${formatPct(secondaryTeamStats.pointWinPct)})`,
        (Number(primaryTeamStats.pointsWon) || 0) > (Number(secondaryTeamStats.pointsWon) || 0),
        (Number(secondaryTeamStats.pointsWon) || 0) > (Number(primaryTeamStats.pointsWon) || 0)
      ),
      row("Longest Streak", primaryTeamStats.longestScoringStreak, secondaryTeamStats.longestScoringStreak,
        (Number(primaryTeamStats.longestScoringStreak) || 0) > (Number(secondaryTeamStats.longestScoringStreak) || 0),
        (Number(secondaryTeamStats.longestScoringStreak) || 0) > (Number(primaryTeamStats.longestScoringStreak) || 0))
    ];

    if (isGamesAndSetsMode)
    {
      rows.push(
        row("Breaks Faced", primaryTeamStats.breakPointsFaced, secondaryTeamStats.breakPointsFaced,
          (Number(primaryTeamStats.breakPointsFaced) || 0) > (Number(secondaryTeamStats.breakPointsFaced) || 0),
          (Number(secondaryTeamStats.breakPointsFaced) || 0) > (Number(primaryTeamStats.breakPointsFaced) || 0)),
        row("Breaks Held", `${primaryTeamStats.breakPointsWon}/${primaryTeamStats.breakPointsFaced} (${formatPct(primaryTeamStats.breakPointWinPct)})`,
          `${secondaryTeamStats.breakPointsWon}/${secondaryTeamStats.breakPointsFaced} (${formatPct(secondaryTeamStats.breakPointWinPct)})`,
          (Number(primaryTeamStats.breakPointWinPct) || 0) > (Number(secondaryTeamStats.breakPointWinPct) || 0),
          (Number(secondaryTeamStats.breakPointWinPct) || 0) > (Number(primaryTeamStats.breakPointWinPct) || 0)),
        row("Break Chances", primaryTeamStats.breakPointConversionOpportunities, secondaryTeamStats.breakPointConversionOpportunities,
          (Number(primaryTeamStats.breakPointConversionOpportunities) || 0) > (Number(secondaryTeamStats.breakPointConversionOpportunities) || 0),
          (Number(secondaryTeamStats.breakPointConversionOpportunities) || 0) > (Number(primaryTeamStats.breakPointConversionOpportunities) || 0)),
        row("Breaks Won", `${primaryTeamStats.breakPointConversions}/${primaryTeamStats.breakPointConversionOpportunities} (${formatPct(primaryTeamStats.breakPointConversionPct)})`,
          `${secondaryTeamStats.breakPointConversions}/${secondaryTeamStats.breakPointConversionOpportunities} (${formatPct(secondaryTeamStats.breakPointConversionPct)})`,
          (Number(primaryTeamStats.breakPointConversionPct) || 0) > (Number(secondaryTeamStats.breakPointConversionPct) || 0),
          (Number(secondaryTeamStats.breakPointConversionPct) || 0) > (Number(primaryTeamStats.breakPointConversionPct) || 0)),
        row("Closing Pts Won",
          `${primaryTeamStats.gamePointConversions}/${primaryTeamStats.gamePointGames} (${formatPct(primaryTeamStats.closingEfficiencyPct)})`,
          `${secondaryTeamStats.gamePointConversions}/${secondaryTeamStats.gamePointGames} (${formatPct(secondaryTeamStats.closingEfficiencyPct)})`,
          (Number(primaryTeamStats.closingEfficiencyPct) || 0) > (Number(secondaryTeamStats.closingEfficiencyPct) || 0),
          (Number(secondaryTeamStats.closingEfficiencyPct) || 0) > (Number(primaryTeamStats.closingEfficiencyPct) || 0)),
        sectionRow("Deuce"),
        sharedRow(deuceGamesLabel, isGoldenMode ? goldenPointsPlayed : deuceGames),
        barRow(
          "Won",
          primaryDeucePct,
          secondaryDeucePct,
          `${primaryDeuceWon}/${deuceGames} (${formatPct(primaryDeucePct)})`,
          `${secondaryDeuceWon}/${deuceGames} (${formatPct(secondaryDeucePct)})`,
          primaryDeucePct > secondaryDeucePct,
          secondaryDeucePct > primaryDeucePct)
      );
    }

    if (isSilverMode)
    {
      rows.push(sharedRow("Silver Pts", silverPointsPlayed));
      rows.push(barRow(
        "Won",
        primarySilverPct,
        secondarySilverPct,
        `${primarySilverWon}/${silverPointsPlayed} (${formatPct(primarySilverPct)})`,
        `${secondarySilverWon}/${silverPointsPlayed} (${formatPct(secondarySilverPct)})`,
        primarySilverPct > secondarySilverPct,
        secondarySilverPct > primarySilverPct
      ));
    }

    const servePlayerStats = advancedStats?.servePlayerStats || {};
    rows.push(sectionRow("On Serve"));
    [1, 2].forEach(serverIndex =>
    {
      const primarySlot = `${primaryTeamKey}${serverIndex}`;
      const secondarySlot = `${secondaryTeamKey}${serverIndex}`;
      var primaryServerName = getPlayerDisplayName(primarySlot, playerNames);
      var secondaryServerName = getPlayerDisplayName(secondarySlot, playerNames);
      primaryServerName = primaryServerName + (primaryServerName == "" ? "" : " - ");
      secondaryServerName = secondaryServerName + (secondaryServerName == "" ? "" : " - ");

      const primaryServeStat = servePlayerStats[primarySlot] || { pointsWonOnServe: 0, pointsServed: 0, serveWinPct: 0 };
      const secondaryServeStat = servePlayerStats[secondarySlot] || { pointsWonOnServe: 0, pointsServed: 0, serveWinPct: 0 };

      rows.push(row(
        `Player ${serverIndex}`,
        `${primaryServerName}${primaryServeStat.pointsWonOnServe}/${primaryServeStat.pointsServed} (${formatPct(primaryServeStat.serveWinPct)})`,
        `${secondaryServerName}${secondaryServeStat.pointsWonOnServe}/${secondaryServeStat.pointsServed} (${formatPct(secondaryServeStat.serveWinPct)})`
      ));
    });

    elements.dmStatsTeam.innerHTML = `
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

    elements.dmStatsWrap.classList.remove("hidden");
    syncDetailsPanelAvailability();
  }

  async function showMatchDetails(syncHistory = true, expanded = false, refreshing = false)
  {
    elements.detailsModal.classList.remove("hidden");

    if (syncHistory)
    {
      syncCurrentViewState();
    }

    const dmOverall = document.querySelector(".dm-overall");
    const dmTableWrap = document.querySelector(".dm-table-wrap");
    const dmMidSection = document.querySelector(".dm-mid-section");

    const isSwapped = isScoreboardSwapped();

    if (!refreshing)
    {
      if (dmOverall)
      {
        dmOverall.classList.toggle("swapped", isSwapped);
        dmOverall.classList.add("hidden");
        dmTableWrap.classList.add("hidden");
      }
    }
    
    elements.matchDetailsCourtName.textContent = currentCourtName || currentCourtId || "Match Details";

    // Populate team names immediately
    const nameA = $("teamA").querySelector(".name-text").textContent;
    const nameB = $("teamB").querySelector(".name-text").textContent;
    const teamAColour = getComputedStyle(document.body).getPropertyValue("--teamAcolour").trim();
    const teamBColour = getComputedStyle(document.body).getPropertyValue("--teamBcolour").trim();
    elements.detailsTeamAName.textContent = isSwapped ? nameB : nameA;
    elements.detailsTeamBName.textContent = isSwapped ? nameA : nameB;
    elements.detailsTeamAName.style.color = isSwapped ? teamBColour : teamAColour;
    elements.detailsTeamBName.style.color = isSwapped ? teamAColour : teamBColour;
    elements.detailsSetsA.style.color = isSwapped ? teamBColour : teamAColour;
    elements.detailsSetsB.style.color = isSwapped ? teamAColour : teamBColour;

    const headRow = elements.dmHead.querySelector("tr");

    if (!refreshing) {
      elements.detailsLoading.classList.remove("hidden");
      elements.shareDetailsBtn.classList.add("hidden");

      // Clear table rows, columns, and momentum graph safely
      headRow.innerHTML = "";
      elements.dmBody.innerHTML = "";
      elements.dmMomentumWrap.classList.add("hidden");
      elements.dmStatsWrap.classList.add("hidden");
      elements.dmStatsTeam.innerHTML = "";
      if (elements.dmEmptyState)
      {
        elements.dmEmptyState.classList.add("hidden");
      }
      if (elements.dmErrorState)
      {
        elements.dmErrorState.classList.add("hidden");
      }
    }

    syncDetailsPanelAvailability();
    setDetailsPanelExpanded(expanded);

    try
    {
      let result = matchDetailsCache;
      
      const canUseDetailsCache =
        isMatchDetailsCacheValid &&
        matchDetailsCache &&
        matchDetailsCacheCourtId === currentCourtId;

      if (canUseDetailsCache == false)
      {
        let getDetailedScore = httpsCallable(functions, "getDetailedScore");
        result = await getDetailedScore({ courtId: currentCourtId });
        
        matchDetailsCache = result;
        isMatchDetailsCacheValid = true;
        matchDetailsCacheCourtId = currentCourtId;

        //AL.
        //TODO - test this. Make sure it runs in the background, not block the UI.  
        const dummyFile = new File(
          [],
          'share-image.png',
          { type: 'image/png' }
        );
        if (navigator.canShare && navigator.canShare({ files: [dummyFile] }))
        {
          cacheShareableScoreCard();
        }
        //
      }

      const { sets, currentGames, points, mode, scoringMode, matchComplete } = result.data;
      const resolvedMode = normalizeScoringOptions({ scoringMode: scoringMode || mode }).scoringMode;
      const isStraight = resolvedMode === "straight";
      const isTiebreakTen = resolvedMode === "tiebreakTen";
      const isGamesAndSetsMode = !isStraight && !isTiebreakTen;
      const hasCompletedSets = Array.isArray(sets) && sets.length > 0;
      const hasCurrentSetGames = (Number(currentGames?.A) || 0) > 0 || (Number(currentGames?.B) || 0) > 0;
      const hasAnyPoints = (Number(points?.A) || 0) > 0 || (Number(points?.B) || 0) > 0;
      const hasAnyMatchDetails = isGamesAndSetsMode
        ? (hasCompletedSets || hasCurrentSetGames)
        : (hasCompletedSets || hasCurrentSetGames || hasAnyPoints);

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

      if (dmOverall)
      {
        dmOverall.classList.remove("hidden");
      }

      if (isStraight || isTiebreakTen)
      {
        // 1) Hide the breakdown table completely since individual sets are not tracked
        if (dmTableWrap) dmTableWrap.classList.add("hidden");

        // 2) Populate the main sets labels with the cumulative match points
        elements.detailsSetsA.textContent = (points && points.A !== undefined) ? points.A : 0;
        elements.detailsSetsB.textContent = (points && points.B !== undefined) ? points.B : 0;

        const colourA = getComputedStyle(document.body).getPropertyValue("--teamAcolour").trim();
        const colourB = getComputedStyle(document.body).getPropertyValue("--teamBcolour").trim();
        renderMomentumGraph(
          result.data.pointHistory,
          colourA,
          colourB,
          result.data.setPointMarkers || [],
          result.data.momentumTimeline || null,
          result.data.advancedStats?.gameMarkers || []
        );
        const detailsPlayerNames = normalizePlayerNames(result?.data?.playerNames || currentPlayerNames || {});
        renderAdvancedStats(result.data.advancedStats, { A: nameA, B: nameB }, isSwapped, detailsPlayerNames);
        syncDetailsPanelAvailability();
        return;
      }

      // Normal Scoring Mode remains perfectly untouched
      if (dmTableWrap) dmTableWrap.classList.remove("hidden");

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

      headRow.innerHTML = "";
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

      elements.dmBody.innerHTML = "";
      isSwapped ? elements.dmBody.appendChild(mkRow("b", allSets)) : elements.dmBody.appendChild(mkRow("a", allSets));
      isSwapped ? elements.dmBody.appendChild(mkRow("a", allSets)) : elements.dmBody.appendChild(mkRow("b", allSets));

      const colourA = getComputedStyle(document.body).getPropertyValue("--teamAcolour").trim();
      const colourB = getComputedStyle(document.body).getPropertyValue("--teamBcolour").trim();
      renderMomentumGraph(
        result.data.pointHistory,
        colourA,
        colourB,
        result.data.setPointMarkers || [],
        result.data.momentumTimeline || null,
        result.data.advancedStats?.gameMarkers || []
      );
      const detailsPlayerNames = normalizePlayerNames(result?.data?.playerNames || currentPlayerNames || {});
      renderAdvancedStats(result.data.advancedStats, { A: nameA, B: nameB }, isSwapped, detailsPlayerNames);
      syncDetailsPanelAvailability();
    }
    catch (err)
    {
      elements.dmErrorState.classList.remove("hidden");
      console.error("Match details initialization error:", err);
    }
    finally
    {
      elements.detailsLoading.classList.add("hidden");
      elements.shareDetailsBtn.classList.remove("hidden");
    }
  }

  // =====================================================
  // TEAM NAME EDITING
  // =====================================================

  function applyTeamNamesToScoreboard(teamNames)
  {
    const nameA = $("teamA")?.querySelector(".name-text");
    const nameB = $("teamB")?.querySelector(".name-text");

    if (nameA)
    {
      nameA.textContent = teamNames.A || "Team A";
      fitTextToContainer(nameA);
    }

    if (nameB)
    {
      nameB.textContent = teamNames.B || "Team B";
      fitTextToContainer(nameB);
    }
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

  document.querySelectorAll(".team-name").forEach((nameEl) =>
  {
    const labelEl = nameEl.querySelector(".name-text");
    if (!labelEl) return;

    fitTextToContainer(labelEl);
  });

  window.addEventListener("resize", () =>
  {
    document.querySelectorAll(".team-name .name-text")
      .forEach(fitTextToContainer);
    updateMarqueeScrolling();
    clampCourtQrPanelToViewport();
    syncCourtListFadeState(elements.playCourtList);
    syncCourtListFadeState(elements.spectateCourtList);
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
  let courtListenerReconnectTimeoutId = null;
  const COURT_LISTENER_RECONNECT_DELAY_MS = 2000;

  function cancelCourtListenerReconnect()
  {
    if (courtListenerReconnectTimeoutId !== null)
    {
      window.clearTimeout(courtListenerReconnectTimeoutId);
      courtListenerReconnectTimeoutId = null;
    }
  }

  // Firestore listeners can terminate permanently (e.g. after the underlying
  // WebSocket is dropped while the app is backgrounded). Schedule a fresh
  // listenToCourt() so the scoreboard recovers instead of silently freezing.
  function scheduleCourtListenerReconnect(courtId, listenerToken)
  {
    if (listenerToken !== activeCourtListenerToken) return;
    if (currentCourtId !== courtId) return;
    if (courtListenerReconnectTimeoutId !== null) return;

    courtListenerReconnectTimeoutId = window.setTimeout(() =>
    {
      courtListenerReconnectTimeoutId = null;
      if (listenerToken !== activeCourtListenerToken) return;
      if (currentCourtId !== courtId) return;
      listenToCourt(courtId).catch((err) =>
      {
        console.error("Court listener reconnect failed:", err);
        scheduleCourtListenerReconnect(courtId, activeCourtListenerToken);
      });
    }, COURT_LISTENER_RECONNECT_DELAY_MS);
  }

  // Force-refresh the Firestore listeners when the app resumes so updates
  // missed while backgrounded (or lost to a stale WebSocket) are re-delivered.
  function refreshCourtListenersOnResume()
  {
    if (!currentCourtId) return;
    const courtId = currentCourtId;
    listenToCourt(courtId).catch((err) =>
    {
      console.error("Court listener refresh failed:", err);
      scheduleCourtListenerReconnect(courtId, activeCourtListenerToken);
    });
  }

  document.addEventListener("visibilitychange", () =>
  {
    if (document.visibilityState === "visible")
    {
      refreshCourtListenersOnResume();
    }
  });

  // iOS Safari back-forward cache restores the page without reloading it.
  window.addEventListener("pageshow", (event) =>
  {
    if (event.persisted)
    {
      refreshCourtListenersOnResume();
    }
  });

  async function listenToCourt(courtId)
  {
    //console.log(`Setting up real-time sync for court: ${courtId}`);
    if (unsubscribe) unsubscribe();
    cancelCourtListenerReconnect();
    const listenerToken = ++activeCourtListenerToken;

    const scoreRef = doc(db, "courts", courtId, "score", "current");
    const courtRef = doc(db, "courts", courtId);

    // Warm reads are best-effort only and must never block listener attachment.
    // If these reads stall during reconnect, score updates can appear frozen.
    Promise.allSettled([getDoc(scoreRef), getDoc(courtRef)]).then((results) =>
    {
      const failures = results.filter((result) => result.status === "rejected");
      if (failures.length > 0)
      {
        console.warn("Court warm reads failed, listeners remain active:", failures);
      }
    });

    if (listenerToken !== activeCourtListenerToken)
    {
      return;
    }

    // 🔥 Listen to score changes
    const unsubscribeScore = onSnapshot(scoreRef, (snap) =>
    {
      if (listenerToken !== activeCourtListenerToken) return;
      if (!snap.exists()) return;

      const newData = snap.data();

      // Establish baseline on first successful Firebase sync
      if (!sessionInitialized)
      {
        lastKnownSets = { A: newData.A.sets, B: newData.B.sets };
        sessionInitialized = true;

        finishScoreboardLoading();
        finishStartupLoading();
      }

      applyActiveScoreSnapshot(newData, listenerToken, activeCourtListenerToken, (nextScore) =>
      {
        score = nextScore;
        invalidateMatchDetailsCache();
        updateUI();

        if (!elements.detailsModal.classList.contains("hidden"))
        {
          showMatchDetails(false, elements.dmDetailsContent.hidden === false, true);
        }
      });
    },
    (error) =>
    {
      console.error("Score listener error:", error);
      scheduleCourtListenerReconnect(courtId, listenerToken);
    });

    // 🔥 Listen to court metadata changes (password + teamNames)
    const unsubscribeCourt = onSnapshot(courtRef, (snap) =>
    {
      if (listenerToken !== activeCourtListenerToken) return;
      if (!snap.exists())
      {
        // If we are already on a new court (redirected), ignore
        if (currentCourtId !== courtId) return;

        showToast("This court no longer exists.", TOAST_TYPES.ERROR);
        leaveCourt("replace");
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
        if (listenerToken === activeCourtListenerToken)
        {
          activeCourtListenerToken++;
        }
        // Enter new court
        enterCourt(data.redirect, wasSpectating, { historyMode: "replace" });
        return;
      }

      //Court made private
      if (data.status === STATUS.PRIVATE && currentCourtStatus !== STATUS.PRIVATE)
      {
        showToast("This court has been made private by admin.", TOAST_TYPES.INFO);
        leaveCourt("replace");
        return;
      }

      // 🚨 Court Closure detection
      if (data.status === STATUS.CLOSED && !isAdmin)
      {
        showToast("The court has been closed by admin.", TOAST_TYPES.ERROR);
        leaveCourt("replace");
        return;
      }

      // 🚨 Password change detection
      const expectedLocalPassword = pendingLocalPasswordUpdate;
      const isExpectedLocalPasswordChange = Boolean(
        expectedLocalPassword && data.password === expectedLocalPassword
      );

      if (
        currentCourtPassword !== data.password &&
        !isSpectating &&
        !isExpectedLocalPasswordChange
      )
      {
        showToast("Security notice: Court password changed. You are now a spectator.", TOAST_TYPES.ERROR);
        enableSpectateMode();
      }

      if (isExpectedLocalPasswordChange)
      {
        pendingLocalPasswordUpdate = null;
      }

      // Ensure local state tracks newest password
      currentCourtPassword = data.password;
      currentCourtStatus = data.status;
      currentScoreVersion = Number(data.scoreVersion) || 0;

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
      updatePageTitle(data.name || snap.id, snap.id);

      currentRawTeamNames = normalizeTeamNames(data.teamNames || {});
      currentPlayerNames = normalizePlayerNames(data.playerNames || {});
      const teamNames = resolveTeamNames(currentRawTeamNames, currentPlayerNames);
      applyTeamNamesToScoreboard(teamNames);
      updateServerIndicator();

      if (!elements.detailsModal.classList.contains("hidden"))
      {
        showMatchDetails(false, elements.dmDetailsContent.hidden === false, true);
      }
    },
    (error) =>
    {
      console.error("Court listener error:", error);
      scheduleCourtListenerReconnect(courtId, listenerToken);
    });

    // Combine both unsubscribes
    unsubscribe = () =>
    {
      if (listenerToken === activeCourtListenerToken)
      {
        activeCourtListenerToken++;
      }
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

  // Add keyboard support (Tab, arrow keys) to court dropdowns
  const addDropdownKeyboardSupport = (selectEl, manualEl, manualToggle, dropdownToggle) =>
  {
    if (!selectEl) return;

    selectEl.addEventListener("keydown", (e) =>
    {
      if (e.key === "Tab")
      {
        // Tab naturally moves focus, just let it happen
        return;
      }

      if (e.key === "ArrowUp" || e.key === "ArrowDown")
      {
        // Native select handles arrow keys for navigation
        return;
      }

      // Allow Enter to confirm selection
      if (e.key === "Enter")
      {
        e.preventDefault();
        return;
      }
    });
  };

  addDropdownKeyboardSupport(
    elements.newDeviceCourtIdSelect,
    elements.newDeviceCourtIdManual,
    elements.newDeviceManualToggle,
    elements.newDeviceDropdownToggle
  );

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

  addDropdownKeyboardSupport(
    elements.editDeviceCourtIdSelect,
    elements.editDeviceCourtIdManual,
    elements.editDeviceManualToggle,
    elements.editDeviceDropdownToggle
  );

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

    devices.sort((a, b) => a.id.localeCompare(b.id));

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
    syncCurrentViewState();
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
      syncCurrentViewState("replace");
    } catch (error)
    {
      showToast("Failed to add device", TOAST_TYPES.ERROR);
    }
  });

  // Edit/Delete Device Logic
  async function openEditDeviceModal(device, syncHistory = true)
  {
    currentDeviceToEdit = device;
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

    if (syncHistory)
    {
      syncCurrentViewState();
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
        syncCurrentViewState("replace");
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
        syncCurrentViewState("replace");
      } catch (e) { showToast("Delete failed", TOAST_TYPES.ERROR); }
    };
  }

  // Close buttons
  elements.closeAddDeviceBtn.onclick = () =>
  {
    void stepBackInApp(createViewState({ page: isAdmin ? NAV_PAGES.ADMIN_DASHBOARD : NAV_PAGES.MENU }));
  }

  elements.closeEditDeviceBtn.onclick = () =>
  {
    void stepBackInApp(createViewState({ page: isAdmin ? NAV_PAGES.ADMIN_DASHBOARD : NAV_PAGES.MENU }));
  }

  elements.closeEditBtn.onclick = () =>
  {
    void replaceNavigationState(createViewState({ page: isAdmin ? NAV_PAGES.ADMIN_DASHBOARD : NAV_PAGES.MENU }));
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
    //console.log("Wake lock acquired - device will stay awake.");

    // Re-acquire lock if user interacts with device
    wakeLock.addEventListener("release", () =>
    {
      //console.warn("Wake lock released.");
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
      //console.log("Wake lock released.");
    }
    catch (error)
    {
      console.error("Error releasing wake lock:", error);
    }
  }
}

const ADMIN_PORTAL_SELECTOR = "#adminAuthPage, #adminDashboardPage, #createPage, #editCourtPage, #addDevicePage, #editDevicePage";

function isAdminPortalTarget(target)
{
  return !!target?.closest?.(ADMIN_PORTAL_SELECTOR);
}

document.addEventListener("keydown", (e) =>
{
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a")
  {
    if (!isAdminPortalTarget(e.target) && e.target.tagName !== "INPUT" && e.target.tagName !== "TEXTAREA"){
      e.preventDefault();
    }      
  }
});

document.addEventListener("mouseup", (e) =>
{
  if (isAdminPortalTarget(e.target) || e.target?.tagName === "INPUT" || e.target?.tagName === "TEXTAREA") return;
  window.getSelection()?.removeAllRanges();
});

document.addEventListener("touchend", (e) =>
{
  if (isAdminPortalTarget(e.target) || e.target?.tagName === "INPUT" || e.target?.tagName === "TEXTAREA") return;
  window.getSelection()?.removeAllRanges();
});

// =====================================================
// MOBILE OBSCURED INPUT AUTO-SCROLL
// =====================================================

function isTextInputElement(el)
{
  if (!el || !(el instanceof HTMLElement)) return false;
  const tagName = el.tagName.toLowerCase();
  if (tagName === "textarea" || el.isContentEditable) return true;
  if (tagName === "input")
  {
    const type = (el.getAttribute("type") || "text").toLowerCase();
    const nonTextTypes = [
      "button", "checkbox", "color", "file", "hidden",
      "image", "radio", "range", "reset", "submit"
    ];
    return !nonTextTypes.includes(type);
  }
  return false;
}

function isInputObscured(el)
{
  if (!isTextInputElement(el)) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;

  const vv = window.visualViewport;
  const viewportHeight = vv ? vv.height : window.innerHeight;

  // Safety margins:
  // Top margin to clear fixed headers/bars (50px)
  // Bottom margin to clear virtual keyboard and footers (20px)
  const minTop = 50;
  const maxBottom = viewportHeight - 20;

  return rect.bottom > maxBottom || rect.top < minTop;
}

// Single in-flight scroll, re-armed via rAF instead of stacked timeouts, so the
// keyboard's continuous resize/scroll events nudge the input rather than
// re-triggering competing "smooth" animations (which caused visible snapping).
let obscuredScrollFrame = null;

function scrollInputIntoViewIfNeeded(el)
{
  if (!isTextInputElement(el)) return;
  if (obscuredScrollFrame !== null) return;

  obscuredScrollFrame = requestAnimationFrame(() =>
  {
    obscuredScrollFrame = null;
    if (document.activeElement !== el) return;
    if (!isInputObscured(el)) return;

    try
    {
      el.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "nearest"
      });
    }
    catch (e)
    {
      el.scrollIntoView(false);
    }
  });
}

document.addEventListener("focusin", (e) =>
{
  if (isTextInputElement(e.target))
  {
    scrollInputIntoViewIfNeeded(e.target);
  }
}, { capture: true, passive: true });

if (window.visualViewport)
{
  window.visualViewport.addEventListener("resize", () =>
  {
    if (document.activeElement && isTextInputElement(document.activeElement))
    {
      scrollInputIntoViewIfNeeded(document.activeElement);
    }
  }, { passive: true });

  window.visualViewport.addEventListener("scroll", () =>
  {
    if (document.activeElement && isTextInputElement(document.activeElement))
    {
      scrollInputIntoViewIfNeeded(document.activeElement);
    }
  }, { passive: true });
}

window.addEventListener("resize", () =>
{
  if (document.activeElement && isTextInputElement(document.activeElement))
  {
    scrollInputIntoViewIfNeeded(document.activeElement);
  }
}, { passive: true });

async function cacheShareableScoreCard()
{
  //AL.
  console.log("cacheShareableScoreCard() called");
  showToast("Generating shareable scoreboard image...", TOAST_TYPES.INFO, 3000);
  //

  const element = document.getElementById('dmBox');

  if (!element)
  {
    throw new Error('Share element not found');
  }

  const courtLabelElement = document.getElementById('courtQrLabel');
  const rawCourtId = typeof courtLabelElement?.textContent === 'string'
    ? courtLabelElement.textContent.trim()
    : '';
  const fallbackMatch = window.location.pathname.match(/^\/(?:app\/)?(?:court|c)\/([^/]+)\/?$/i);
  const fallbackCourtId = fallbackMatch ? decodeURIComponent(fallbackMatch[1]).trim() : '';
  const courtId = (rawCourtId || fallbackCourtId || '').toLowerCase();
  const courtIdDisplay = courtId ? courtId.toUpperCase() : 'UNKNOWN';
  const appOrigin = window.location.origin.replace(/\/$/, '');
  const qrUrl = courtId ? `${appOrigin}/c/${encodeURIComponent(courtId)}` : `${appOrigin}/app/`;

  const sourcePanel = element.querySelector('#dmDetailsPanel, .dm-details-panel');
  const sourcePanelHeight = Math.max(0, Math.round(sourcePanel?.getBoundingClientRect().height || 0));
  const footerHeight = Math.min(120, Math.max(60, sourcePanelHeight));

  const clone = element.cloneNode(true);
  clone.querySelectorAll('.dm-close, .dm-share-btn').forEach(node => node.remove());

  const footerPanel = clone.querySelector('#dmDetailsPanel, .dm-details-panel');
  if (footerPanel)
  {
    footerPanel.classList.remove('hidden');
    footerPanel.hidden = false;
    footerPanel.innerHTML = '';
    footerPanel.style.display = 'flex';
    footerPanel.style.alignItems = 'center';
    footerPanel.style.justifyContent = 'space-between';
    footerPanel.style.gap = '16px';
    footerPanel.style.padding = '12px 16px';
    footerPanel.style.minHeight = `${footerHeight}px`;
    footerPanel.style.boxSizing = 'border-box';

    const qrWrap = document.createElement('div');
    qrWrap.style.display = 'inline-flex';
    qrWrap.style.alignItems = 'center';
    qrWrap.style.justifyContent = 'center';
    qrWrap.style.padding = '8px';
    qrWrap.style.background = '#ffffff';
    qrWrap.style.borderRadius = '10px';
    qrWrap.style.flex = '0 0 auto';

    const qrMount = document.createElement('div');
    qrWrap.appendChild(qrMount);

    const footerText = document.createElement('div');
    footerText.style.display = 'flex';
    footerText.style.flexDirection = 'column';
    footerText.style.gap = '6px';
    footerText.style.flex = '1 1 auto';
    footerText.style.minWidth = '0';

    const footerTitle = document.createElement('div');
    footerTitle.textContent = 'Scan for match details';
    footerTitle.style.fontSize = '14px';
    footerTitle.style.fontWeight = '700';
    footerTitle.style.letterSpacing = '0.02em';

    const footerCourtId = document.createElement('div');
    footerCourtId.textContent = `Court ID: ${courtIdDisplay}`;
    footerCourtId.style.fontSize = '16px';
    footerCourtId.style.fontWeight = '800';
    footerCourtId.style.letterSpacing = '0.06em';

    const footerUrl = document.createElement('div');
    footerUrl.textContent = qrUrl;
    footerUrl.style.fontSize = '11px';
    footerUrl.style.opacity = '0.85';
    footerUrl.style.overflow = 'hidden';
    footerUrl.style.textOverflow = 'ellipsis';
    footerUrl.style.whiteSpace = 'nowrap';

    footerText.appendChild(footerTitle);
    footerText.appendChild(footerCourtId);
    footerText.appendChild(footerUrl);

    footerPanel.appendChild(qrWrap);
    footerPanel.appendChild(footerText);

    if (window.QRCode)
    {
      const qrSize = Math.max(84, Math.min(120, footerHeight - 24));
      new window.QRCode(qrMount, {
        text: qrUrl,
        width: qrSize,
        height: qrSize,
        colorDark: '#000000',
        colorLight: '#ffffff',
        correctLevel: window.QRCode.CorrectLevel.H
      });
    }
  }

  const inclusions = (node) =>
  {
    const excludedClasses = [
      'dm-close', 
      'dm-share-btn', 
      'dm-empty-state', 
      'dm-error-state', 
      'hidden', 
      'invisible', 
      'sr-only', 
      'no-print'
    ];
    
    if (node.nodeType === Node.ELEMENT_NODE)
    {
      const el = node;
      if (excludedClasses.some(cls => el.classList.contains(cls)))
      {
        return false;
      }
    }
    return true;
  }

  const staging = document.createElement('div');
  staging.style.position = 'fixed';
  staging.style.left = '-10000px';
  staging.style.top = '0';
  staging.style.pointerEvents = 'none';
  staging.style.zIndex = '-1';
  staging.appendChild(clone);
  document.body.appendChild(staging);

  await new Promise(resolve => requestAnimationFrame(() => resolve()));

  let blob = null;
  try
  {
    blob = await toBlob(clone, {
      pixelRatio: 2, // Higher quality
      backgroundColor: getComputedStyle(document.body).backgroundColor,
      filter: (node) => inclusions(node),
    });
  }
  finally
  {
    staging.remove();
  }

  if (!blob)
  {
    throw new Error('Failed to generate image');
  }

  const file = new File(
    [blob],
    'share-image.png',
    { type: 'image/png' }
  );

  //AL. 
  //TODO - this breaks. Fix it. 
  shareableScoreCardImage = file;
  //

  console.log("cacheShareableScoreCard() completed successfully");
  
  //AL.
  showToast("Shareable scoreboard image generated!", TOAST_TYPES.SUCCESS, 3000);
  //
}