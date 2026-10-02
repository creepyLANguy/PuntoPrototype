// NFC tag scanning (Web NFC): reader lifecycle, scan cooldown and dispatch of
// tag events to the scoring, court and device-registration actions. The tag
// format itself is parsed by nfc/parser.js.
import { COOLDOWN_MS, EVENT_TYPES, TOAST_TYPES } from "../config/constants.js";
import { enableSpectateMode, enterCourt } from "../court/session.js";
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
    await initNfc();
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

export async function initNfc()
{
  if (nfcInitialized) return;

  // Check NFC support
  if (!("NDEFReader" in window))
  {
    showToast("NFC is not supported on this device.", TOAST_TYPES.ERROR);
    return;
  }

  try
  {
    nfcReader = new NDEFReader();
    await nfcReader.scan();
    nfcInitialized = true;
    appState.nfcDenied = false;
    elements.activateNfcBtn.classList.add("hidden");

    console.log("NFC scanning started.");

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

  }
  catch (error)
  {
    if (error.name === "NotAllowedError")
    {
      showToast("NFC permission denied.", TOAST_TYPES.ERROR);
      appState.nfcDenied = true;
      elements.activateNfcBtn.classList.remove("hidden");
    } else if (error.name === "NotSupportedError")
    {
      showToast("NFC not available on this device.", TOAST_TYPES.ERROR);
    } else
    {
      showToast("NFC Error: Failed to initialize scanning.", TOAST_TYPES.ERROR);
    }
    console.error("NFC scan failed:", error);
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
