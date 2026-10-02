// Toast notifications (#toastContainer) and keeping them clear of the floating
// controls.
import { TOAST_DURATION_MS, TOAST_TYPES } from "../config/constants.js";

let toastPositionFrame = null;

let toastPositionObserversInitialized = false;

let toastPositionResizeObserver = null;

let toastPositionMutationObserver = null;

function scheduleToastContainerPositionUpdate()
{
  if (toastPositionFrame !== null) return;

  const requestFrame = window.requestAnimationFrame || ((callback) => window.setTimeout(callback, 0));
  toastPositionFrame = requestFrame(() =>
  {
    toastPositionFrame = null;
    updateToastContainerPosition();
  });
}

export function initToastContainerPositionObservers()
{
  if (toastPositionObserversInitialized) return;
  toastPositionObserversInitialized = true;

  const scoreboardBody = document.querySelector(".scoreboard-body");
  const scoreboardPage = document.getElementById("scoreboardPage");
  const floatingControls = document.querySelector(".floating-controls");

  if (typeof window.ResizeObserver === "function")
  {
    toastPositionResizeObserver = new window.ResizeObserver(() =>
    {
      scheduleToastContainerPositionUpdate();
    });

    [scoreboardPage, scoreboardBody, floatingControls]
      .filter(Boolean)
      .forEach((element) => toastPositionResizeObserver.observe(element));
  }

  if (typeof window.MutationObserver === "function")
  {
    toastPositionMutationObserver = new window.MutationObserver(() =>
    {
      scheduleToastContainerPositionUpdate();
    });

    if (scoreboardPage)
    {
      toastPositionMutationObserver.observe(scoreboardPage,
      {
        attributes: true,
        attributeFilter: ["class", "style"],
      });
    }

    if (scoreboardBody)
    {
      toastPositionMutationObserver.observe(scoreboardBody,
      {
        attributes: true,
        attributeFilter: ["class", "style"],
        childList: true,
        subtree: true,
      });
    }
  }

  scheduleToastContainerPositionUpdate();
}

export function updateToastContainerPosition()
{
  const container = document.getElementById("toastContainer");
  if (!container) return;

  container.style.removeProperty("--toast-bottom-offset");
  container.style.removeProperty("--toast-right-offset");

  const controls = document.querySelector(".floating-controls");
  if (!controls)
  {
    return;
  }

  const rect = controls.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0)
  {
    return;
  }

  const gap = 16;

  if (rect.width >= rect.height)
  {
    const bottomOffset = Math.max(gap, window.innerHeight - rect.top + gap);
    container.style.setProperty("--toast-bottom-offset", `${bottomOffset}px`);
    return;
  }

  const rightOffset = Math.max(gap, window.innerWidth - rect.left + gap);
  container.style.setProperty("--toast-right-offset", `${rightOffset}px`);
}

export function showToast(message, toastType = TOAST_TYPES.SUCCESS)
{
  const container = document.getElementById("toastContainer");
  if (!container) return;

  updateToastContainerPosition();

  const toast = document.createElement("div");
  toast.className = `toast ${toastType}`;
  toast.textContent = message;

  container.appendChild(toast);

  setTimeout(() =>
  {
    toast.remove();
  }, TOAST_DURATION_MS);
}

// Appends a typed toast without recalculating the container position. This is
// the path changeover feedback has always used.
export function appendToast(message, toastType = TOAST_TYPES.SUCCESS)
{
  const container = document.getElementById("toastContainer");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast ${toastType}`;
  toast.textContent = message;
  container.appendChild(toast);

  window.setTimeout(() => toast.remove(), TOAST_DURATION_MS);
}
