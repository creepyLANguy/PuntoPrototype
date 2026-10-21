// Court QR visibility action in the Options modal. This shell module bridges
// the QR feature to the settings UI without making the shared UI layer depend
// on the QR feature itself.
import {
  canShowCourtQrPanel,
  isCourtQrPanelVisible,
  toggleCourtQrPanel,
} from "../qr/courtQr.js";
import { elements } from "../ui/dom.js";

export function syncCourtQrOptionsTile()
{
  const button = elements.courtQrToggleBtn;
  if (!button) return;

  const tile = button.closest(".setting-item");
  const available = canShowCourtQrPanel();
  const visible = isCourtQrPanelVisible();
  const actionLabel = visible ? "Hide QR" : "Show QR";

  button.disabled = !available;
  button.setAttribute("aria-disabled", String(!available));
  button.setAttribute("aria-pressed", String(visible));
  button.setAttribute(
    "aria-label",
    available
      ? actionLabel + " panel"
      : actionLabel + " panel (unavailable at this screen size)",
  );
  button.title = available
    ? actionLabel + " panel"
    : "QR panel is unavailable at this screen size";

  if (tile) {
    tile.classList.toggle("active", available && visible);
    tile.classList.toggle("qr-unavailable", !available);
    const label = tile.querySelector(":scope > span");
    if (label) label.textContent = actionLabel;
  }
}

export function registerCourtQrOptionsControl()
{
  if (!elements.courtQrToggleBtn) return;

  elements.courtQrToggleBtn.addEventListener("click", () => {
    toggleCourtQrPanel();
    syncCourtQrOptionsTile();
  });

  syncCourtQrOptionsTile();
}
