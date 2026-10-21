// Viewport layout upkeep: fits text, the marquee, toasts, the QR panel and the
// court-list fades whenever the window is resized.
import { syncCourtListFadeState } from "../court/courtLists.js";
import { clampCourtQrPanelToViewport } from "../qr/courtQr.js";
import { qrState } from "../qr/qrState.js";
import { fitTextToContainer, updateMarqueeScrolling } from "../scoring/scoreboard.js";
import { elements } from "../ui/dom.js";
import { updateToastContainerPosition } from "../ui/toast.js";
import { syncSettingsTiles } from "../ui/settingsTiles.js";

let qrPanelAvailabilityObserver = null;

export function registerViewportLayout()
{
  document.querySelectorAll(".team-name").forEach((nameEl) =>
  {
    const labelEl = nameEl.querySelector(".name-text");
    if (!labelEl) return;

    fitTextToContainer(labelEl);
  });

  window.addEventListener("resize", () =>
  {
    document.querySelectorAll(".team-name .name-text")
      .forEach(fitTextToContainer);
    updateMarqueeScrolling();
    updateToastContainerPosition();
    clampCourtQrPanelToViewport();
    qrState.refreshCourtQrResizeHandleVisibility?.();
    syncCourtListFadeState(elements.playCourtList);
    syncCourtListFadeState(elements.spectateCourtList);
    syncSettingsTiles();
  });

  // ResizeObserver catches changes to the scoreboard bounds that do not come
  // from a window resize, including dynamic viewport and orientation changes.
  if (!qrPanelAvailabilityObserver && typeof window.ResizeObserver === "function" && elements.scoreboardPage) {
    qrPanelAvailabilityObserver = new window.ResizeObserver(() => syncSettingsTiles());
    qrPanelAvailabilityObserver.observe(elements.scoreboardPage);
  }

  window.visualViewport?.addEventListener("resize", () => syncSettingsTiles(), { passive: true });
}
