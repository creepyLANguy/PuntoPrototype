// Global navigation buttons (home, admin, appearance) shown only on the menu page.
import { closeAppearanceMenu, updateWavesVisibility } from "./appearance.js";
import { elements } from "./dom.js";

function updateAdminButtonVisibility()
{
  const isMenuVisible = elements.menuPage && window.getComputedStyle(elements.menuPage).display !== "none";
  if (elements.homeLinkBtn)
  {
    const currentVal = elements.homeLinkBtn.style.display;
    const targetVal = isMenuVisible ? "flex" : "none";
    if (currentVal !== targetVal)
    {
      elements.homeLinkBtn.style.display = targetVal;
    }
  }

  if (elements.adminLoginBtn)
  {
    const currentVal = elements.adminLoginBtn.style.display;
    const targetVal = isMenuVisible ? "flex" : "none";
    if (currentVal !== targetVal)
    {
      elements.adminLoginBtn.style.display = targetVal;
    }
  }

  if (elements.appearanceMenuBtn)
  {
    const currentVal = elements.appearanceMenuBtn.style.display;
    const targetVal = isMenuVisible ? "flex" : "none";
    if (currentVal !== targetVal)
    {
      if (targetVal === "none") closeAppearanceMenu();
      elements.appearanceMenuBtn.style.display = targetVal;
    }
  }

  updateWavesVisibility();
}

export function registerGlobalButtonVisibility()
{
  // Watch for page changes to toggle admin button
  const observer = new MutationObserver(() => updateAdminButtonVisibility());
  observer.observe(document.body, { attributes: true, childList: true, subtree: true });
}
