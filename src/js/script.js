
document.addEventListener("DOMContentLoaded", () => {

  // MENU TOGGLE
  const menuPage = document.getElementById("menuPage");
  const scoreboardPage = document.getElementById("scoreboardPage");
  document.querySelectorAll(".menu-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      menuPage.style.display = "none";
      scoreboardPage.style.display = "block";
    });
  });

// =====================================================
// CONFIG
// =====================================================

const POINTS = [0, 15, 30, 40];
const COOLDOWN_MS = 3000;
const BACK_HOLDBUTTONDURATION_MS = 550;
const UNDO_HOLDBUTTONDURATION_MS = 550;
const RESET_HOLDBUTTONDURATION_MS = 1050;

// =====================================================
// NFC IDs and Action Mapping
// =====================================================

const TEAM_A_ID = "A";
const TEAM_B_ID = "B";
const RESET_ID = "RESET";
const UNDO_ID = "UNDO";

const actionMap = {
  [TEAM_A_ID]: () => addPoint(TEAM_A_ID),
  [TEAM_B_ID]: () => addPoint(TEAM_B_ID),
  [RESET_ID]: () => resetModal.classList.remove("hidden"),
  [UNDO_ID]: () => undoLastPoint(),
};

// =====================================================
// DOM REFERENCES
// =====================================================

const pointsA = document.getElementById("pointsA");
const pointsB = document.getElementById("pointsB");
const setsA = document.getElementById("setsA");
const setsB = document.getElementById("setsB");
const gamesA = document.getElementById("gamesA");
const gamesB = document.getElementById("gamesB");

const cooldownEl = document.getElementById("cooldown");
const controlsEl = document.getElementById("controls");

const resetModal = document.getElementById("resetModal");
const confirmResetBtn = document.getElementById("confirmReset");
const cancelResetBtn = document.getElementById("cancelReset");
const undoBtn = document.getElementById("undoBtn");
const backBtn = document.getElementById("backBtn");

// =====================================================
// STATE
// =====================================================

let score = {
  A: { points: 0, games: 0, sets: 0 },
  B: { points: 0, games: 0, sets: 0 },
  lastPointTeam: null,
  lastGameTeam: null,
  lastSetTeam: null
};

let history = [];

let scanLocked = false;
let cooldownTimer = null;
let cooldownRemaining = 0;
let wakeLock = null;

// =====================================================
// SCORE LOGIC
// =====================================================

function saveState() {
  history.push(JSON.parse(JSON.stringify(score)));
}

function addPoint(team) {
  saveState();
  const opp = team === TEAM_A_ID ? TEAM_B_ID : TEAM_A_ID;
  score.lastPointTeam = team;

  // Deuce logic
  if (score.A.points >= 3 && score.B.points >= 3) {

    if (score[opp].points === 4) {
      score[opp].points = 3;
      animate(team);
      updateUI();
      return;
    }

    if (score[team].points === 4) {
      winGame(team);
      return;
    }

    score[team].points = 4;
    animate(team);
    updateUI();
    return;
  }

  score[team].points++;

  if (score[team].points >= 4) {
    winGame(team);
    return;
  }

  animate(team);
  updateUI();
}

function undoLastPoint() {
  if (score.lastPointTeam) {
    animateUndo(score.lastPointTeam);

    const pointsEl = document.getElementById(
      score.lastPointTeam === "A" ? "pointsA" : "pointsB"
    );

    pointsEl.classList.remove("undo-flash");
    void pointsEl.offsetWidth;
    pointsEl.classList.add("undo-flash");
  }

  if (history.length === 0) return;

  score = history.pop();
  updateUI();
}

