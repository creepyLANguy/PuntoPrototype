// =====================================================
// DEEP LINKING INTEGRATION SNIPPET
// Add this near the top of script.js after imports
// =====================================================

import { initDeepLinking } from "./deeplinking.js";
import { initSharing } from "./sharing.js";

// Initialize deep linking
const deeplinkingAPI = initDeepLinking({
  onSpectateDeeplink: async (courtId) => {
    console.log(`[Deeplink] Spectating court: ${courtId}`);
    await loadAllActiveCourts(false);
    const court = filteredCourts.find(c => c.id === courtId);
    if (court) {
      await enterCourt(courtId, true);
    } else {
      showToast(`Court ${courtId} not found`, TOAST_TYPES.ERROR);
      deeplinkingAPI.navigateToMenu();
    }
  },
  onPlayDeeplink: async (courtId) => {
    console.log(`[Deeplink] Playing court: ${courtId}`);
    elements.menuPage.style.display = "none";
    elements.playPage.style.display = "flex";
    elements.playPasswordSection.style.display = "none";
    selectedPlayCourt = null;
    elements.playCourtSearch.value = "";
    elements.playCourtPassword.value = "";
    elements.playCourtNameError.textContent = "";
    elements.playCourtPasswordError.textContent = "";

    await loadAllActiveCourts();
    
    // Pre-select the court from URL
    const court = allCourts.find(c => c.id === courtId);
    if (court) {
      selectedPlayCourt = courtId;
      elements.playCourtSearch.value = court.name;
      displayPlayCourtList(allCourts);
      
      const courtItem = elements.playCourtList.querySelector(`[data-court-name="${court.name}"]`);
      if (courtItem) {
        courtItem.classList.add("active");
        elements.playPasswordSection.style.display = "block";
        elements.playCourtPassword.focus();
      }
    } else {
      showToast(`Court ${courtId} not found`, TOAST_TYPES.ERROR);
      elements.playCourtNameError.textContent = "Court not found.";
    }
  },
  onMenuDeeplink: () => {
    console.log("[Deeplink] Returning to menu");
    leaveCourt();
  }
});

// Initialize sharing
const sharingAPI = initSharing();

// Store references for use throughout script
window.deeplinkingAPI = deeplinkingAPI;
window.sharingAPI = sharingAPI;

// Handle deep links on initial page load
deeplinkingAPI.handleDeeplink();
