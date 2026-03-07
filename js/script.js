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
    const result = await resetFn({ courtId, deepReset, newPassword });
    showToast("Court reset successful", "success");
  }
  catch (err)
  {
    showToast("Reset failed: " + err.message, "error");
  }
}

function showToast(message, type = "success")
{
  const container = document.getElementById("toastContainer");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;

  container.appendChild(toast);

  setTimeout(() =>
  {
    toast.remove();
  }, 3000);
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

  const COURTID_UPPER_LIMIT = 999999999;

  const TEAM_A = "A";
  const TEAM_B = "B";

  const UNDO = "U";
  const REMOTE_RESET = "R";

  const SOUND_IDS = {
    POINT: "pointSound",
    UNDO: "undoSound",
    SWOOSH: "swooshSound",
    START: "startSound",
    WARNING: "warningSound"
  };

  const STATUS = {
    OPEN: "open",
    CLOSED: "closed"
  };

  // =====================================================
  // ACTION MAP
  // =====================================================

  const actionMap = {
    [TEAM_A]: () => addPoint(TEAM_A),
    [TEAM_B]: () => addPoint(TEAM_B),
    [UNDO]: () => undoLastPoint(),
    [REMOTE_RESET]: () => performShallowReset()
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

  let currentCourt = null;
  let currentCourtPassword = null;

  let isSpectating = false;

  let isAdmin = false;

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
    const scoreboardBtn = $("themeToggleScorebboardBtn");

    if (themeBtn) themeBtn.textContent = isLightMode ? "☀️" : "🌙";
    if (scoreboardBtn) scoreboardBtn.textContent = isLightMode ? "☀️" : "🌙";
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
    themeToggleScorebboardBtn: $("themeToggleScorebboardBtn"),

    sep1: $("sep1"),
    sep2: $("sep2")
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

  //RESET COURT ELEMENTS
  elements.resetCourtPassword = $("resetCourtPassword");
  elements.resetPasswordError = $("resetPasswordError");

  //NFC ELEMENTS
  elements.nfcCooldownBanner = $("nfcCooldownBanner");
  elements.nfcCountdown = $("nfcCountdown");

  // =====================================================
  // INITIALIZE THEME
  // =====================================================

  initializeTheme();

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

    if (isVisible(elements.createPage))
    {
      elements.createPage.style.display = "none";
      elements.menuPage.style.display = "flex";
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
      elements.adminDashboardPage.style.display = "none";
      elements.menuPage.style.display = "flex";
      return;
    }

    if (isVisible(elements.editCourtPage))
    {
      elements.editCourtPage.style.display = "none";
      elements.adminDashboardPage.style.display = "flex";
      displayAdminCourtList();
      return;
    }
  });

  // =====================================================
  // MENU TOGGLE
  // =====================================================

  async function getAdminPassword()
  {
    const adminref = doc(db, "admin", "goodies");
    const adminSnap = await getDoc(adminref);
    return adminSnap.data().skeletonKey;
  }

  // =====================================================
  // COURT LOADING & FILTERING
  // =====================================================

  async function loadAllOpenCourts()
  {
    try
    {
      const courtsCollection = collection(db, "courts");
      const snapshot = await getDocs(courtsCollection);
      allCourts = [];
      snapshot.forEach(doc =>
      {
        let data = doc.data();
        if (data.status === STATUS.OPEN)
        {
          allCourts.push({
            id: doc.id,
            name: data.name || doc.id,
            password: data.password,
            createdAt: data.createdAt
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
      elements.adminCourtList.innerHTML = "";

      const courtPromises = snapshot.docs.map(async (courtDoc) =>
      {
        const data = courtDoc.data();
        return {
          id: courtDoc.id,
          ...data
        };
      });

      const courts = await Promise.all(courtPromises);

      courts.sort((a, b) => a.id.localeCompare(b.id));

      if (courts.length === 0)
      {
        elements.adminCourtList.innerHTML = '<div class="no-courts">No courts found.</div>';
        return;
      }

      courts.forEach(court =>
      {
        const item = document.createElement("div");
        item.className = "admin-court-item";

        item.innerHTML = `
          <div>
            <div class="item-label">Court Name</div>
            <strong>${court.name || "N/A"}</strong>
            <div style="font-size: 0.9rem; color: #888;">ID: ${court.id}</div>
          </div>
          <div>
            <div class="item-label">Teams</div>
            ${court.teamNames?.A || "A"} vs ${court.teamNames?.B || "B"}
          </div>
          <div>
            <div class="item-label">Password</div>
            <code>${court.password}</code>
          </div>
          <div>
            <div class="item-label">Status</div>
            <span class="status-badge status-${court.status}">${court.status.toUpperCase()}</span>
          </div>
          <div>
            <button class="edit-btn" data-id="${court.id}">Edit</button>
          </div>
        `;

        item.querySelector(".edit-btn").addEventListener("click", () =>
        {
          openEditModal(court);
        });

        elements.adminCourtList.appendChild(item);
      });
    }
    catch (error)
    {
      console.error("Error loading admin courts:", error);
      elements.adminCourtList.innerHTML = '<div class="error">Error loading courts.</div>';
    }
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

      showToast("Court updated successfully!", "success");
      elements.editCourtPage.style.display = "none";
      elements.adminDashboardPage.style.display = "flex";
      displayAdminCourtList();
    }
    catch (err)
    {
      showToast("Failed to update: " + err.message, "error");
    }
  });

  elements.deleteCourtBtn.addEventListener("click", async () =>
  {
    if (!courtToEdit) return;
    if (!confirm(`Are you sure you want to delete court "${courtToEdit.id}"? This cannot be undone.`)) return;

    try
    {
      await deleteDoc(doc(db, "courts", courtToEdit.id));
      showToast("Court deleted.", "success");
      elements.editCourtPage.style.display = "none";
      elements.adminDashboardPage.style.display = "flex";
      displayAdminCourtList();
    }
    catch (err)
    {
      showToast("Delete failed: " + err.message, "error");
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
    const skeleton = await getAdminPassword();

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

        await loadAllOpenCourts();
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

        await loadAllOpenCourts();
        displaySpectateCourtList(allCourts);
        elements.spectateCourtSearch.focus();
        return;
      }
    });
  });

  function updateAdminButtonVisibility()
  {
    const isMenuVisible = window.getComputedStyle(elements.menuPage).display !== "none";
    if (elements.adminLoginBtn)
    {
      elements.adminLoginBtn.style.display = isMenuVisible ? "flex" : "none";
    }
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

  if (elements.themeToggleScorebboardBtn)
  {
    elements.themeToggleScorebboardBtn.addEventListener("click", toggleTheme);
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

  elements.createPage.addEventListener("click", (e) =>
  {
    if (e.target === elements.createPage)
    {
      elements.createPage.style.display = "none";
      elements.menuPage.style.display = "flex";
    }
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

    showToast(`Court "${courtName}" created successfully.`, "success");

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
    const name = selectedPlayCourt;
    const password = elements.playCourtPassword.value.trim();

    elements.playCourtNameError.textContent = "";
    elements.playCourtPasswordError.textContent = "";

    if (!name)
    {
      elements.playCourtNameError.textContent = "Court not selected.";
      return;
    }

    if (!password)
    {
      elements.playCourtPasswordError.textContent = "Password required.";
      return;
    }

    const courtRef = doc(db, "courts", name);
    const snap = await getDoc(courtRef);

    if (!snap.exists())
    {
      elements.playCourtNameError.textContent = "Court not found.";
      return;
    }

    var adminPassword = await getAdminPassword();
    if (password === adminPassword)
    {
      isAdmin = true;
      enterCourt(name, false);
      return;
    }

    if (snap.data().password !== password)
    {
      elements.playCourtPasswordError.textContent = "Incorrect password.";
      return;
    }

    currentCourtPassword = password;
    enterCourt(name, false);

    elements.playCourtPassword.value = "";
  });

  async function enterCourt(courtName, spectate)
  {
    console.log(`Entering court: ${courtName}, spectate: ${spectate}`);
    const courtRef = doc(db, "courts", courtName);
    const snap = await getDoc(courtRef);
    if (!snap.exists())
    {
      const errorEl = spectate ? elements.spectateCourtNameError : elements.playCourtNameError;
      errorEl.textContent = "Court not found.";
      const listContainer = spectate ? elements.spectateCourtList : elements.playCourtList;
      const selectedItem = listContainer.querySelector(`[data-court-name="${courtName}"]`);
      if (selectedItem)
      {
        selectedItem.remove();
      }
      return;
    }

    currentCourt = courtName;
    const data = snap.data();
    currentCourtPassword = data.password;

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

    showCourtTitle(courtName);

    if (spectate) enableSpectateMode();
    else disableSpectateMode();

    listenToCourt(courtName);

    requestWakeLock();

    await initNfc();
  }

  function enableSpectateMode()
  {
    isSpectating = true;
    document.body.classList.add("spectating-mode");

    $("addPointA").style.pointerEvents = "none";
    $("addPointB").style.pointerEvents = "none";

    elements.undoBtn.style.display = "none";
    elements.resetBtn.style.display = "none";
    elements.muteBtn.style.display = "none";
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
    elements.muteBtn.style.display = "";
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

  async function addPoint(team)
  {
    await addDoc(
      collection(db, "courts", currentCourt, "events"),
      {
        eventType: team === TEAM_A
          ? "POINT_TEAM_A"
          : "POINT_TEAM_B",
        createdAt: serverTimestamp()
      }
    );

    animate(team);
    playSound(SOUND_IDS.POINT);
  }

  async function undoLastPoint()
  {
    if (isSpectating) return;

    try
    {
      await addDoc(
        collection(db, "courts", currentCourt, "events"),
        {
          eventType: "UNDO_LAST_POINT",
          createdAt: serverTimestamp()
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
    [TEAM_A, TEAM_B].forEach(team =>
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
    const opp = team === TEAM_A ? TEAM_B : TEAM_A;

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
    const opp = team === TEAM_A ? TEAM_B : TEAM_A;

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
      showToast("NFC is not supported on this device.", "error");
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
        showAlert("NFC Disabled", "NFC is disabled on your device.\nEnable it in settings to use tag scanning.");
      };

    }
    catch (error)
    {
      if (error.name === "NotAllowedError")
      {
        showToast("NFC permission denied.", "error");
      } else if (error.name === "NotSupportedError")
      {
        showToast("NFC not available on this device.", "error");
      } else
      {
        showToast("NFC Error: Failed to initialize scanning.", "error");
      }
      console.error("NFC scan failed:", error);
    }
  }

  // =====================================================
  // NFC HANDLING
  // =====================================================

  function handleNfc(code)
  {

    if (!code) return;

    const action = actionMap[code.toUpperCase()];
    if (!action)
    {
      console.warn("Unknown NFC code:", code);
      return;
    }

    action();
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
    if (!currentCourt) return;
    try
    {
      await addDoc(
        collection(db, "courts", currentCourt, "events"),
        {
          eventType: "RESET",
          createdAt: serverTimestamp()
        }
      );
      elements.resetModal.classList.add("hidden");
      playSound(SOUND_IDS.START);
    }
    catch (err)
    {
      console.error("Reset failed:", err);
      showToast("Reset Failed: " + (err.message || "Unknown error"), "error");
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
    else if (newPassword === currentCourt)
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
        collection(db, "courts", currentCourt, "events"),
        {
          eventType: "RESET",
          createdAt: serverTimestamp()
        }
      );
      await setDoc(
        doc(db, "courts", currentCourt),
        { password: newPassword },
        { merge: true }
      );
      elements.resetModal.classList.add("hidden");
      playSound(SOUND_IDS.START);
    }
    catch (err)
    {
      console.error("Reset failed:", err);
      showToast("Reset Failed: " + (err.message || "Unknown error"), "error");
    }

    elements.resetCourtPassword.value = "";
    elements.resetModal.classList.add("hidden");

    playSound(SOUND_IDS.START);
  });

  addHoldButtonLogic(elements.resetBtn, openResetModal, RESET_HOLD_MS);

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

  elements.swapBtn.addEventListener("click", () =>
  {
    playSound(SOUND_IDS.SWOOSH);

    document.querySelector(".scoreboard").classList.toggle("swapped");
  });

  // =====================================================
  // HOLD BUTTON LOGIC
  // =====================================================

  function addHoldButtonLogic(button, onConfirm, holdMs = 800)
  {
    let pressTimer = null;

    const startPress = () =>
    {
      button.classList.add("holding", "pressed");

      pressTimer = setTimeout(() =>
      {
        onConfirm();
        button.classList.remove("holding", "pressed");
      }, holdMs);
    };

    const cancelPress = () =>
    {
      clearTimeout(pressTimer);
      button.classList.remove("holding", "pressed");
    };

    button.addEventListener("pointerdown", startPress);
    button.addEventListener("pointerup", cancelPress);
    button.addEventListener("pointerleave", cancelPress);
    button.addEventListener("pointercancel", cancelPress);
  }

  addHoldButtonLogic(elements.undoBtn, undoLastPoint, UNDO_HOLD_MS);

  addHoldButtonLogic(elements.backBtn, () =>
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
  }, BACK_HOLD_MS);

  addHoldButtonLogic(elements.resetBtn, () =>
  {
    elements.resetModal.classList.remove("hidden");
  }, RESET_HOLD_MS);

  elements.muteBtn.addEventListener("click", () =>
  {
    muted = !muted;
    elements.muteBtn.textContent = muted ? "🔇" : "🔊";
  });

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
        await updateDoc(doc(db, "courts", currentCourt), {
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

  $("addPointA").addEventListener("click", () => addPoint(TEAM_A));
  $("addPointB").addEventListener("click", () => addPoint(TEAM_B));

  // =====================================================
  // FIREBASE SYNC
  // =====================================================

  let unsubscribe = null;

  function listenToCourt(courtName)
  {
    console.log(`Setting up real-time sync for court: ${courtName}`);
    if (unsubscribe) unsubscribe();

    const scoreRef = doc(db, "courts", courtName, "score", "current");
    const courtRef = doc(db, "courts", courtName);

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
        if (currentCourt !== courtName) return;

        showToast("This court no longer exists.", "error");
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
      if (data.redirect && data.redirect !== currentCourt)
      {
        showToast(`Court has been renamed to "${data.redirect}". Redirecting...`, "success");
        const wasSpectating = isSpectating;
        // Clean up current listener
        if (unsubscribeScore) unsubscribeScore();
        if (unsubscribeCourt) unsubscribeCourt();
        unsubscribe = null;
        // Enter new court
        enterCourt(data.redirect, wasSpectating);
        return;
      }

      // 🚨 Court Closure detection
      if (data.status === STATUS.CLOSED && !isAdmin)
      {
        showToast("The court has been closed by admin.", "error");

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
        !isAdmin &&
        !isSpectating
      )
      {
        showToast("Security notice: Court password changed. You are now a spectator.", "error");
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