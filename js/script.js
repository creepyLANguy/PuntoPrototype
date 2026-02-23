import {
  db,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp
} from "./firebase.js";

document.addEventListener("DOMContentLoaded", () => {

// =====================================================
// CONFIG
// =====================================================

const POINTS = [0, 15, 30, 40];
const COOLDOWN_MS = 3000;
const BACK_HOLD_MS = 550;
const UNDO_HOLD_MS = 550;
const RESET_HOLD_MS = 1050;
const MUTE_HOLD_MS = 550;

const TEAM_A = "A";
const TEAM_B = "B";
const NFC_UNDO = "U";
const NFC_RESET = "R";

const SOUND_IDS = {
  POINT: "pointSound",
  UNDO: "undoSound",
  SWOOSH: "swooshSound",
  START: "startSound",
  WARNING: "warningSound"
};

// =====================================================
// ACTION MAP
// =====================================================

const actionMap = {
  [TEAM_A]: () => addPoint(TEAM_A),
  [TEAM_B]: () => addPoint(TEAM_B),
  [NFC_UNDO]: () => performShallowReset(),//AL.
  [NFC_RESET]: () => performShallowReset()
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
let history = [];

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
  cancelResetBtn: $("cancelReset"),

  undoBtn: $("undoBtn"),
  backBtn: $("backBtn"),
  resetBtn: $("resetBtn"),
  swapBtn: $("swapBtn"),
  muteBtn: $("muteBtn")
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

//PLAY COURT ELEMENTS
elements.playPage = $("playPage");
elements.closePlayBtn = $("closePlayBtn");

elements.playCourtName = $("playCourtName");
elements.playCourtPassword = $("playCourtPassword");

elements.playCourtNameError = $("playCourtNameError");
elements.playCourtPasswordError = $("playCourtPasswordError");

elements.enterCourtBtn = $("enterCourtBtn");

//SPECTATE COURT ELEMENTS
elements.spectatePage = $("spectatePage");
elements.closeSpectateBtn = $("closeSpectateBtn");

elements.spectateCourtName = $("spectateCourtName");
elements.spectateCourtNameError = $("spectateCourtNameError");
elements.spectateCourtBtn = $("spectateCourtBtn");

//RESET COURT ELEMENTS
elements.resetCourtPassword = $("resetCourtPassword");
elements.resetPasswordError = $("resetPasswordError");

//NFC ELEMENTS
elements.nfcCooldownBanner = $("nfcCooldownBanner");
elements.nfcCountdown = $("nfcCountdown");

// =====================================================
// ENTER KEY SUBMIT LISTENERS
// =====================================================

function submitOnEnter(inputEl, buttonEl) {
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      buttonEl.click();
    }
  });
}

// CREATE PAGE
submitOnEnter(elements.adminPassword, elements.createCourtBtn);
submitOnEnter(elements.courtName, elements.createCourtBtn);
submitOnEnter(elements.courtPassword, elements.createCourtBtn);

// PLAY PAGE
submitOnEnter(elements.playCourtName, elements.enterCourtBtn);
submitOnEnter(elements.playCourtPassword, elements.enterCourtBtn);

// SPECTATE PAGE
submitOnEnter(elements.spectateCourtName, elements.spectateCourtBtn);

// RESET MODAL
submitOnEnter(elements.resetCourtPassword, elements.confirmResetBtn);

// =====================================================
// ESC KEY HANDLING (DISMISS MODALS / PAGES)
// =====================================================

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;

  const isVisible = (el) =>
    window.getComputedStyle(el).display !== "none";

  // 1️⃣ Reset modal (highest priority)
  if (isVisible(elements.resetModal)) {
    elements.resetModal.classList.add("hidden");
    return;
  }

  // 2️⃣ Create page
  if (isVisible(elements.createPage)) {
    elements.createPage.style.display = "none";
    elements.menuPage.style.display = "flex";
    return;
  }

  // 3️⃣ Play page
  if (isVisible(elements.playPage)) {
    elements.playPage.style.display = "none";
    elements.menuPage.style.display = "flex";
    return;
  }

  // 4️⃣ Spectate page
  if (isVisible(elements.spectatePage)) {
    elements.spectatePage.style.display = "none";
    elements.menuPage.style.display = "flex";
    return;
  }

  // 5️⃣ Scoreboard
  if (isVisible(elements.scoreboardPage)) {
    disableSpectateMode();
    elements.scoreboardPage.style.display = "none";
    elements.menuPage.style.display = "flex";
  }
});

