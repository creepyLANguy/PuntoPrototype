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

  const IDS = {
    RESET: "RESET",
    UNDO: "UNDO"
  };

  const SOUND_IDS = {
    POINT: "pointSound",
    UNDO: "undoSound",
    SWOOSH: "swooshSound",
    START: "startSound"
  };

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

  // =====================================================
  // MENU TOGGLE
  // =====================================================

  document.querySelectorAll(".menu-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
       await initAudio();   // preload first
       playSound(SOUND_IDS.START, true);
      elements.menuPage.style.display = "none";
      elements.scoreboardPage.style.display = "block";      
    });
  });

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

  let scanLocked = false;
  let cooldownTimer = null;
  let cooldownRemaining = 0;
  let wakeLock = null;

  let muted = false;

  // =====================================================
  // ACTION MAP
  // =====================================================

  const actionMap = {
    [TEAM_A]: () => addPoint(TEAM_A),
    [TEAM_B]: () => addPoint(TEAM_B),
    [IDS.RESET]: () => elements.resetModal.classList.remove("hidden"),
    [IDS.UNDO]: () => undoLastPoint()
  };

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
      loadSound("startSound","media/sfx/start.mp3")
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
      await initAudio();  // 🔥 guaranteed inside user gesture
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

  const cloneScore = () => JSON.parse(JSON.stringify(score));

  function saveState() {
    history.push(cloneScore());
  }

  function opponent(team) {
    return team === TEAM_A ? TEAM_B : TEAM_A;
  }

  function addPoint(team) {        
      playSound(SOUND_IDS.POINT);
    
    saveState();
    const opp = opponent(team);

    score.lastPointTeam = team;

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
  }

  function undoLastPoint() {

    if (score.lastPointTeam) {
      playSound(SOUND_IDS.UNDO);

      animateUndo(score.lastPointTeam);

      const pointsEl = elements.points[score.lastPointTeam];
      pointsEl.classList.remove("undo-flash");
      void pointsEl.offsetWidth;
      pointsEl.classList.add("undo-flash");      
    }

    if (history.length === 0) return;

    score = history.pop();
    updateUI();
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
    }, COOLDOWN_MS);
  }

  function startCooldown() {
    reader.style.visibility = "hidden";
    setControlsVisible(false);

    cooldownRemaining = COOLDOWN_MS / 1000;
    elements.cooldown.textContent = `Next scan in ${cooldownRemaining}s`;
    elements.cooldown.classList.add("active");

    cooldownTimer = setInterval(() => {
      cooldownRemaining--;

      if (cooldownRemaining <= 0) {
        clearInterval(cooldownTimer);
        elements.cooldown.classList.remove("active");
        setControlsVisible(true);
      } else {
        elements.cooldown.textContent =
          `Next scan in ${cooldownRemaining}s`;
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

  if ("wakeLock" in navigator) requestWakeLock();

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" &&
        "wakeLock" in navigator) {
      requestWakeLock();
    }
  });

  // =====================================================
  // CONTROLS
  // =====================================================

  function setControlsVisible(visible) {
    elements.controls.style.visibility = visible ? "visible" : "hidden";
    elements.controls.style.pointerEvents = visible ? "auto" : "none";
  }

  elements.confirmResetBtn.addEventListener("click", () => {
    playSound(SOUND_IDS.START);

    score = defaultScore();
    history = [];

    ["A", "B"].forEach(team => {
      localStorage.removeItem(`teamName${team}`);
      const labelEl = document.querySelector(
        `.team-name[data-team="${team}"] .name-text`
      );
      labelEl.textContent = `Team ${team}`;
      fitTextToContainer(labelEl);
    });

    updateUI();
    elements.resetModal.classList.add("hidden");
  });

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
    window.location.href = "index.html";
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
    el.addEventListener("click", () => startEditing(el, team));
    fitTextToContainer(el);
  });

  window.addEventListener("resize", () => {
    document.querySelectorAll(".team-name .name-text")
      .forEach(fitTextToContainer);
  });

  // =====================================================
  // INIT
  // =====================================================

  updateUI();

  $("addPointA").addEventListener("click", () => addPoint(TEAM_A));
  $("addPointB").addEventListener("click", () => addPoint(TEAM_B));

});