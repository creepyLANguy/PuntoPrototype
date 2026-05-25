// =====================================================
// SHARE BUTTON INTEGRATION
// Add this in the HTML elements section or call after enterCourt()
// =====================================================

function initializeShareButtons() {
  // Add share button to scoreboard sidebar
  const sidebarLeft = document.querySelector(".sidebar-left");
  if (sidebarLeft && !document.getElementById("shareCourtBtn")) {
    const shareBtn = document.createElement("button");
    shareBtn.id = "shareCourtBtn";
    shareBtn.className = "floating-btn";
    shareBtn.title = "Share court link";
    shareBtn.setAttribute("aria-label", "Share court link");
    shareBtn.textContent = "📤";
    shareBtn.addEventListener("click", handleShareCourt);
    sidebarLeft.appendChild(shareBtn);
  }

  // Add share button to match details modal
  const dmBox = document.querySelector(".dm-box");
  if (dmBox && !dmBox.querySelector("#shareDetailsBtn")) {
    const shareDetailsBtn = document.createElement("button");
    shareDetailsBtn.id = "shareDetailsBtn";
    shareDetailsBtn.className = "floating-btn";
    shareDetailsBtn.style.position = "absolute";
    shareDetailsBtn.style.top = "10px";
    shareDetailsBtn.style.right = "50px";
    shareDetailsBtn.title = "Share match details";
    shareDetailsBtn.setAttribute("aria-label", "Share match details as image");
    shareDetailsBtn.textContent = "📸";
    shareDetailsBtn.addEventListener("click", handleShareDetails);
    dmBox.appendChild(shareDetailsBtn);
  }
}

async function handleShareCourt() {
  if (!currentCourtId) {
    sharingAPI.showToast("No court selected", TOAST_TYPES.WARNING);
    return;
  }

  const mode = isSpectating ? "spectate" : "play";
  const courtName = document.querySelector("#courtTitle")?.textContent || "Court";
  
  await sharingAPI.shareCourtLink(currentCourtId, courtName, mode);
}

async function handleShareDetails() {
  if (!currentCourtId) {
    sharingAPI.showToast("No court selected", TOAST_TYPES.WARNING);
    return;
  }

  const dmBox = document.querySelector(".dm-box");
  if (!dmBox) {
    sharingAPI.showToast("Details not available", TOAST_TYPES.WARNING);
    return;
  }

  const courtName = document.querySelector("#courtTitle")?.textContent || "Court";
  await sharingAPI.shareScoreDetailsImage(dmBox, courtName);
}

// Call this function after entering a court
function onEnterCourtUI() {
  setTimeout(initializeShareButtons, 100);
}

// Export for use in main script
window.initializeShareButtons = initializeShareButtons;
window.handleShareCourt = handleShareCourt;
window.handleShareDetails = handleShareDetails;
window.onEnterCourtUI = onEnterCourtUI;
