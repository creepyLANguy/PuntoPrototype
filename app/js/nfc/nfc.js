// NFC tag scanning (Web NFC): reader lifecycle, scan cooldown and dispatch of
// tag events to the scoring, court and device-registration actions. The tag
// format itself is parsed by nfc/parser.js.
import { COOLDOWN_MS, EVENT_TYPES, TOAST_TYPES } from "../config/constants.js";
import { enableSpectateMode, enterCourt } from "../court/session.js";
import { isLikelyMobileDevice } from "../lifecycle/deviceIdentity.js";
import { updateDevice } from "../firebase/deviceRepository.js";
import { addPoint, undoLastPoint } from "../scoring/actions.js";
import { performShallowReset } from "../scoring/reset.js";
import { appState } from "../state/appState.js";
import { session } from "../state/sessionState.js";
import { elements } from "../ui/dom.js";
import { showToast } from "../ui/toast.js";
import { parseNfcTagText, readNfcRecordText } from "./parser.js";

const actionMap = {
  [EVENT_TYPES.POINT_TEAM_A]: () => addPoint(EVENT_TYPES.POINT_TEAM_A),
  [EVENT_TYPES.POINT_TEAM_B]: () => addPoint(EVENT_TYPES.POINT_TEAM_B),
  [EVENT_TYPES.UNDO]: () => undoLastPoint(),
  [EVENT_TYPES.RESET]: () => performShallowReset(),
  [EVENT_TYPES.SPECTATE]: () => spectateCourtFromNfc(),
  [EVENT_TYPES.REGISTER]: () => registerDeviceToCurrentCourt()
};

let lastScannedCourtId = null;

let lastScannedDeviceId = null;

let nfcReader = null;

let nfcCooldown = false;

let lastNfcScanTime = 0;

export function registerNfcActivation()
{
  elements.activateNfcBtn.addEventListener("click", async () =>
  {
    await initNfc({ userInitiated: true });
  });
}

async function registerDeviceToCurrentCourt()
{

  if (!session.currentCourtId)
  {
    showToast("Cannot register device - enter a court first.", TOAST_TYPES.ERROR);
    return;
  }

  let deviceId = lastScannedDeviceId;
  lastScannedDeviceId = null;

  if (!deviceId)
  {
    showToast("Scan failed - no device ID found on tag.", TOAST_TYPES.ERROR);
    return;
  }

  await updateDevice(deviceId, {
    courtId: session.currentCourtId
  });

  showToast(`Device ${deviceId} registered to this court.`, TOAST_TYPES.SUCCESS);
}

let nfcInitialized = false;

let nfcStartupCheckPromise = null;

let nfcScanPromise = null;

// A direct activation must take precedence over a pending startup permission
// query, so the browser's user-activation requirement is preserved.
let userActivationRequested = false;

const NFC_MESSAGES = {
  insecureContext: "NFC requires a secure HTTPS connection.",
  unsupportedBrowser: "NFC scanning is unavailable in this browser. Try a supported browser on an NFC-capable device over HTTPS.",
  permissionRequired: "NFC permission is required. Tap Activate NFC and allow access when prompted.",
  permissionDenied: "NFC access is blocked for this site. Allow NFC in your browser's site settings, then try again.",
  ready: "NFC is ready. Tap an NFC tag to scan.",
  adapterUnavailable: "No compatible NFC adapter was detected. Check that this device supports NFC.",
  adapterInaccessible: "NFC is turned off or cannot be accessed. Enable NFC in device settings and try again.",
  initializationError: "NFC scanning could not be started. Please try again."
};

export function initNfc({ userInitiated = false } = {})
{
  if (nfcInitialized) return Promise.resolve();

  if (userInitiated)
  {
    userActivationRequested = true;

    if (window.isSecureContext === false)
    {
      makeNfcActivationAvailable();
      showToast(NFC_MESSAGES.insecureContext, TOAST_TYPES.ERROR);
      return Promise.resolve();
    }

    // The presence of the API is separate from the presence of NFC hardware.
    // Only mobile/tablet-like targets receive this diagnostic, and only after
    // an explicit activation attempt. Desktop and ambiguous devices stay quiet.
    if (typeof window.NDEFReader !== "function")
    {
      makeNfcActivationAvailable();
      if (isLikelyMobileDevice(navigator))
      {
        showToast(NFC_MESSAGES.unsupportedBrowser, TOAST_TYPES.ERROR);
      }
      return Promise.resolve();
    }

    // Do not await a permission query before scan(): browsers may require this
    // call to occur directly inside the activation button's user gesture.
    return startNfcScan({ userInitiated: true });
  }

  if (nfcStartupCheckPromise) return nfcStartupCheckPromise;

  nfcStartupCheckPromise = initializeNfcOnStartup().finally(() =>
  {
    nfcStartupCheckPromise = null;
  });
  return nfcStartupCheckPromise;
}

async function initializeNfcOnStartup()
{
  // Do not produce startup diagnostics for an environment that cannot satisfy
  // the secure-context requirement.
  if (window.isSecureContext === false) return;

  // An absent browser API is not evidence that the physical device lacks NFC.
  // In particular, laptops/desktops should not receive an unsupported toast.
  if (typeof window.NDEFReader !== "function") return;

  const permission = await queryNfcPermission();

  // A click may have started a scan while this asynchronous permission query
  // was pending. Never race it with a second reader/scan initialization.
  if (userActivationRequested || nfcInitialized || nfcScanPromise) return;

  if (!permission.available)
  {
    makeNfcActivationAvailable();
    return;
  }

  if (permission.state === "granted")
  {
    await startNfcScan({ userInitiated: false });
    return;
  }

  makeNfcActivationAvailable();

  if (permission.state === "prompt")
  {
    showToast(NFC_MESSAGES.permissionRequired, TOAST_TYPES.INFO);
  }
  else if (permission.state === "denied")
  {
    appState.nfcDenied = true;
    showToast(NFC_MESSAGES.permissionDenied, TOAST_TYPES.ERROR);
  }
}

