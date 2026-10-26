// Sound effects. Essential scoring cues are loaded first and made independently
// playable; less common cues are warmed during idle time so one slow/failed
// secondary asset cannot hold up the point and undo sounds.
import { SOUND_IDS } from "../config/constants.js";
import { appState } from "../state/appState.js";

let audioContext = null;
const audioBuffers = Object.create(null);
const soundLoadPromises = Object.create(null);
let audioReady = false;
let audioInitPromise = null;
let audioResumePromise = null;
let backgroundSoundsScheduled = false;

const SOUND_URLS = {
  [SOUND_IDS.POINT]: "media/sfx/point.mp3",
  [SOUND_IDS.UNDO]: "media/sfx/undo.mp3",
  [SOUND_IDS.SWOOSH]: "media/sfx/swoosh.mp3",
  [SOUND_IDS.START]: "media/sfx/start.mp3",
  [SOUND_IDS.WARNING]: "media/sfx/warning.mp3",
  [SOUND_IDS.POP]: "media/sfx/pop.mp3",
  [SOUND_IDS.SNAP]: "media/sfx/snap.mp3",
  [SOUND_IDS.SET]: "media/sfx/set.mp3",
};

const ESSENTIAL_SOUND_IDS = [
  SOUND_IDS.POINT,
  SOUND_IDS.UNDO,
  SOUND_IDS.START,
];

const SECONDARY_SOUND_IDS = [
  SOUND_IDS.SWOOSH,
  SOUND_IDS.WARNING,
  SOUND_IDS.POP,
  SOUND_IDS.SNAP,
  SOUND_IDS.SET,
];

function ensureAudioContext() {
  if (audioContext) return audioContext;

  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextConstructor) {
    throw new Error("Web Audio is not supported by this browser");
  }

  audioContext = new AudioContextConstructor();
  return audioContext;
}

function loadSound(id) {
  if (audioBuffers[id]) return Promise.resolve(audioBuffers[id]);
  if (soundLoadPromises[id]) return soundLoadPromises[id];

  const url = SOUND_URLS[id];
  if (!url) return Promise.reject(new Error(`Unknown sound asset: ${id}`));

  const promise = fetch(url)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Could not load sound ${url} (HTTP ${response.status})`);
      }
      return response.arrayBuffer();
    })
    .then((buffer) => ensureAudioContext().decodeAudioData(buffer))
    .then((decoded) => {
      audioBuffers[id] = decoded;
      return decoded;
    })
    .catch((err) => {
      // Permit a later playback attempt to retry a transient fetch/decode error.
      delete soundLoadPromises[id];
      throw err;
    });

  soundLoadPromises[id] = promise;
  return promise;
}

function scheduleBackgroundSounds() {
  if (backgroundSoundsScheduled) return;
  backgroundSoundsScheduled = true;

  const loadSecondarySounds = () => {
    void Promise.allSettled(SECONDARY_SOUND_IDS.map((id) => loadSound(id))).then(
      (results) => {
        results.forEach((result, index) => {
          if (result.status === "rejected") {
            console.warn(
              `Secondary audio cue failed to preload (${SECONDARY_SOUND_IDS[index]}):`,
              result.reason,
            );
          }
        });
      },
    );
  };

  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(loadSecondarySounds, { timeout: 3000 });
  } else {
    window.setTimeout(loadSecondarySounds, 1500);
  }
}

async function initAudio() {
  ensureAudioContext();
  if (audioReady) {
    scheduleBackgroundSounds();
    return;
  }
  if (audioInitPromise) return audioInitPromise;

  audioInitPromise = (async () => {
    const results = await Promise.allSettled(
      ESSENTIAL_SOUND_IDS.map((id) => loadSound(id)),
    );

    // A failure in one cue should not prevent the others from becoming usable.
    audioReady = true;
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        console.warn(
          `Essential audio cue failed to preload (${ESSENTIAL_SOUND_IDS[index]}):`,
          result.reason,
        );
      }
    });

    scheduleBackgroundSounds();
  })();

  try {
    await audioInitPromise;
  } catch (err) {
    audioInitPromise = null;
    throw err;
  }
}

export async function playSound(id, force = false, dropIfBlocked = false) {
  if (appState.muted && !force) return false;

  try {
    ensureAudioContext();

    // Start the full warm-up, but wait only for the specific cue needed by this
    // action. A slow warning/swoosh file must not delay a point sound.
    if (!audioReady) {
      void initAudio().catch((err) => {
        console.warn("Audio initialization failed:", err);
      });
    }
    if (!audioBuffers[id]) await loadSound(id);
  } catch (err) {
    console.warn(`Audio cue could not be played (${id}):`, err);
    return false;
  }

  if (dropIfBlocked && (!audioContext || audioContext.state !== "running")) {
    return false;
  }

  const buffer = audioBuffers[id];
  if (!buffer) return false;

  const source = audioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(audioContext.destination);
  source.start();

  return true;
}

export function primeAudioForUserGesture() {
  if (appState.muted) return;

  try {
    ensureAudioContext();

    if (audioContext.state === "suspended") {
      audioResumePromise = audioContext.resume().catch((err) => {
        console.warn("Audio context could not be resumed:", err);
        return false;
      });
    } else {
      audioResumePromise = Promise.resolve(true);
    }

    void initAudio().catch((err) => {
      console.warn("Audio initialization failed:", err);
    });
  } catch (err) {
    console.warn("Audio priming failed:", err);
  }
}

export async function playJoinSound() {
  if (appState.muted) return false;
  try {
    // The player submit button primes/resumes the AudioContext while the
    // browser still considers the action a user gesture. Wait for that
    // resume to finish before playing after the Firestore join work.
    if (audioResumePromise) {
      await audioResumePromise;
    }

    return await playSound(SOUND_IDS.START, false, true);
  } catch (err) {
    console.warn("Join sound could not be played:", err);
    return false;
  }
}

const CLASH_SOUND_URL = "media/sfx/clash.mp3";

// The changeover cue. It deliberately bypasses the Web Audio pipeline above and
// reads the mute state from the mute control, as it always has.
export function playClashSound() {
  const muteButton = document.getElementById("muteBtn");
  if (muteButton?.getAttribute("aria-pressed") === "true") return;

  if (typeof window.Audio !== "function") return;

  const audio = new window.Audio(CLASH_SOUND_URL);
  audio.volume = 1;
  void audio.play().catch(() => {});
}