function winGame(team) {
  const opp = team === "A" ? "B" : "A";

  score[team].games++;
  score.lastGameTeam = team;

  score.A.points = 0;
  score.B.points = 0;

  if (score[team].games >= 6 && score[team].games - score[opp].games >= 2) {
    winSet(team);
  }

  animate(team);
  updateUI();
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

function pointLabel(p) {
  return p === 4 ? "Ad" : POINTS[p];
}

function updateUI() {
  renderSets("A");
  renderSets("B");
  renderGames("A");
  renderGames("B");

  pointsA.textContent = pointLabel(score.A.points);
  pointsB.textContent = pointLabel(score.B.points);

  document.querySelector('#teamA .indicator').style.opacity =
    score.lastPointTeam === 'A' ? 1 : 0;

  document.querySelector('#teamB .indicator').style.opacity =
    score.lastPointTeam === 'B' ? 1 : 0;
}

function animate(team) {
  const el = document.getElementById(team === "A" ? "teamA" : "teamB");
  el.classList.remove("score-animate");
  void el.offsetWidth;
  el.classList.add("score-animate");
}

function animateUndo(team) {
  const el = document.getElementById(team === "A" ? "teamA" : "teamB");

  el.classList.remove("undo-animate");
  void el.offsetWidth; // force reflow
  el.classList.add("undo-animate");
}

function renderSets(team) {
  const el = team === "A" ? setsA : setsB;
  const opp = team === "A" ? "B" : "A";

  const teamSets = score[team].sets;
  const oppSets = score[opp].sets;

  let maxSets = Math.max(teamSets, oppSets, 3);
  el.innerHTML = "";

  const teamColor = team === "A" ? 
  getComputedStyle(document.documentElement).getPropertyValue('--teamAcolour') : 
  getComputedStyle(document.documentElement).getPropertyValue('--teamBcolour');

  for (let i = 0; i < maxSets; i++) {
    const dot = document.createElement("span");
    dot.className = "set-dot";

    if (i < teamSets) {
      dot.classList.add("filled");
      dot.style.backgroundColor = teamColor; // set team color
    }

    if (i === teamSets - 1 && score.lastSetTeam === team) {
      dot.classList.add("recent");
    }

    el.appendChild(dot);
  }
}

function renderGames(team) {
  const el = team === "A" ? gamesA : gamesB;
  const opp = team === "A" ? "B" : "A";

  const teamGames = score[team].games;
  const oppGames = score[opp].games;

  let maxGames = Math.max(teamGames, oppGames, 6);
  el.innerHTML = "";

  for (let i = 0; i < maxGames; i++) {
    const dot = document.createElement("span");
    dot.className = "game-dot";
    if (i < teamGames) dot.classList.add("filled");
    el.appendChild(dot);
  }
}

// =====================================================
// NFC HANDLING
// =====================================================

function handleNfc(code) {
  if (scanLocked) return;

  const action = actionMap[code];
  if (!action) return;

  scanLocked = true;

  action();
  startCooldown();

  setTimeout(() => {
    scanLocked = false;
    // nfc.resume();
  }, COOLDOWN_MS);
}

function startCooldown() {
  //nfc.pause();
  reader.style.visibility = "hidden";
  setControlsVisible(false);

  cooldownRemaining = COOLDOWN_MS / 1000;
  cooldownEl.textContent = `Next scan in ${cooldownRemaining}s`;
  cooldownEl.classList.add("active");

  cooldownTimer = setInterval(() => {
    cooldownRemaining--;

    if (cooldownRemaining <= 0) {
      clearInterval(cooldownTimer);
      cooldownEl.classList.remove("active");
      setControlsVisible(true);
    } else {
      cooldownEl.textContent = `Next scan in ${cooldownRemaining}s`;
    }
  }, 1000);
}

// =====================================================
// WAKE LOCK
// =====================================================

async function requestWakeLock() {
  try {
    wakeLock = await navigator.wakeLock.request("screen");
  } catch (err) {
    console.warn("Wake Lock failed:", err);
  }
}

if ("wakeLock" in navigator) {
  requestWakeLock();
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && "wakeLock" in navigator) {
    requestWakeLock();
  }
});

// =====================================================
// CONTROLS
// =====================================================

