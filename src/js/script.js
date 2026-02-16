// -------- CONFIG --------
const POINTS = [0, 15, 30, 40];

// -------- STATE --------
let score = {
  A: { points: 0, games: 0, sets: 0 },
  B: { points: 0, games: 0, sets: 0 },
  lastPointTeam: null,
  lastGameTeam: null,
  lastSetTeam: null
};

let history = [];

// -------- SCORE LOGIC --------

function saveState() {
  history.push(JSON.parse(JSON.stringify(score)));
}

function addPoint(team) {
  saveState();
  
  const opp = team === "A" ? "B" : "A";
  score.lastPointTeam = team;

  // Deuce logic
  if (score.A.points >= 3 && score.B.points >= 3) {

    // Opponent had advantage → back to deuce
    if (score[opp].points === 4) {
      score[opp].points = 3;
      animate(team);
      updateUI();
      return;
    }

    // Team had advantage → win game
    if (score[team].points === 4) {
      winGame(team);
      return;
    }

    // Give advantage
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

function winSet(team) {
  score[team].sets++;
  score.lastSetTeam = team;

  score.A.games = 0;
  score.B.games = 0;
}

function resetMatch() {
//   const confirmed = confirm("Are you sure you want to reset the entire match?");
//   if (!confirmed) return;
  
//   score = {
//     A: { points: 0, games: 0, sets: 0 },
//     B: { points: 0, games: 0, sets: 0 },
//     lastPointTeam: null,
//     lastGameTeam: null,
//     lastSetTeam: null
//   };
  
//   history = [];

//   updateUI();
  document.getElementById("resetModal").classList.remove("hidden");
}

// -------- UI --------

function pointLabel(p) {
  return p === 4 ? "Ad" : POINTS[p];
}


function updateUI() {
  renderSets("A");
  renderSets("B");
  renderGames("A");
  renderGames("B");

  // points remain as numbers
  pointsA.textContent = pointLabel(score.A.points);
  pointsB.textContent = pointLabel(score.B.points);

  // indicator dot for last point
  document.querySelector('#teamA .indicator-dot').style.opacity = score.lastPointTeam === 'A' ? 1 : 0;
  document.querySelector('#teamB .indicator-dot').style.opacity = score.lastPointTeam === 'B' ? 1 : 0;
}

function animate(team) {
  const el = document.getElementById(team === "A" ? "teamA" : "teamB");
  el.classList.remove("score-animate");
  void el.offsetWidth;
  el.classList.add("score-animate");
}

// -------- COOLDOWN --------

function startCooldown() {
  qr.pause();
  reader.style.visibility = "hidden"; 
    
  setControlsVisible(false); // hide controls when scanning is paused

  cooldownRemaining = COOLDOWN_MS / 1000;
  cooldown.textContent = `Next scan in ${cooldownRemaining}s`;
  cooldown.classList.add("active");

  cooldownTimer = setInterval(() => {
    cooldownRemaining--;
    if (cooldownRemaining <= 0) {
      clearInterval(cooldownTimer);
      cooldown.classList.remove("active");
      setControlsVisible(true);
      reader.style.visibility = "visible"; 
    } else {
      cooldown.textContent = `Next scan in ${cooldownRemaining}s`;
    }
  }, 1000);
}

// -------- QR HANDLING --------

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
    //startQrScanner();
  }, COOLDOWN_MS);
}

// -------- CAMERA --------

const qr = new Html5Qrcode("reader", {
  formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE]
});

function startQrScanner() {
  qr.start(
    { facingMode: "user" },
    {
      fps: 10,
      qrbox: (videoWidth, videoHeight) => getQrBoxSize(videoWidth, videoHeight)
    },
    (decodedText) => handleQR(decodedText)
  )
  .then(() => fixVideoOrientation())
  .catch(err => console.warn("QR start failed:", err));
}

startQrScanner();

updateUI();

// -------- TEAM NAME EDITING --------

