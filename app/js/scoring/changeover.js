// Changeover: the backend Beacon side swap triggered from the settings tile.
//
//   changeoverCourt callable / court snapshot (firebase/)
//        -> changeover listener (this module)
//        -> session state (punto:changeover events)
//        -> scoreboard view (Switch Views) and settings tiles
//        -> toast and clash sound
//
// This behaviour used to live in firebase.js. It was moved here unchanged; it
// is installed by the composition root before DOMContentLoaded, exactly when
// firebase.js used to install it during module evaluation.
import { playClashSound } from "../audio/audio.js";
import { TOAST_TYPES } from "../config/constants.js";
import { changeoverCourt } from "../firebase/callables.js";
import { listenToCourtDocument } from "../firebase/courtRepository.js";
import { getCourtIdFromHistoryState, observeHistoryChanges } from "../routing/history.js";
import { session } from "../state/sessionState.js";
import { syncSettingsTiles } from "../ui/settingsTiles.js";
import { appendToast } from "../ui/toast.js";

const CHANGEOVER_TOAST = "Changeover complete";
let changeoverUnsubscribe = null;
let activeChangeoverCourtId = null;
let changeoverListenerInitialized = false;
let lastChangeoverEventId = null;

function getCurrentCourtId()
{
  return getCourtIdFromHistoryState();
}

function showChangeoverToast()
{
  appendToast(CHANGEOVER_TOAST, TOAST_TYPES.SUCCESS);
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

  // Notify the session state so its local Beacon changeover state and control
  // state toggle independently of the user's local Switch Views preference.
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

  changeoverUnsubscribe = listenToCourtDocument(
    courtId,
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

  // Capture phase, registered before any other listener, so changeover owns
  // the interaction and does not also run the normal Switch Views sound/cue.
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

      appendToast(error?.message || "Changeover failed", TOAST_TYPES.ERROR);

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

  observeHistoryChanges(notifyNavigation);
}

// Installed at module-evaluation time of the entry point (before
// DOMContentLoaded): the capture listener must precede every other listener on
// the button, and the history hooks must precede the first navigation.
export function installChangeover()
{
  if (typeof window !== "undefined")
  {
    installChangeoverBehaviour();
    installChangeoverNavigationHooks();
    window.setTimeout(attachChangeoverListener, 0);
  }
}

export function registerChangeoverStateListeners()
{
  // Changeover is a backend state transition. It also causes a blind local
  // toggle of this client's changeover state and Switch Views state, without
  // using either view state as an input to the other.
  window.addEventListener("punto:changeover", () =>
  {
    session.beaconSidesSwapped = !session.beaconSidesSwapped;
    syncSettingsTiles();
  });

  // The backend request lifecycle owns the temporary processing state. Keeping
  // that state here means every settings sync renders it consistently rather
  // than allowing an unrelated court/UI snapshot to overwrite the feedback.
  window.addEventListener("punto:changeover-processing", (event) =>
  {
    session.changeoverProcessing = event?.detail?.processing === true;
    syncSettingsTiles();
  });
}