// =====================================================
// MENU TOGGLE
// =====================================================

async function getAdminPassword() {
  const adminref = doc(db, "admin", "goodies");
  const adminSnap = await getDoc(adminref);
  return adminSnap.data().skeletonKey;
}

document.querySelectorAll(".menu-btn").forEach(btn => {
  btn.addEventListener("click", async () => {
    const action = btn.textContent.trim();

    if (action === "Create") {
      elements.menuPage.style.display = "none";
      elements.createPage.style.display = "flex";
      return;
    }

    if (action === "Play") {
      elements.menuPage.style.display = "none";
      elements.playPage.style.display = "flex";
      return;
    }

    if (action === "Spectate") {
      elements.menuPage.style.display = "none";
      elements.spectatePage.style.display = "flex";
      return;
    }      
  });
});

elements.closeCreateBtn.addEventListener("click", () => {
  elements.createPage.style.display = "none";
  elements.menuPage.style.display = "flex";
});

elements.closePlayBtn.addEventListener("click", () => {
  elements.playPage.style.display = "none";
  elements.menuPage.style.display = "flex";
});

elements.closeSpectateBtn.addEventListener("click", () => {
  elements.spectatePage.style.display = "none";
  elements.menuPage.style.display = "flex";
});

elements.createPage.addEventListener("click", (e) => {
  if (e.target === elements.createPage) {
    elements.createPage.style.display = "none";
    elements.menuPage.style.display = "flex";
    
  }
});

elements.playPage.addEventListener("click", (e) => {
  if (e.target === elements.playPage) {
    elements.playPage.style.display = "none";
    elements.menuPage.style.display = "flex";
  }
});

elements.spectatePage.addEventListener("click", (e) => {
  if (e.target === elements.spectatePage) {
    elements.spectatePage.style.display = "none";
    elements.menuPage.style.display = "flex";
  }
});

function showCourtTitle(name) {
  let existing = document.getElementById("courtTitle");

  if (!existing) {
    existing = document.createElement("div");
    existing.id = "courtTitle";
    existing.style.textAlign = "center";
    existing.style.fontSize = "32px";
    existing.style.margin = "10px";
    elements.scoreboardPage.prepend(existing);
  }

  existing.textContent = name;
}

elements.createCourtBtn.addEventListener("click", async () => {
  const adminPass = elements.adminPassword.value.trim();
  const courtName = elements.courtName.value.trim();
  const courtPass = elements.courtPassword.value.trim();

  elements.adminError.textContent = "";
  elements.courtNameError.textContent = "";
  elements.courtPasswordError.textContent = "";

  var skeletonKey = await getAdminPassword();
  if (adminPass !== skeletonKey) {
    elements.adminError.textContent = "Invalid admin password.";
    return;
  }

  let courtRef = null;

  if (!courtName) {
    elements.courtNameError.textContent = "Court name required.";
    return;
  } 
  else {
    courtRef = doc(db, "courts", courtName);
    const existing = await getDoc(courtRef);

    if (existing.exists()) {
      elements.courtNameError.textContent = "Court already exists.";
      return;
    }
  }

  if (courtPass.length < 4) {
    elements.courtPasswordError.textContent = "Minimum 4 characters.";
    return;
  }

  if (courtPass === courtName) {
    elements.courtPasswordError.textContent = "Password must be different from court name.";
    return;
  }

  courtRef = doc(db, "courts", courtName);
  await setDoc(courtRef, {
    name: courtName,
    password: courtPass,
    createdAt: serverTimestamp(),
    score: defaultScore(),
    history: [],
    teamNames: { A: "Team A", B: "Team B" }
  });

  currentCourtPassword = courtPass;
  isAdmin = true;
  enterCourt(courtName, false);
  
  elements.adminPassword.value = "";
  elements.courtName.value = "";
  elements.courtPassword.value = "";
});