async function queryNfcPermission()
{
  if (!navigator.permissions || typeof navigator.permissions.query !== "function")
  {
    return { available: false, state: null };
  }

  try
  {
    const permissionStatus = await navigator.permissions.query({ name: "nfc" });
    return {
      available: true,
      state: permissionStatus?.state || null
    };
  }
  catch (error)
  {
    // Some browsers reject unsupported permission descriptors. That does not
    // mean NFC hardware is missing; leave activation available as a fallback.
    console.warn("Could not query NFC permission state:", error);
    return { available: false, state: null };
  }
}

function startNfcScan({ userInitiated })
{
  if (nfcInitialized) return Promise.resolve();
  if (nfcScanPromise) return nfcScanPromise;

  // startNfcScanAttempt invokes scan() synchronously before its first await,
  // retaining the browser's user activation when called from the click handler.
  const scanAttempt = startNfcScanAttempt({ userInitiated });
  nfcScanPromise = scanAttempt.finally(() =>
  {
    nfcScanPromise = null;
  });
  return nfcScanPromise;
}

async function startNfcScanAttempt({ userInitiated })
{
  try
  {
    nfcReader = new window.NDEFReader();

    nfcReader.onreading = (event) =>
    {
      console.log("NFC Reading event triggered");

      if (!canProcessNfc()) return;

      let foundValidRecord = false;

      for (const record of event.message.records)
      {
        try
        {
          const text = readNfcRecordText(record);
          if (text)
          {
            console.log("NFC text found:", text);
            foundValidRecord = true;
            handleNfc(text);
          }
        }
        catch (err)
        {
          console.error("Error processing NFC record:", err);
        }
      }

      if (!foundValidRecord)
      {
        showToast("NFC tag scanned but no valid data found.", TOAST_TYPES.INFO);
      }
    };

    nfcReader.onerror = () =>
    {
      showToast("NFC is disabled on your device. Enable it in device settings to use tag scanning.", TOAST_TYPES.ERROR);
    };

    await nfcReader.scan();

    if (nfcInitialized) return;

    nfcInitialized = true;
    appState.nfcDenied = false;
    elements.activateNfcBtn.classList.add("hidden");

    console.log("NFC scanning started.");
    showToast(NFC_MESSAGES.ready, TOAST_TYPES.SUCCESS);
  }
  catch (error)
  {
    nfcReader = null;
    handleNfcInitializationError(error, { userInitiated });
  }
}

function handleNfcInitializationError(error, { userInitiated })
{
  console.error("NFC scan failed:", error);
  makeNfcActivationAvailable();

  if (error?.name === "NotAllowedError")
  {
    if (userInitiated)
    {
      appState.nfcDenied = true;
      showToast(NFC_MESSAGES.permissionDenied, TOAST_TYPES.ERROR);
    }
    else
    {
      // Some browsers still require a gesture even after reporting a granted
      // permission. Do not incorrectly persist this as a user denial.
      showToast(NFC_MESSAGES.permissionRequired, TOAST_TYPES.INFO);
    }
    return;
  }

  if (error?.name === "NotSupportedError")
  {
    // This error is more informative than a missing API, but still avoid
    // telling conventional desktops that their hardware is unsupported.
    if (isLikelyMobileDevice(navigator))
    {
      showToast(NFC_MESSAGES.adapterUnavailable, TOAST_TYPES.ERROR);
    }
    return;
  }

  if (error?.name === "NotReadableError")
  {
    showToast(NFC_MESSAGES.adapterInaccessible, TOAST_TYPES.ERROR);
    return;
  }

  showToast(NFC_MESSAGES.initializationError, TOAST_TYPES.ERROR);
}

function makeNfcActivationAvailable()
{
  if (elements.activateNfcBtn)
  {
    elements.activateNfcBtn.classList.remove("hidden");
  }
}

function handleNfc(text)
{
  if (!text) return;

  const tag = parseNfcTag(text);
  const eventType = tag.eventType;

  if (!eventType || eventType === null || eventType === "")
  {
    showToast("NFC event type missing.", TOAST_TYPES.ERROR);
    console.warn("NFC eventType missing: ", text);
    return;
  }

  const action = actionMap[eventType];
  if (!action)
  {
    showToast("NFC event type unknown.", TOAST_TYPES.ERROR);
    console.warn("NFC event type unknown: ", text);
    return;
  }

  action(tag);
}

function parseNfcTag(text)
{
  const tag = parseNfcTagText(text);

  lastScannedCourtId = tag.courtId;
  lastScannedDeviceId = tag.deviceId;

  return tag;
}

async function spectateCourtFromNfc()
{

  let courtId = lastScannedCourtId;

  lastScannedCourtId = null;

  if (!courtId || courtId === null || courtId === "")
  {
    showToast("Cannot spectate - no courtId specified.", TOAST_TYPES.ERROR);
    return;
  }

  if (courtId === session.currentCourtId)
  {
    if (!session.isSpectating)
    {
      enableSpectateMode();
      showToast("Switched to spectate mode.", TOAST_TYPES.SUCCESS);
    }
    else
    {
      showToast("Already spectating this court.", TOAST_TYPES.INFO);
    }
    return;
  }

  await enterCourt(courtId, true);
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
