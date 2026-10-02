import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import
{
  getFirestore,
  connectFirestoreEmulator,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp,
  collection,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import
{
  getFunctions,
  httpsCallable
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

import * as firebaseEnvironmentConfig from "./firebase-config.js";

const {
  activeFirebaseEnvironment,
  firebaseConfigs
} = firebaseEnvironmentConfig;
const useFirestoreEmulator = firebaseEnvironmentConfig.useFirestoreEmulator === true;

const firebaseConfig = firebaseConfigs[activeFirebaseEnvironment];

if (!firebaseConfig)
{
  throw new Error(`Invalid Firebase environment '${activeFirebaseEnvironment}'. Expected 'production' or 'staging'.`);
}

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

// Served by the Firebase hosting emulator: talk to the local Firestore emulator instead of the cloud project.
const emulatorHosts = ["localhost", "127.0.0.1", "[::1]"];
export const usingEmulator = emulatorHosts.includes(globalThis.location?.hostname);

if (usingEmulator && useFirestoreEmulator)
{
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
}

const functions = getFunctions(app, "africa-south1");
const changeoverCourt = httpsCallable(functions, "changeoverCourt");

const CHANGEOVER_TOAST = "Changeover complete";
const CLASH_SOUND_URL = "media/sfx/clash.mp3";
let changeoverUnsubscribe = null;
let activeChangeoverCourtId = null;
let changeoverListenerInitialized = false;
let lastChangeoverEventId = null;

function getCurrentCourtId()
{
  return window.history.state?.viewState?.courtId || window.history.state?.courtId || null;
}

function showChangeoverToast()
{
  const container = document.getElementById("toastContainer");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = "toast success";
  toast.textContent = CHANGEOVER_TOAST;
  container.appendChild(toast);

  window.setTimeout(() => toast.remove(), 3000);
}

function playClashSound()
{
  const muteButton = document.getElementById("muteBtn");
  if (muteButton?.getAttribute("aria-pressed") === "true") return;

  if (typeof window.Audio !== "function") return;

  const audio = new window.Audio(CLASH_SOUND_URL);
  audio.volume = 1;
  void audio.play().catch(() => {});
}

function syncSwitchViewsButton()
{
  const scoreboard = document.querySelector(".scoreboard");
  const swapButton = document.getElementById("swapBtn");
  if (!scoreboard || !swapButton) return;

  const swapped = scoreboard.classList.contains("swapped");
  swapButton.textContent = swapped ? "⇄" : "⇆";
  swapButton.setAttribute("aria-pressed", String(swapped));

  const tile = swapButton.closest(".setting-item");
  tile?.classList.toggle("active", swapped);
}

function triggerSwitchViews()
{
  const scoreboard = document.querySelector(".scoreboard");
  if (!scoreboard) return;

  // Deliberately invert the current UI state rather than applying the
  // Firestore Beacon mapping. Each device may have chosen its own view.
  scoreboard.classList.toggle("swapped");
  syncSwitchViewsButton();

  // If Match Details is open, ask the existing details action to rebuild its
  // presentation using the newly selected view.
  const detailsModal = document.getElementById("detailsModal");
  if (detailsModal && !detailsModal.classList.contains("hidden"))
  {
    document.getElementById("detailsBtn")?.click();
  }
}

function handleChangeoverEvent(event)
{
  const eventId = event?.id;
  if (!eventId || eventId === lastChangeoverEventId) return;

  lastChangeoverEventId = eventId;
  triggerSwitchViews();

  // Notify script.js so its local Beacon changeover state and control state
  // toggle independently of the user's local Switch Views preference.
  window.dispatchEvent(
    new CustomEvent("punto:changeover", {
      detail: { eventId },
    }),
  );

  showChangeoverToast();
}

function attachChangeoverListener()
{
  const courtId = getCurrentCourtId();
  if (!courtId || courtId === activeChangeoverCourtId) return;

  changeoverUnsubscribe?.();
  changeoverUnsubscribe = null;
  activeChangeoverCourtId = courtId;
  changeoverListenerInitialized = false;
  lastChangeoverEventId = null;

  changeoverUnsubscribe = onSnapshot(
    doc(db, `courts/${courtId}`),
    (snapshot) =>
    {
      if (!snapshot.exists()) return;

      const event = snapshot.data()?.changeoverEvent;

      if (!changeoverListenerInitialized)
      {
        // Establish the baseline without replaying an old changeover after a
        // page reload or court switch. This also works when the court has no
        // changeoverEvent field yet.
        changeoverListenerInitialized = true;
        lastChangeoverEventId = event?.id || null;
        return;
      }

      if (!event?.id) return;
      handleChangeoverEvent(event);
    },
    (error) => console.error("Changeover listener failed", error),
  );
}

function announceChangeoverProcessing(processing)
{
  window.dispatchEvent(
    new CustomEvent("punto:changeover-processing", {
      detail: { processing: processing === true },
    }),
  );
}

function installChangeoverBehaviour()
{
  const changeoverButton = document.getElementById("changeoverBtn");
  if (!changeoverButton) return;

  // Run before script.js's existing click listener so changeover owns the
  // interaction and does not also run the normal Switch Views sound/cue.
  changeoverButton.addEventListener("click", async (event) =>
  {
    event.preventDefault();
    event.stopImmediatePropagation();

    const courtId = getCurrentCourtId();
    if (!courtId) return;

    announceChangeoverProcessing(true);

    try
    {
      const result = await changeoverCourt({ courtId });

      // This is deliberately local-only: remote devices only receive the
      // changeover event through Firestore and must not play the sound.
      playClashSound();

      const eventId = result.data?.changeoverEventId;
      // The listener normally handles this first. This fallback makes the
      // success cue immediate if the callable resolves before the snapshot.
      if (eventId && lastChangeoverEventId !== eventId)
      {
        handleChangeoverEvent({ id: eventId });
      }
    }
    catch (error)
    {
      console.error("Changeover failed", error);
      announceChangeoverProcessing(false);

      const container = document.getElementById("toastContainer");
      if (container)
      {
        const toast = document.createElement("div");
        toast.className = "toast error";
        toast.textContent = error?.message || "Changeover failed";
        container.appendChild(toast);
        window.setTimeout(() => toast.remove(), 3000);
      }

      return;
    }
    finally
    {
      announceChangeoverProcessing(false);
    }
  }, { capture: true });
}

function installChangeoverNavigationHooks()
{
  const notifyNavigation = () => window.setTimeout(attachChangeoverListener, 0);

  window.addEventListener("popstate", notifyNavigation);

  for (const method of ["pushState", "replaceState"])
  {
    const original = window.history[method];
    window.history[method] = function (...args)
    {
      const result = original.apply(this, args);
      notifyNavigation();
      return result;
    };
  }
}

if (typeof window !== "undefined")
{
  installChangeoverBehaviour();
  installChangeoverNavigationHooks();
  window.setTimeout(attachChangeoverListener, 0);
}

export
{
  doc,
  setDoc,
  getDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp,
  collection,
  getDocs
};