function setControlsVisible(visible) {
  controlsEl.style.visibility = visible ? "visible" : "hidden";
  controlsEl.style.pointerEvents = visible ? "auto" : "none";
}

// Reset modal
confirmResetBtn.addEventListener("click", () => {
  score = {
    A: { points: 0, games: 0, sets: 0 },
    B: { points: 0, games: 0, sets: 0 },
    lastPointTeam: null,
    lastGameTeam: null,
    lastSetTeam: null
  };

  history = [];

  ["A", "B"].forEach(team => {
      localStorage.removeItem(`teamName${team}`);
    const labelEl = document.querySelector(`.team-name[data-team="${team}"] .name-text`);
    labelEl.textContent = `Team ${team}`;
    fitTextToContainer(labelEl); // re-fit default name
  });

  updateUI();
  resetModal.classList.add("hidden");
});

cancelResetBtn.addEventListener("click", () => {
  resetModal.classList.add("hidden");
});

resetModal.addEventListener("click", (e) => {
  if (e.target === resetModal) {
    resetModal.classList.add("hidden");
  }
});

// Generic hold handler for buttons
function addHoldButtonLogic(button, onConfirm, holdMs = 800) {
  let pressTimer = null;

  function startPress(e) {
  button.classList.add("holding");
  button.classList.add("pressed");

    pressTimer = setTimeout(() => {
      onConfirm();
      button.classList.remove("holding");
      button.classList.remove("pressed");
    }, holdMs);
  }

  function cancelPress() {
    clearTimeout(pressTimer);
    button.classList.remove("holding");
    button.classList.remove("pressed");
  }

  button.addEventListener("pointerdown", startPress);
  button.addEventListener("pointerup", cancelPress);
  button.addEventListener("pointerleave", cancelPress);
  button.addEventListener("pointercancel", cancelPress);
}

// ---------------------------------------------------
// Apply hold logic to buttons with appropriate durations and actions
// ---------------------------------------------------
addHoldButtonLogic(undoBtn, undoLastPoint, UNDO_HOLDBUTTONDURATION_MS);

addHoldButtonLogic(backBtn, () => {
  window.location.href = "index.html";
}, BACK_HOLDBUTTONDURATION_MS);

addHoldButtonLogic(resetBtn, () => {
  resetModal.classList.remove("hidden");
}, RESET_HOLDBUTTONDURATION_MS);

// =====================================================
// TEAM NAME EDITING
// =====================================================

document.querySelectorAll(".team-name .name-text").forEach((el) => {
  const team = el.closest(".team-name").dataset.team;
  //AL.
  //TODO - integrate with firestore instead of localStorage for persistence across devices
  //const saved = localStorage.getItem(`teamName${team}`);
  //if (saved) el.textContent = saved;

  el.addEventListener("click", () => startEditing(el, team));
});

function startEditing(labelEl, team) {
  const input = document.createElement("input");
  input.className = "team-name-input";
  input.value = labelEl.textContent;

  labelEl.replaceWith(input);
  input.focus();
  input.select();

function save() {
  const name = input.value.trim() || `Team ${team}`;
  localStorage.setItem(`teamName${team}`, name);

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

  // Reset scaling
  textEl.style.transform = "scale(1)";

  const containerWidth = container.clientWidth;
  const textWidth = textEl.scrollWidth;

  if (textWidth > containerWidth) {
    const scale = containerWidth / textWidth;
    textEl.style.transform = `scale(${scale})`;
  }
}

window.addEventListener("resize", () => {
  document.querySelectorAll(".team-name .name-text").forEach(el => {
    fitTextToContainer(el);
  });
});

document.querySelectorAll(".team-name .name-text").forEach(el => {
  fitTextToContainer(el);
});

// =====================================================
// INIT
// =====================================================

updateUI();

document.getElementById("addPointA").addEventListener("click", () => addPoint("A"));
document.getElementById("addPointB").addEventListener("click", () => addPoint("B"));

});