elements.enterCourtBtn.addEventListener("click", async () => {
  const name = elements.playCourtName.value.trim();
  const password = elements.playCourtPassword.value.trim();

  elements.playCourtNameError.textContent = "";
  elements.playCourtPasswordError.textContent = "";

  if (!name) {
    elements.playCourtNameError.textContent = "Court name required.";
    return;
  }

  if (!password) {
    elements.playCourtPasswordError.textContent = "Password required.";
    return;
  }

  const courtRef = doc(db, "courts", name);
  const snap = await getDoc(courtRef);

  if (!snap.exists()) {
    elements.playCourtNameError.textContent = "Court not found.";
    return;
  }

  var adminPassword = await getAdminPassword();
  if (password === adminPassword) {
    isAdmin = true;
    enterCourt(name, false);
    return;
  }

  if (snap.data().password !== password) {
    elements.playCourtPasswordError.textContent = "Incorrect password.";
    return;
  }

  currentCourtPassword = password;
  enterCourt(name, false);

  elements.playCourtPassword.value = "";
});

elements.spectateCourtBtn.addEventListener("click", async () => {

  const name = elements.spectateCourtName.value.trim();

  elements.spectateCourtNameError.textContent = "";

  if (!name) {
    elements.spectateCourtNameError.textContent = "Court name required.";
    return;
  }

  const courtRef = doc(db, "courts", name);
  const snap = await getDoc(courtRef);

  if (!snap.exists()) {
    elements.spectateCourtNameError.textContent = "Court not found.";
    return;
  }

  enterCourt(name, true);
});

async function enterCourt(courtName, spectate) {
  const courtRef = doc(db, "courts", courtName);
  const snap = await getDoc(courtRef);

  currentCourt = courtName;

  //AL.
  //TODO - remove the alert and handle case where court is deleted after user enters name but before they click enter. Currently this would cause an error.
  if (!snap.exists()) {
    alert("Court not found");
    return;
  }
  //

  await initAudio();
  await initNfc();
  
  playSound(SOUND_IDS.START);

  const data = snap.data();

  score = data.score;
  history = data.history || [];

  // ✅ Hide ALL entry pages
  elements.menuPage.style.display = "none";
  elements.createPage.style.display = "none";
  elements.playPage.style.display = "none";
  elements.spectatePage.style.display = "none";

  // ✅ Show scoreboard
  elements.scoreboardPage.style.display = "block";

  showCourtTitle(courtName);

  if (spectate) enableSpectateMode();
  else disableSpectateMode();

  listenToCourt(courtName);
}

function enableSpectateMode() {
  isSpectating = true;
  document.body.classList.add("spectating-mode");

  $("addPointA").style.pointerEvents = "none";
  $("addPointB").style.pointerEvents = "none";

  elements.undoBtn.style.display = "none";
  elements.resetBtn.style.display = "none";
  elements.swapBtn.style.display = "none";
  elements.muteBtn.style.display = "none";
  
  showSpectatorBadges();
}

function disableSpectateMode() {
  isSpectating = false;

  document.body.classList.remove("spectating-mode");

  $("addPointA").style.pointerEvents = "auto";
  $("addPointB").style.pointerEvents = "auto";

  elements.undoBtn.style.display = "inline-block";
  elements.resetBtn.style.display = "inline-block";
  elements.swapBtn.style.display = "inline-block";
  elements.muteBtn.style.display = "inline-block";

  removeSpectatorBadges();
}

function showSpectatorBadges() {

  const positions = [
    //"left", 
    "right"
  ];

  positions.forEach(pos => {

    let badge = document.getElementById(`spectatorBadge-${pos}`);

    if (!badge) {
      badge = document.createElement("div");
      badge.id = `spectatorBadge-${pos}`;
      badge.className = "spectator-badge";
      badge.textContent = "🔴 LIVE";

      badge.classList.add(pos);

      document.body.appendChild(badge);
    }

  });
}

function removeSpectatorBadges() {

  ["left", "right"].forEach(pos => {
    const badge = document.getElementById(`spectatorBadge-${pos}`);
    if (badge) badge.remove();
  });

}

// =====================================================
// SOUND LOGIC
// =====================================================

let audioContext = null;
let audioBuffers = {};
let audioReady = false;

async function initAudio() {
  if (audioReady) return;

  audioContext = new (window.AudioContext || window.webkitAudioContext)();

  await Promise.all([
    loadSound("pointSound", "media/sfx/point.mp3"),
    loadSound("undoSound",  "media/sfx/undo.mp3"),
    loadSound("swooshSound","media/sfx/swoosh.mp3"),
    loadSound("startSound","media/sfx/start.mp3"),
    loadSound("warningSound","media/sfx/warning.mp3"),
  ]);

  audioReady = true;
}

function loadSound(id, url) {
  return fetch(url)
    .then(r => r.arrayBuffer())
    .then(buffer => audioContext.decodeAudioData(buffer))
    .then(decoded => {
      audioBuffers[id] = decoded;
    });
}

