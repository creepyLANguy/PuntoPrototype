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

  const POINTS = [0, 15, 30, 40];
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
    REGISTER: "REGISTER"
  };

  const SOUND_IDS = {
    POINT: "pointSound",
    UNDO: "undoSound",
    SWOOSH: "swooshSound",
    START: "startSound",
    WARNING: "warningSound",
    POP: "popSound",
    SNAP: "snapSound"
  };

  const STATUS = {
    OPEN: "open",
    CLOSED: "closed",
    PRIVATE: "private"
  };

  const TOAST_TYPES = {
    SUCCESS: "success",
    ERROR: "error",
    INFO: "info"
  };

  // =====================================================
  // ACTION MAP
  // =====================================================

  const actionMap = {
    [EVENT_TYPES.POINT_TEAM_A]: () => addPoint(EVENT_TYPES.POINT_TEAM_A),
    [EVENT_TYPES.POINT_TEAM_B]: () => addPoint(EVENT_TYPES.POINT_TEAM_B),
    [EVENT_TYPES.UNDO]: () => undoLastPoint(),
    [EVENT_TYPES.RESET]: () => performShallowReset(),
    [EVENT_TYPES.REGISTER]: () => registerDeviceToCurrentCourt()
  };

  // =====================================================
  // STATE
  // =====================================================

  const defaultScore = () => ({
    A: { points: 0, games: 0, sets: 0 },
    B: { points: 0, games: 0, sets: 0 },
    lastPointTeam: null,
    lastGameTeam: null,
    lastSetTeam: null
  });

  let score = defaultScore();

  let muted = false;

  let currentCourtId = null;
  let currentCourtPassword = null;
  let currentCourtStatus = null;

  let isSpectating = false;

  let isAdmin = false;

  let lastScannedDeviceId = null;

  let thisDeviceId = DetermineThisDeviceId();

  // =====================================================
  // NFC STATE
  // =====================================================

  let nfcReader = null;
  let nfcCooldown = false;
  let lastNfcScanTime = 0;

  // =====================================================
  // THEME STATE
  // =====================================================

  let isLightMode = localStorage.getItem("theme") === "light";
  let isWavesEnabled = localStorage.getItem("waves") !== "false";

  // =====================================================
  // THEME FUNCTIONS
  // =====================================================

  function initializeTheme()
  {
    if (isLightMode)
    {
      document.body.classList.add("light-mode");
      updateThemeButtonIcons();
    }
  }

  function toggleTheme()
  {
    isLightMode = !isLightMode;
    document.body.classList.toggle("light-mode");
    localStorage.setItem("theme", isLightMode ? "light" : "dark");
    updateThemeButtonIcons();
  }

  function updateThemeButtonIcons()
  {
    const themeBtn = $("themeToggleBtn");
    const scoreboardBtn = $("themeToggleScoreboardBtn");

    if (themeBtn) themeBtn.textContent = isLightMode ? "☀️" : "🌙";
    if (scoreboardBtn) scoreboardBtn.textContent = isLightMode ? "☀️" : "🌙";
  }

  // =====================================================
  // WAVE FUNCTIONS
  // =====================================================

  function initializeWaves()
  {
    updateWavesVisibility();
  }

  function toggleWaves()
  {
    isWavesEnabled = !isWavesEnabled;
    localStorage.setItem("waves", isWavesEnabled);

    updateWavesVisibility();

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
  // DOM REFERENCES
  // =====================================================

  const $ = (id) => document.getElementById(id);

  const elements = {
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

    cooldown: $("cooldown"),
    controls: $("controls"),
    resetModal: $("resetModal"),

    confirmResetBtn: $("confirmReset"),
    shallowResetBtn: $("shallowReset"),
    cancelResetBtn: $("cancelReset"),

    undoBtn: $("undoBtn"),
    backBtn: $("backBtn"),
    resetBtn: $("resetBtn"),
    swapBtn: $("swapBtn"),
    muteBtn: $("muteBtn"),

    themeToggleBtn: $("themeToggleBtn"),
    themeToggleScoreboardBtn: $("themeToggleScoreboardBtn"),
    waveToggleScoreboardBtn: $("waveToggleScoreboardBtn"),
    waveToggleSpectateBtn: $("waveToggleSpectateBtn"),

    settingsBtn: $("settingsBtn"),
    settingsModal: $("settingsModal"),
    closeSettingsBtn: $("closeSettingsBtn"),

    sep1: $("sep1"),
    sep2: $("sep2"),

    detailsBtn: $("detailsBtn"),
    detailsModal: $("detailsModal"),
    closeDetailsBtn: $("closeDetailsBtn"),
    detailsSetsA: $("detailsSetsA"),
    detailsSetsB: $("detailsSetsB"),
    mdColLabels: $("mdColLabels"),
    mdColTeamA: $("mdColTeamA"),
    mdColTeamB: $("mdColTeamB"),
    detailsLoading: $("detailsLoading"),

    confirmModal: $("confirmModal"),
    confirmMessage: $("confirmMessage"),
    confirmOkBtn: $("confirmOkBtn"),
    confirmCancelBtn: $("confirmCancelBtn")
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

  // EDIT COURT ELEMENTS
  elements.editCourtPage = $("editCourtPage");
  elements.editCourtNameTitle = $("editCourtNameTitle");
  elements.editCourtName = $("editCourtName");
  elements.editTeamAName = $("editTeamAName");
  elements.editTeamBName = $("editTeamBName");
  elements.editCourtPassword = $("editCourtPassword");
  elements.editCourtStatus = $("editCourtStatus");
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

  // =====================================================
  // ENTER KEY SUBMIT LISTENERS
  // =====================================================

  function submitOnEnter(inputEl, buttonEl)
  {
    inputEl.addEventListener("keydown", (e) =>
    {
      if (e.key === "Enter")
      {
        e.preventDefault();
        buttonEl.click();
      }
    });
  }

  // CREATE PAGE
  submitOnEnter(elements.courtName, elements.createCourtBtn);
  submitOnEnter(elements.courtPassword, elements.createCourtBtn);

  // ADMIN AUTH PAGE
  submitOnEnter(elements.adminAuthPassword, elements.submitAdminAuthBtn);

  // PLAY PAGE
  submitOnEnter(elements.playCourtPassword, elements.enterCourtBtn);

  // RESET MODAL
  submitOnEnter(elements.resetCourtPassword, elements.confirmResetBtn);

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
      elements.playPage.style.display = "none";
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
      disableSpectateMode();
      document.body.classList.remove("scoreboard-active");
      if (elements.themeToggleBtn)
      {
        elements.themeToggleBtn.style.display = "";
      }
      if (elements.adminLoginBtn)
      {
        elements.adminLoginBtn.style.display = "";
      }
      elements.scoreboardPage.style.display = "none";
      elements.menuPage.style.display = "flex";
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
          elements.resetBtn.click();
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
    elements.editCourtNameTitle.textContent = court.name || court.id;
    elements.editCourtName.value = court.name || "";
    elements.editTeamAName.value = court.teamNames?.A || "";
    elements.editTeamBName.value = court.teamNames?.B || "";
    elements.editCourtPassword.value = court.password || "";
    elements.editCourtStatus.value = court.status || STATUS.CLOSED;

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

      const courtRef = doc(db, "courts", courtId);

      await updateDoc(courtRef, {
        name: newName,
        teamNames: {
          A: elements.editTeamAName.value.trim(),
          B: elements.editTeamBName.value.trim()
        },
        password: elements.editCourtPassword.value.trim(),
        status: elements.editCourtStatus.value
      });

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
        elements.playPage.style.display = "flex";
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
    if (elements.adminLoginBtn)
    {
      const currentVal = elements.adminLoginBtn.style.display;
      const targetVal = isMenuVisible ? "flex" : "none";
      if (currentVal !== targetVal)
      {
        elements.adminLoginBtn.style.display = targetVal;
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
    elements.playPage.style.display = "none";
    elements.menuPage.style.display = "flex";
  });

  elements.closeSpectateBtn.addEventListener("click", () =>
  {
    elements.spectatePage.style.display = "none";
    elements.menuPage.style.display = "flex";
  });

  if (elements.themeToggleBtn)
  {
    elements.themeToggleBtn.addEventListener("click", toggleTheme);
  }

  if (elements.themeToggleScoreboardBtn)
  {
    elements.themeToggleScoreboardBtn.addEventListener("click", toggleTheme);
  }

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
      elements.playPage.style.display = "none";
      elements.menuPage.style.display = "flex";
    }
  });

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
    if (existing) existing.textContent = name;
  }

  elements.createCourtBtn.addEventListener("click", async () =>
  {
    const courtName = elements.courtName.value.trim();
    const courtPass = elements.courtPassword.value.trim();

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

    // Generate specific alphanumeric courtId: NameSlug + Random(1-COURTID_UPPER_LIMIT)
    const nameSlug = courtName.replace(/[^a-z0-9]/gi, '').toLowerCase();
    const randomNum = Math.floor(Math.random() * COURTID_UPPER_LIMIT) + 1;
    const courtId = nameSlug + randomNum;

    const courtRef = doc(db, "courts", courtId);

    // Create court metadata
    await setDoc(courtRef, {
      name: courtName,
      password: courtPass,
      createdAt: serverTimestamp(),
      teamNames: { A: "Team A", B: "Team B" },
      status: elements.courtStatus.value
    });

    // Create initial score document
    await setDoc(
      doc(db, "courts", courtId, "score", "current"),
      defaultScore()
    );

    showToast(`Court "${courtName}" created successfully.`, TOAST_TYPES.SUCCESS);

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
    currentCourtPassword = data.password;
    currentCourtStatus = data.status;

    if (muted)
    {
      elements.muteBtn.textContent = "🔇";
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
    elements.playPage.style.display = "none";
    elements.spectatePage.style.display = "none";

    // Hide top-right buttons in court view
    if (elements.themeToggleBtn)
    {
      elements.themeToggleBtn.style.display = "none";
    }
    if (elements.adminLoginBtn)
    {
      elements.adminLoginBtn.style.display = "none";
    }

    elements.scoreboardPage.style.display = "flex";
    document.body.classList.add("scoreboard-active");

    BlankOutScoreboard();

    if (spectate) enableSpectateMode();
    else disableSpectateMode();

    listenToCourt(courtId);

    requestWakeLock();

    await initNfc();
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
    updateUI();
  }

  function enableSpectateMode()
  {
    isSpectating = true;

    document.body.classList.add("spectating-mode");

    $("addPointA").style.pointerEvents = "none";
    $("addPointB").style.pointerEvents = "none";

    elements.undoBtn.style.display = "none";
    elements.resetBtn.style.display = "none";
    if (elements.muteBtn.parentElement) elements.muteBtn.parentElement.style.display = "none";
    if (elements.sep1) elements.sep1.style.display = "none";
    if (elements.sep2) elements.sep2.style.display = "none";

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
    elements.resetBtn.style.display = "";
    if (elements.muteBtn.parentElement) elements.muteBtn.parentElement.style.display = "";
    if (elements.sep1) elements.sep1.style.display = "";
    if (elements.sep2) elements.sep2.style.display = "";

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
      showToast("Cannot register device - no court selected.", TOAST_TYPES.ERROR);
      return;
    }

    if (!lastScannedDeviceId)
    {
      showToast("Cannot register device - no deviceId specified.", TOAST_TYPES.ERROR);
      return;
    }

    await updateDoc(doc(db, "devices", lastScannedDeviceId), {
      courtId: currentCourtId
    });

    showToast(`Device ${lastScannedDeviceId} registered to this court.`, TOAST_TYPES.SUCCESS);
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
      loadSound("snapSound", "media/sfx/snap.mp3")
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

  const pointLabel = (p) => p === 4 ? "Ad" : POINTS[p];

  function updateUI()
  {
    ["A", "B"].forEach(team =>
    {
      renderSets(team);
      renderGames(team);
      elements.points[team].textContent = pointLabel(score[team].points);

      document.querySelector(`#team${team} .indicator`).style.opacity =
        score.lastPointTeam === team ? 1 : 0;
    });
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

  async function initNfc()
  {
    if (isSpectating)
    {
      console.warn("NFC not initialized in Spectate mode.");
      return;
    }

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

      console.log("NFC scanning started.");

      nfcReader.onreading = (event) =>
      {
        if (!elements.scoreboardPage ||
          elements.scoreboardPage.style.display === "none")
        {
          return;
        }

        if (!canProcessNfc()) return;

        const decoder = new TextDecoder();

        for (const record of event.message.records)
        {
          if (record.recordType === "text")
          {
            const text = decoder.decode(record.data).trim();
            console.log("NFC scanned:", text);
            handleNfc(text);
          }
        }
      };

      nfcReader.onerror = () =>
      {
        showToast("NFC Disabled", "NFC is disabled on your device.\nEnable it in you device settings to use tag scanning.", TOAST_TYPES.ERROR);
      };

    }
    catch (error)
    {
      if (error.name === "NotAllowedError")
      {
        showToast("NFC permission denied.", TOAST_TYPES.ERROR);
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

  function handleNfc(text)
  {
    if (!text) return;

    const json = JSON.parse(text);

    if (json.deviceId)
    {
      lastScannedDeviceId = json.deviceId;
    }

    const eventType = json.eventType;

    if (!eventType)
    {
      showToast("NFC event type missing.", TOAST_TYPES.ERROR);
      console.warn("NFC eventType missing: ", text);
      return;
    }

    if (!actionMap[eventType])
    {
      showToast("NFC event type unknown.", TOAST_TYPES.ERROR);
      console.warn("NFC event type unknown: ", text);
      return;
    }

    actionMap[eventType]();
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
      disableSpectateMode();
      releaseWakeLock();

      document.body.classList.remove("scoreboard-active");
      // Show top-right theme toggle when leaving court view
      if (elements.themeToggleBtn)
      {
        elements.themeToggleBtn.style.display = "";
      }
      elements.scoreboardPage.style.display = "none";
      elements.menuPage.style.display = "flex";
    }
  });

  elements.resetBtn.addEventListener("click", openResetModal);

  elements.muteBtn.addEventListener("click", () =>
  {
    muted = !muted;
    elements.muteBtn.textContent = muted ? "🔇" : "🔊";

    if (!muted)
    {
      playSound(SOUND_IDS.SNAP);
    }
  });

  // Settings Modal logic
  elements.settingsBtn.addEventListener("click", () =>
  {
    elements.settingsModal.classList.remove("hidden");
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

  elements.closeDetailsBtn.addEventListener("click", () =>
  {
    elements.detailsModal.classList.add("hidden");
  });

  elements.detailsModal.addEventListener("click", (e) =>
  {
    if (e.target === elements.detailsModal)
      elements.detailsModal.classList.add("hidden");
  });

  async function showMatchDetails()
  {
    elements.detailsModal.classList.remove("hidden");
    elements.detailsLoading.classList.remove("hidden");

    // Clear dynamic columns
    elements.mdColLabels.innerHTML = "";
    elements.mdColTeamA.innerHTML = "";
    elements.mdColTeamB.innerHTML = "";

    const nameA = $("teamA").querySelector(".name-text").textContent;
    const nameB = $("teamB").querySelector(".name-text").textContent;

    try
    {
      const getDetailedScore = httpsCallable(functions, "getDetailedScore");
      const result = await getDetailedScore({ courtId: currentCourtId });
      const { sets, currentGames, points } = result.data;

      // 1. Overall set scores
      let totalSetsA = 0;
      let totalSetsB = 0;
      sets.forEach(s =>
      {
        if (s.A > s.B) totalSetsA++;
        else if (s.B > s.A) totalSetsB++;
      });
      elements.detailsSetsA.textContent = totalSetsA;
      elements.detailsSetsB.textContent = totalSetsB;

      // 2. Helper to add cells
      function addRow(label, valA, valB, isHeader = false, isPoints = false, isCurrent = false, winnerA = false, winnerB = false)
      {
        // Labels
        const lblDiv = document.createElement("div");
        lblDiv.className = isHeader ? "md-header md-cell md-team-name" : "md-header md-cell";
        lblDiv.textContent = label;
        elements.mdColLabels.appendChild(lblDiv);

        // Team A (Score)
        const aDiv = document.createElement("div");
        aDiv.className = isHeader ? "md-cell md-team-name team-a-cell" : `md-cell team-a-cell ${isCurrent ? 'current' : ''} ${isPoints ? 'md-points' : ''} ${winnerA ? 'won-set' : ''}`;
        aDiv.textContent = valA;
        elements.mdColTeamA.appendChild(aDiv);

        // Team B (Score)
        const bDiv = document.createElement("div");
        bDiv.className = isHeader ? "md-cell md-team-name team-b-cell" : `md-cell team-b-cell ${isCurrent ? 'current' : ''} ${isPoints ? 'md-points' : ''} ${winnerB ? 'won-set' : ''}`;
        bDiv.textContent = valB;
        elements.mdColTeamB.appendChild(bDiv);
      }

      // Add "TEAM" Header Row
      addRow("TEAM", nameA, nameB, true);

      // 3. Build Set Rows
      const allSetsData = [...sets, currentGames];
      allSetsData.forEach((setData, idx) =>
      {
        const isCurrent = idx === allSetsData.length - 1;
        const winnerA = !isCurrent && setData.A > setData.B;
        const winnerB = !isCurrent && setData.B > setData.A;

        addRow(`S${idx + 1}`, setData.A, setData.B, false, false, isCurrent, winnerA, winnerB);
      });

      // 4. Points Row
      const POINTS_LABELS = [0, 15, 30, 40, "Ad"];
      const pA = POINTS_LABELS[points.A] ?? points.A;
      const pB = POINTS_LABELS[points.B] ?? points.B;
      addRow("PTS", pA, pB, false, true, true);
    }
    catch (err)
    {
      console.error("Match details failed:", err);
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
  });


  // =====================================================
  // INIT
  // =====================================================

  updateUI();

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

      score = snap.data();
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
        // Return to menu
        disableSpectateMode();
        releaseWakeLock();
        document.body.classList.remove("scoreboard-active");
        if (elements.themeToggleBtn) elements.themeToggleBtn.style.display = "";
        elements.scoreboardPage.style.display = "none";
        elements.menuPage.style.display = "flex";
        if (unsubscribeScore) unsubscribeScore();
        if (unsubscribeCourt) unsubscribeCourt();
        unsubscribe = null;
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

        // Return to menu
        disableSpectateMode();
        releaseWakeLock();
        document.body.classList.remove("scoreboard-active");
        if (elements.themeToggleBtn) elements.themeToggleBtn.style.display = "";
        elements.scoreboardPage.style.display = "none";
        elements.menuPage.style.display = "flex";
        if (unsubscribeScore) unsubscribeScore();
        if (unsubscribeCourt) unsubscribeCourt();
        unsubscribe = null;
        return;
      }

      // 🚨 Court Closure detection
      if (data.status === STATUS.CLOSED && !isAdmin)
      {
        showToast("The court has been closed by admin.", TOAST_TYPES.ERROR);

        // Return to menu
        disableSpectateMode();
        releaseWakeLock();
        document.body.classList.remove("scoreboard-active");
        if (elements.themeToggleBtn) elements.themeToggleBtn.style.display = "";
        elements.scoreboardPage.style.display = "none";
        elements.menuPage.style.display = "flex";
        if (unsubscribeScore) unsubscribeScore();
        if (unsubscribeCourt) unsubscribeCourt();
        unsubscribe = null;
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