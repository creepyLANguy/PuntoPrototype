// Sound effects. Web Audio buffers for the scoring cues (respecting the mute
// preference), the user-gesture priming that unlocks playback, and the clash cue
// used by changeover.
import { SOUND_IDS } from "../config/constants.js";
import { appState } from "../state/appState.js";

let audioContext = null;

let audioBuffers = {};

let audioReady = false;

let audioInitPromise = null;

let audioResumePromise = null;

async function initAudio()
{
  if (audioReady) return;
  if (audioInitPromise) return audioInitPromise;

  audioInitPromise = (async () =>
  {
    if (!audioContext)
    {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

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
  })();

  try
  {
    await audioInitPromise;
  }
  catch (err)
  {
    audioInitPromise = null;
    throw err;
  }
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

export async function playSound(id, force = false, dropIfBlocked = false)
{
  if (appState.muted && !force) return false;

  if (!audioReady)
  {
    try
    {
      await initAudio();
    }
    catch (err)
    {
      console.warn("Audio initialization failed:", err);
      return false;
    }
  }

  if (dropIfBlocked && (!audioContext || audioContext.state !== "running"))
  {
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

export function primeAudioForUserGesture()
{
  if (appState.muted) return;

  try
  {
    if (!audioContext)
    {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    if (audioContext.state === "suspended")
    {
      audioResumePromise = audioContext.resume().catch((err) =>
      {
        console.warn("Audio context could not be resumed:", err);
        return false;
      });
    }
    else
    {
      audioResumePromise = Promise.resolve(true);
    }

    void initAudio().catch((err) =>
    {
      console.warn("Audio initialization failed:", err);
    });
  }
  catch (err)
  {
    console.warn("Audio priming failed:", err);
  }
}

export async function playJoinSound()
{
  if (appState.muted) return false;
  try
  {
    // The player submit button primes/resumes the AudioContext while the
    // browser still considers the action a user gesture. Wait for that
    // resume to finish before playing after the Firestore join work.
    if (audioResumePromise)
    {
      await audioResumePromise;
    }

    return await playSound(SOUND_IDS.START, false, true);
  }
  catch (err)
  {
    console.warn("Join sound could not be played:", err);
    return false;
  }
}

const CLASH_SOUND_URL = "media/sfx/clash.mp3";

// The changeover cue. It deliberately bypasses the Web Audio pipeline above and
// reads the mute state from the mute control, as it always has.
export function playClashSound()
{
  const muteButton = document.getElementById("muteBtn");
  if (muteButton?.getAttribute("aria-pressed") === "true") return;

  if (typeof window.Audio !== "function") return;

  const audio = new window.Audio(CLASH_SOUND_URL);
  audio.volume = 1;
  void audio.play().catch(() => {});
}