async function playSound(id, force = false) {
  if (muted && !force) return;

  if (!audioReady) {
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

async function persistCourt() {
  if (!currentCourt) return;

  const courtRef = doc(db, "courts", currentCourt);

  let teamNames = { A: getTeamName(TEAM_A), B: getTeamName(TEAM_B) };

  await updateDoc(courtRef, {
    score: score,
    history: history,
    teamNames: teamNames
  });
}

function opponent(team) {
  return team === TEAM_A ? TEAM_B : TEAM_A;
}

const cloneScore = () => JSON.parse(JSON.stringify(score));

function addPoint(team) {        
  playSound(SOUND_IDS.POINT);

  history.push(cloneScore());

  score.lastPointTeam = team;
  
  const opp = opponent(team);

  // Deuce logic
  if (score.A.points >= 3 && score.B.points >= 3) {

    if (score[opp].points === 4) {
      score[opp].points = 3;
      return afterPoint(team);
    }

    if (score[team].points === 4) {
      return winGame(team);
    }

    score[team].points = 4;
    return afterPoint(team);
  }

  score[team].points++;

  if (score[team].points >= 4) {
    return winGame(team);
  }

  afterPoint(team);
}

function afterPoint(team) {
  animate(team);
  updateUI();
  persistCourt();
}

function undoLastPoint() {
  if (!score.lastPointTeam || history.length === 0) return;

  let animationTarget = score.lastPointTeam;

  score = history.pop();

  persistCourt();

  animateUndo(animationTarget);

  playSound(SOUND_IDS.UNDO);

  const pointsEl = elements.points[animationTarget];
  pointsEl.classList.remove("undo-flash");
  void pointsEl.offsetWidth;
  pointsEl.classList.add("undo-flash");      
}

function winGame(team) {
  const opp = opponent(team);

  score[team].games++;
  score.lastGameTeam = team;

  score.A.points = 0;
  score.B.points = 0;

  if (
    score[team].games >= 6 &&
    score[team].games - score[opp].games >= 2
  ) {
    winSet(team);
  }

  afterPoint(team);
}

function winSet(team) {
  score[team].sets++;
  score.lastSetTeam = team;

  score.A.games = 0;
  score.B.games = 0;
}

// =====================================================
// UI
// =====================================================

const pointLabel = (p) => p === 4 ? "Ad" : POINTS[p];

function updateUI() {
  [TEAM_A, TEAM_B].forEach(team => {
    renderSets(team);
    renderGames(team);
    elements.points[team].textContent = pointLabel(score[team].points);

    document.querySelector(`#team${team} .indicator`).style.opacity =
      score.lastPointTeam === team ? 1 : 0;
  });
}

function animate(team) {
  const el = $(`team${team}`);
  el.classList.remove("score-animate");
  void el.offsetWidth;
  el.classList.add("score-animate");
}

function animateUndo(team) {
  const el = $(`team${team}`);
  el.classList.remove("undo-animate");
  void el.offsetWidth;
  el.classList.add("undo-animate");
}

function renderSets(team) {
  const el = elements.sets[team];
  const opp = opponent(team);

  const teamSets = score[team].sets;
  const oppSets = score[opp].sets;
  const maxSets = Math.max(teamSets, oppSets, 3);

  el.innerHTML = "";

  const teamColor = getComputedStyle(document.documentElement)
    .getPropertyValue(team === TEAM_A ? '--teamAcolour' : '--teamBcolour');

  for (let i = 0; i < maxSets; i++) {
    const dot = document.createElement("span");
    dot.className = "set-dot";

    if (i < teamSets) {
      dot.classList.add("filled");
      dot.style.backgroundColor = teamColor;
    }

    if (i === teamSets - 1 && score.lastSetTeam === team) {
      dot.classList.add("recent");
    }

    el.appendChild(dot);
  }
}

function renderGames(team) {
  const el = elements.games[team];
  const opp = opponent(team);

  const teamGames = score[team].games;
  const oppGames = score[opp].games;
  const maxGames = Math.max(teamGames, oppGames, 6);

  el.innerHTML = "";

  for (let i = 0; i < maxGames; i++) {
    const dot = document.createElement("span");
    dot.className = "game-dot";
    if (i < teamGames) dot.classList.add("filled");
    el.appendChild(dot);
  }
}

// =====================================================
// NFC INITIALISATION
// =====================================================

async function initNfc() {
  if (isSpectating) {
    console.warn("NFC not initialized in Spectate mode.");
    return;
  }

  if (!("NDEFReader" in window)) {
    //AL.
    //TODO - remove the alert and replace with a UI element that indicates NFC is unavailable, and disable any NFC-related features.
    //alert("NFC Supported?\n" + ("NDEFReader" in window));
    //
    console.warn("Web NFC not supported on this device.");
    return;
  }

  try {
    nfcReader = new NDEFReader();
    await nfcReader.scan();

    console.log("NFC scanning started.");

    nfcReader.onreading = (event) => {
      if (!elements.scoreboardPage || 
          elements.scoreboardPage.style.display === "none") {
        return;
      }

      if (!canProcessNfc()) return;

      const decoder = new TextDecoder();

      for (const record of event.message.records) {
        if (record.recordType === "text") {
          const text = decoder.decode(record.data).trim();
          console.log("NFC scanned:", text);
          handleNfc(text);
        }
      }
    };

  } catch (error) {
    console.error("NFC scan failed:", error);
  }
}

// =====================================================
// NFC HANDLING
// =====================================================

function handleNfc(code) {

  if (!code) return;

  const action = actionMap[code.toUpperCase()];
  if (!action) {
    console.warn("Unknown NFC code:", code);
    return;
  }

  action();
}

function canProcessNfc() {
  const now = Date.now();

  if (nfcCooldown) return false;

  if (now - lastNfcScanTime < COOLDOWN_MS) {
    return false;
  }

  startNfcCooldownUI();

  lastNfcScanTime = now;
  nfcCooldown = true;

  setTimeout(() => {
    nfcCooldown = false;
  }, COOLDOWN_MS);

  return true;
}

// =====================================================
// CONTROLS
// =====================================================

function performShallowReset() {
  score = defaultScore();
  history = [];

    [TEAM_A, TEAM_B].forEach(team => {
    const labelEl = document.querySelector(`.team-name[data-team="${team}"] .name-text`);
    labelEl.textContent = `Team ${team}`;
    fitTextToContainer(labelEl);
  });

  updateUI();

  playSound(SOUND_IDS.START);

  persistCourt();
}

elements.confirmResetBtn.addEventListener("click", async () => {
  const newPassword = elements.resetCourtPassword.value.trim();
  elements.resetPasswordError.textContent = "";


  if (newPassword.length < 4) {
    elements.resetPasswordError.textContent = "Password must be at least 4 characters.";
    return;
  }

  if (newPassword === currentCourt) {
    elements.resetPasswordError.textContent = "Password must be different from court name.";
    return;
  }

  const courtRef = doc(db, "courts", currentCourt);

  if (newPassword === currentCourtPassword) {
    elements.resetPasswordError.textContent = "New password must be different from the current one.";
    return;
  }
  
  currentCourtPassword = newPassword;

  await updateDoc(courtRef, {
    password: newPassword
  });

  score = defaultScore();
  history = [];

  [TEAM_A, TEAM_B].forEach(team => {
    const labelEl = document.querySelector(`.team-name[data-team="${team}"] .name-text`);
    labelEl.textContent = `Team ${team}`;
    fitTextToContainer(labelEl);
  });

  updateUI();

  // Clear the password input for next time
  elements.resetCourtPassword.value = "";
  elements.resetModal.classList.add("hidden");

  playSound(SOUND_IDS.START);

  persistCourt();
});

addHoldButtonLogic(elements.resetBtn, openResetModal, RESET_HOLD_MS);

function openResetModal() {
  playSound(SOUND_IDS.WARNING);
  elements.resetCourtPassword.value = "";
  elements.resetPasswordError.textContent = "";
  elements.resetModal.classList.remove("hidden");
  elements.resetCourtPassword.focus();
}

elements.cancelResetBtn.addEventListener("click", () =>
  elements.resetModal.classList.add("hidden")
);

elements.resetModal.addEventListener("click", (e) => {
  if (e.target === elements.resetModal)
    elements.resetModal.classList.add("hidden");
});

elements.swapBtn.addEventListener("click", () => {
  playSound(SOUND_IDS.SWOOSH);

  document.querySelector(".scoreboard").classList.toggle("swapped");
});

// =====================================================
// HOLD BUTTON LOGIC
// =====================================================

function addHoldButtonLogic(button, onConfirm, holdMs = 800) {
  let pressTimer = null;

  const startPress = () => {
    button.classList.add("holding", "pressed");

    pressTimer = setTimeout(() => {
      onConfirm();
      button.classList.remove("holding", "pressed");
    }, holdMs);
  };

  const cancelPress = () => {
    clearTimeout(pressTimer);
    button.classList.remove("holding", "pressed");
  };

  button.addEventListener("pointerdown", startPress);
  button.addEventListener("pointerup", cancelPress);
  button.addEventListener("pointerleave", cancelPress);
  button.addEventListener("pointercancel", cancelPress);
}

addHoldButtonLogic(elements.undoBtn, undoLastPoint, UNDO_HOLD_MS);

addHoldButtonLogic(elements.backBtn, () => {
  disableSpectateMode();
  elements.scoreboardPage.style.display = "none";
  elements.menuPage.style.display = "flex";
}, BACK_HOLD_MS);

addHoldButtonLogic(elements.resetBtn, () => {
  elements.resetModal.classList.remove("hidden");
}, RESET_HOLD_MS);

addHoldButtonLogic(elements.muteBtn, () => {
  muted = !muted;
  elements.muteBtn.textContent = muted ? "🔇" : "🔊";
}, MUTE_HOLD_MS);

// =====================================================
// TEAM NAME EDITING
// =====================================================

function startEditing(labelEl, team) {
  const input = document.createElement("input");
  input.className = "team-name-input";
  input.value = labelEl.textContent;

  labelEl.replaceWith(input);
  input.focus();
  input.select();

  async function save() {
    const name = input.value.trim() || `Team ${team}`;
    
    await updateDoc(doc(db, "courts", currentCourt), {
      [`teamNames.${team}`]: name
    });

    labelEl.textContent = name;
    input.replaceWith(labelEl);

    fitTextToContainer(labelEl);
  }

  function cancel() {
    input.replaceWith(labelEl);
  }

  input.addEventListener("blur", save);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") save();
    if (e.key === "Escape") cancel();
  });
}

