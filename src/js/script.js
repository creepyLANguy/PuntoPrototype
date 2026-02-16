// =====================================================
// CONFIG
// =====================================================

const POINTS = [0, 15, 30, 40];
const COOLDOWN_MS = 3000;
const QR_SCALE = 0.75;

// =====================================================
// DOM REFERENCES
// =====================================================

const pointsA = document.getElementById("pointsA");
const pointsB = document.getElementById("pointsB");
const setsA = document.getElementById("setsA");
const setsB = document.getElementById("setsB");
const gamesA = document.getElementById("gamesA");
const gamesB = document.getElementById("gamesB");

const reader = document.getElementById("reader");
const cooldownEl = document.getElementById("cooldown");
const controlsEl = document.getElementById("controls");

const resetModal = document.getElementById("resetModal");
const confirmResetBtn = document.getElementById("confirmReset");
const cancelResetBtn = document.getElementById("cancelReset");
const undoBtn = document.getElementById("undoBtn");

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
  const opp = team === "A" ? "B" : "A";
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

function resetMatch() {
  resetModal.classList.remove("hidden");
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

  document.querySelector('#teamA .indicator-dot').style.opacity =
    score.lastPointTeam === 'A' ? 1 : 0;

  document.querySelector('#teamB .indicator-dot').style.opacity =
    score.lastPointTeam === 'B' ? 1 : 0;
}

function animate(team) {
  const el = document.getElementById(team === "A" ? "teamA" : "teamB");
  el.classList.remove("score-animate");
  void el.offsetWidth;
  el.classList.add("score-animate");
}

function renderSets(team) {
  const el = team === "A" ? setsA : setsB;
  const opp = team === "A" ? "B" : "A";

  const teamSets = score[team].sets;
  const oppSets = score[opp].sets;

  let maxSets = Math.max(teamSets, oppSets, 3);
  el.innerHTML = "";

  for (let i = 0; i < maxSets; i++) {
    const dot = document.createElement("span");
    dot.className = "set-dot";

    if (i < teamSets) dot.classList.add("filled");
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
// QR HANDLING
// =====================================================

const qr = new Html5Qrcode("reader", {
  formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE]
});

function getQrBoxSize(videoWidth, videoHeight) {
  const dim = Math.min(videoWidth * QR_SCALE, videoHeight * QR_SCALE);
  return { width: dim, height: dim };
}

function startQrScanner() {
  qr.start(
    { facingMode: "user" },
    {
      fps: 10,
      qrbox: (w, h) => getQrBoxSize(w, h)
    },
    (decodedText) => handleQR(decodedText)
  )
  .then(() => fixVideoOrientation())
  .catch(err => console.warn("QR start failed:", err));
}

function handleQR(code) {
  if (scanLocked) return;

  scanLocked = true;

  if (code === "A") addPoint("A");
  if (code === "B") addPoint("B");
  if (code === "RESET") resetMatch();

  startCooldown();

  setTimeout(() => {
    scanLocked = false;
    qr.resume();
  }, COOLDOWN_MS);
}

function startCooldown() {
  qr.pause();
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
      reader.style.visibility = "visible";
      setControlsVisible(true);
    } else {
      cooldownEl.textContent = `Next scan in ${cooldownRemaining}s`;
    }
  }, 1000);
}

// =====================================================
// VIDEO ORIENTATION
// =====================================================

function fixVideoOrientation() {
  const video = document.querySelector("#reader video");
  if (!video) return;

  let angle = screen.orientation?.angle ?? window.orientation ?? 0;
  angle = (angle + 360) % 360;

  let rotation = 0;
  switch(angle) {
    case 90: rotation = -90; break;
    case 180: rotation = 180; break;
    case 270: rotation = 90; break;
  }

  video.style.transform = `rotate(${rotation}deg) scaleX(-1)`;
  video.style.transformOrigin = "center";
}

window.addEventListener("orientationchange", () => {
  setTimeout(fixVideoOrientation, 300);
});

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

// Undo hold logic
let undoPressTimer = null;
const UNDO_HOLD_MS = 800;

function startUndoPress() {
  undoBtn.classList.add("holding");
  undoPressTimer = setTimeout(() => {
    undoLastPoint();
    undoBtn.classList.remove("holding");
  }, UNDO_HOLD_MS);
}

function cancelUndoPress() {
  clearTimeout(undoPressTimer);
  undoBtn.classList.remove("holding");
}

undoBtn.addEventListener("pointerdown", startUndoPress);
undoBtn.addEventListener("pointerup", cancelUndoPress);
undoBtn.addEventListener("pointerleave", cancelUndoPress);
undoBtn.addEventListener("pointercancel", cancelUndoPress);

// =====================================================
// TEAM NAME EDITING
// =====================================================

document.querySelectorAll(".team-name").forEach((el) => {
  const team = el.dataset.team;
  const saved = localStorage.getItem(`teamName${team}`);
  if (saved) el.textContent = saved;

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

// =====================================================
// INIT
// =====================================================

startQrScanner();
updateUI();

document.getElementById("resetBtn").addEventListener("click", resetMatch);
document.getElementById("addPointA").addEventListener("click", () => addPoint("A"));
document.getElementById("addPointB").addEventListener("click", () => addPoint("B"));
