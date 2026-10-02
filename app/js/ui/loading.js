// Loading indicators: the startup and scoreboard overlays (with the delayed
// spinner and minimum spinner duration) and the inline loading overlay.
import { LOADING_SPINNER_MIN_DURATION_MS, LOAD_SPINNER_DELAY_MS } from "../config/constants.js";
import BRAND from "../brand.mjs";
import { themeState } from "../state/themeState.js";
import { elements } from "./dom.js";

let loadingSpinnerStartTime = 0;

let startupLoadingDelayTimer = null;

let scoreboardLoadingDelayTimer = null;

function scheduleLoadingIndicator(overlayEl, onSpinnerShown = null)
{
  if (!overlayEl) return null;

  overlayEl.classList.remove("show-spinner");

  const revealSpinner = () =>
  {
    overlayEl.classList.add("show-spinner");
    if (typeof onSpinnerShown === "function")
    {
      onSpinnerShown();
    }
  };

  if (LOAD_SPINNER_DELAY_MS <= 0)
  {
    revealSpinner();
    return null;
  }

  return window.setTimeout(revealSpinner, LOAD_SPINNER_DELAY_MS);
}

export function beginStartupLoading()
{
  if (!elements.startupLoading) return;

  if (startupLoadingDelayTimer)
  {
    window.clearTimeout(startupLoadingDelayTimer);
    startupLoadingDelayTimer = null;
  }

  elements.startupLoading.classList.remove("hidden");
  startupLoadingDelayTimer = scheduleLoadingIndicator(elements.startupLoading);
}

export function finishStartupLoading()
{
  if (!elements.startupLoading) return;

  if (startupLoadingDelayTimer)
  {
    window.clearTimeout(startupLoadingDelayTimer);
    startupLoadingDelayTimer = null;
  }

  elements.startupLoading.classList.remove("show-spinner");
  elements.startupLoading.classList.add("hidden");
}

export function beginScoreboardLoading()
{
  if (!elements.scoreboardLoading) return;

  if (scoreboardLoadingDelayTimer)
  {
    window.clearTimeout(scoreboardLoadingDelayTimer);
    scoreboardLoadingDelayTimer = null;
  }

  loadingSpinnerStartTime = 0;
  elements.scoreboardLoading.classList.remove("hidden");
  scoreboardLoadingDelayTimer = scheduleLoadingIndicator(elements.scoreboardLoading, () =>
  {
    loadingSpinnerStartTime = Date.now();
  });
}

export function finishScoreboardLoading()
{
  if (!elements.scoreboardLoading) return;

  if (scoreboardLoadingDelayTimer)
  {
    window.clearTimeout(scoreboardLoadingDelayTimer);
    scoreboardLoadingDelayTimer = null;
  }

  const hideOverlay = () =>
  {
    elements.scoreboardLoading.classList.remove("show-spinner");
    elements.scoreboardLoading.classList.add("hidden");
    loadingSpinnerStartTime = 0;
  };

  if (!loadingSpinnerStartTime)
  {
    hideOverlay();
    return;
  }

  const spinnerTimeElapsed = Date.now() - loadingSpinnerStartTime;
  if (spinnerTimeElapsed >= LOADING_SPINNER_MIN_DURATION_MS)
  {
    hideOverlay();
    return;
  }

  window.setTimeout(hideOverlay, LOADING_SPINNER_MIN_DURATION_MS - spinnerTimeElapsed);
}

export async function ensureMinimumLoadingDuration(startedAt)
{
  if (!Number.isFinite(startedAt)) return;

  const elapsed = Date.now() - startedAt;
  const remaining = LOADING_SPINNER_MIN_DURATION_MS - elapsed;
  if (remaining <= 0) return;

  await new Promise(resolve => window.setTimeout(resolve, remaining));
}

export function showSpinner(containerEl, message = "")
{
  if (!containerEl) return;

  let overlay = containerEl.querySelector(":scope > .inline-loading-overlay");

  if (!overlay)
  {
    overlay = document.createElement("div");
    overlay.className = "inline-loading-overlay";
    overlay.innerHTML = `
        <div class="loading-content">
          <div class="spinner-wrapper">
            <img src="/media/logo.svg" alt="${BRAND.name} Logo" class="loading-logo" />
            <div class="spinner"></div>
          </div>
          <div class="loading">${message}</div>
        </div>
      `;

    overlay.style.position = "absolute";
    overlay.style.inset = "0";
    overlay.style.zIndex = "1000";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.background = themeState.isLightMode ? "rgba(255, 255, 255, 0.8)" : "rgba(0, 0, 0, 0.55)";
    overlay.style.backdropFilter = "blur(6px)";
    overlay.style.webkitBackdropFilter = "blur(6px)";

    const computedPosition = window.getComputedStyle(containerEl).position;
    if (computedPosition === "static")
    {
      containerEl.dataset.spinnerOriginalPosition = "static";
      containerEl.style.position = "relative";
    }

    containerEl.appendChild(overlay);
  }

  if (!overlay) return;

  //Make sure we do this for existing overlay as well, in case the theme changed
  overlay.style.background = themeState.isLightMode ? "rgba(255, 255, 255, 0.8)" : "rgba(0, 0, 0, 0.55)";

  overlay.style.display = "flex";
}

export function hideSpinner(containerEl)
{
  if (!containerEl) return;

  const overlay = containerEl.querySelector(":scope > .inline-loading-overlay");
  if (overlay)
  {
    overlay.style.display = "none";
  }
}