function fitTextToContainer(textEl) {
  const container = textEl.parentElement;

  textEl.style.transform = "scale(1)";

  const containerWidth = container.clientWidth;
  const textWidth = textEl.scrollWidth;

  if (textWidth > containerWidth) {
    const scale = containerWidth / textWidth;
    textEl.style.transform = `scale(${scale})`;
  }
}

document.querySelectorAll(".team-name .name-text").forEach(el => {
  const team = el.closest(".team-name").dataset.team;

  el.addEventListener("click", () => {
    if (isSpectating) return;
    startEditing(el, team);
  });

  fitTextToContainer(el);
});

window.addEventListener("resize", () => {
  document.querySelectorAll(".team-name .name-text")
    .forEach(fitTextToContainer);
});

function getTeamName(team) {
  const labelEl = document.querySelector(`.team-name[data-team="${team}"] .name-text`);
  return labelEl ? labelEl.textContent : `Team ${team}`;
}

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

function listenToCourt(courtName) {

  if (unsubscribe) unsubscribe();

  const courtRef = doc(db, "courts", courtName);

  unsubscribe = onSnapshot(courtRef, (snap) => {
    if (!snap.exists()) return;

    const courtData = snap.data();

    if (
      currentCourtPassword !== courtData.password && 
      !isAdmin && 
      !isSpectating
    ) {
      //AL.
      //TODO - remove the alert and replace with a UI element that indicates the user has been moved to spectate mode due to password change.
      alert("Court password has been changed. You are now in spectate mode.");
      enableSpectateMode();
    }

    currentCourtPassword = courtData.password;

    score = courtData.score;
    history = courtData.history || [];

    document.querySelector(
      `.team-name[data-team="A"] .name-text`
    ).textContent = courtData.teamNames.A;

    document.querySelector(
      `.team-name[data-team="B"] .name-text`
    ).textContent = courtData.teamNames.B;

    updateUI();
  });
}

function startNfcCooldownUI() {
  let remaining = COOLDOWN_MS / 1000;

  elements.nfcCooldownBanner.classList.remove("hidden");
  elements.nfcCountdown.textContent = remaining;

  const interval = setInterval(() => {
    remaining--;
    elements.nfcCountdown.textContent = remaining;

    if (remaining <= 0) {
      clearInterval(interval);
      elements.nfcCooldownBanner.classList.add("hidden");
    }
  }, 1000);
}

});