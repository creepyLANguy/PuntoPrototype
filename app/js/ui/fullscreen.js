// Fullscreen toggle and its control state.
import { TOAST_TYPES } from "../config/constants.js";
import { elements } from "./dom.js";
import { syncSettingsTiles } from "./settingsTiles.js";
import { showToast } from "./toast.js";

export function getFullscreenElement()
{
  return document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.msFullscreenElement ||
    null;
}

function isFullscreenSupported()
{
  const target = document.documentElement;
  return Boolean(document.fullscreenEnabled ||
    document.webkitFullscreenEnabled ||
    document.msFullscreenEnabled ||
    target.requestFullscreen ||
    target.webkitRequestFullscreen ||
    target.msRequestFullscreen);
}

export function updateFullscreenButton()
{
  if (!elements.fullscreenBtn) return;

  const isActive = Boolean(getFullscreenElement());
  const label = isActive ? "Exit fullscreen" : "Enter fullscreen";

  elements.fullscreenBtn.textContent = isActive ? "⬚" : "⛶";
  elements.fullscreenBtn.title = label;
  elements.fullscreenBtn.setAttribute("aria-label", label);

  if (elements.fullscreenLabel)
  {
    elements.fullscreenLabel.textContent = isActive ? "Exit full" : "Fullscreen";
  }

  syncSettingsTiles();
}

export async function toggleFullscreen()
{
  if (!isFullscreenSupported())
  {
    showToast("Fullscreen is not supported on this device.", TOAST_TYPES.ERROR);
    return;
  }

  try
  {
    if (getFullscreenElement())
    {
      const exit = document.exitFullscreen ||
        document.webkitExitFullscreen ||
        document.msExitFullscreen;

      if (exit) await Promise.resolve(exit.call(document));
      showToast("Fullscreen off", TOAST_TYPES.INFO);
    }
    else
    {
      const target = document.documentElement;
      const request = target.requestFullscreen ||
        target.webkitRequestFullscreen ||
        target.msRequestFullscreen;

      if (request) await Promise.resolve(request.call(target));
      showToast("Fullscreen on", TOAST_TYPES.INFO);
    }

    updateFullscreenButton();
    syncSettingsTiles();
  }
  catch (error)
  {
    console.warn("Fullscreen toggle failed:", error);
    showToast("Fullscreen could not be changed.", TOAST_TYPES.ERROR);
  }
}

export function registerFullscreenChangeListeners()
{
  ["fullscreenchange", "webkitfullscreenchange", "MSFullscreenChange"].forEach(eventName =>
  {
    document.addEventListener(eventName, () =>
    {
      updateFullscreenButton();
      syncSettingsTiles();
    });
  });
}