document.querySelectorAll(".team-name").forEach((el) => {
  const team = el.dataset.team;

  // Load saved name
  const saved = localStorage.getItem(`teamName${team}`);
  if (saved) el.textContent = saved;

  el.addEventListener("click", () => {
    startEditing(el, team);
  });
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

// -------- CONTROLS VISIBILITY --------
const controlsEl = document.getElementById("controls");

function setControlsVisible(visible) {
  if (controlsEl) {
    controlsEl.style.visibility = visible ? "visible" : "hidden"; // keeps layout intact
    controlsEl.style.pointerEvents = visible ? "auto" : "none"; // prevents clicking when hidden
  }
}

window.addEventListener("orientationchange", () => {
  setTimeout(() => {
    fixVideoOrientation();
    qr.pause();      // pause scanning
    qr.resume();     // resume with updated box
  }, 300);
});

screen.orientation?.addEventListener("change", () => {
  setTimeout(() => {
    fixVideoOrientation();
    qr.pause();
    qr.resume();
  }, 300);
});


let wakeLock = null;

async function requestWakeLock() {
  try {
    wakeLock = await navigator.wakeLock.request("screen");

    wakeLock.addEventListener("release", () => {
      console.log("Wake Lock released");
    });

    console.log("Wake Lock active");
  } catch (err) {
    console.warn("Wake Lock failed:", err);
  }
}

// async function releaseWakeLock() {
//   if (wakeLock) {
//     await wakeLock.release();
//     wakeLock = null;
//   }
// }

let noSleepInterval = null;

function startNoSleepFallback() {
  noSleepInterval = setInterval(() => {
    window.scrollTo(0, 1);
  }, 20000);
}

function stopNoSleepFallback() {
  clearInterval(noSleepInterval);
}

if ("wakeLock" in navigator) {
  requestWakeLock();
} else {
  startNoSleepFallback();
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    if ("wakeLock" in navigator) {
      requestWakeLock();
    } else {
      startNoSleepFallback();
    }
  }
});

function renderSets(team) {
  const el = document.getElementById(team === "A" ? "setsA" : "setsB");
  const opp = team === "A" ? "B" : "A";

  const teamSets = score[team].sets;
  const oppSets = score[opp].sets;

  // Determine max number of sets dynamically
  let maxSets = Math.max(teamSets, oppSets, 3); // start with at least 3

  el.innerHTML = "";

  for (let i = 0; i < maxSets; i++) {
    const dot = document.createElement("span");
    dot.className = "set-dot";

    if (i < teamSets) dot.classList.add("filled");

    // Glow the most recent set won
    if (i === teamSets - 1 && score.lastSetTeam === team) {
      dot.classList.add("recent");
    }

    el.appendChild(dot);
  }
}

function renderGames(team) {
  const el = document.getElementById(team === "A" ? "gamesA" : "gamesB");
  const opp = team === "A" ? "B" : "A";

  const teamGames = score[team].games;
  const oppGames = score[opp].games;

  // Determine max number of dots dynamically
  let maxGames = Math.max(teamGames, oppGames, 6); // at least 6, expand if needed

  el.innerHTML = "";

  for (let i = 0; i < maxGames; i++) {
    const dot = document.createElement("span");
    dot.className = "game-dot";

    if (i < teamGames) dot.classList.add("filled");

    el.appendChild(dot);
  }
}

function winGame(team) {

  score[team].games++;
  score.lastGameTeam = team; // for glow

  score.A.points = 0;
  score.B.points = 0;

  const opp = team === "A" ? "B" : "A";
  if (score[team].games >= 6 && score[team].games - score[opp].games >= 2) {
    winSet(team);
  }

  animate(team);
  updateUI();
}

window.addEventListener("orientationchange", () => {
  setTimeout(fixVideoOrientation, 300); // slight delay allows browser to resize video
});

screen.orientation?.addEventListener("change", () => {
  setTimeout(fixVideoOrientation, 300);
});

function fixVideoOrientation() { 
  const video = document.querySelector("#reader video");
  if (!video) return;

  // Get rotation angle
  let angle = 0;
  if (screen.orientation && typeof screen.orientation.angle === "number") {
    angle = screen.orientation.angle;
  } else if (typeof window.orientation === "number") {
    angle = window.orientation;
  }

  angle = (angle + 360) % 360; // normalize

  // Map to front-camera rotation
  let rotation = 0;
  switch(angle) {
    case 0: rotation = 0; break;
    case 90: rotation = -90; break;
    case 180: rotation = 180; break;
    case 270: rotation = 90; break;
  }

  // Apply rotation + horizontal mirror for front camera
  video.style.transform = `rotate(${rotation}deg) scaleX(-1)`;
  video.style.transformOrigin = "center center";
  video.style.width = "100%";
  video.style.height = "100%";
  video.style.objectFit = "cover";
}

function getQrBoxSize(videoWidth, videoHeight) {
  const scale = qrScale; // e.g., 0.75
  let dim = Math.min(videoWidth * scale, videoHeight * scale);

  // If landscape, optionally make it wider than tall
  if (window.innerWidth > window.innerHeight) {
    dim = Math.min(videoHeight * scale, videoWidth * scale);
  }

  return { width: dim, height: dim };
}

const resetModal = document.getElementById("resetModal");
const confirmResetBtn = document.getElementById("confirmReset");
const cancelResetBtn = document.getElementById("cancelReset");

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

const undoBtn = document.getElementById("undoBtn");

let undoPressTimer = null;
const UNDO_HOLD_MS = 800;

function startUndoPress() {
  undoBtn.classList.add("holding");

  undoPressTimer = setTimeout(() => {
    undoLastPoint(); // your proper undo function
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