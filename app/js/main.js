// Composition root of the scoring app.
//
// This module owns no behaviour of its own. It wires the feature modules
// together and starts them, in a fixed order:
//
//   1. module evaluation: Firebase is initialised (firebase/client.js), the
//      changeover behaviour is installed and the document-level input guards
//      are registered;
//   2. DOMContentLoaded: application state is read from storage, the DOM is
//      looked up, feature modules register their listeners and the router
//      restores the view for the current URL.
//
// Ordering contract: the sequence below preserves, exactly, the order in which
// the former monolithic script.js
//   - registered listeners on shared targets (document, window, visualViewport),
//   - created MutationObserver / ResizeObserver instances, and
//   - performed DOM mutations and initialisation calls.
// Listener order on a shared target decides which handler runs first, and an
// observer only sees mutations made after it starts observing, so do not
// reorder these calls without checking both. Listeners on elements that no
// other module listens to are grouped per feature; their order is immaterial.
import { initAdminSession } from "./state/adminSessionState.js";
import { initThemeState } from "./state/themeState.js";
import { initDeviceIdentity, updateMobileDeviceClass } from "./lifecycle/deviceIdentity.js";

import { initElements } from "./ui/dom.js";
import { initializeTheme } from "./ui/theme.js";
import {
  initTeamColourPickerTracking,
  initializeWaves,
  registerAppearanceControls,
  registerAppearanceMenuDismissal,
  registerWaveToggleButtons
} from "./ui/appearance.js";
import { registerFullscreenChangeListeners, updateFullscreenButton } from "./ui/fullscreen.js";
import { beginStartupLoading } from "./ui/loading.js";
import { registerEnterKeySubmit } from "./ui/forms.js";
import { registerGlobalButtonVisibility } from "./ui/navigation.js";
import {
  registerInputTapFixes,
  registerMobileInputAutoScroll,
  registerSelectionGuards
} from "./ui/inputBehaviour.js";
import { initToastContainerPositionObservers } from "./ui/toast.js";

import { bindViewController } from "./routing/history.js";
import { getCurrentViewState, restoreViewState } from "./routing/viewController.js";
import {
  initializeAppNavigation,
  registerEscapeKeyNavigation,
  registerHistoryNavigation
} from "./routing/router.js";

import { installChangeover, registerChangeoverStateListeners } from "./scoring/changeover.js";
import { updateUI } from "./scoring/scoreboard.js";
import { registerCourtScoringRuleControls, registerScoringOptionControls } from "./scoring/settings.js";
import { registerResetControls } from "./scoring/reset.js";

import { registerCourtListenerResume } from "./court/courtSync.js";
import { registerCourtSearch } from "./court/courtLists.js";
import { registerPlayAndSpectatePages } from "./court/playJoin.js";

import { registerPlayerNamesModal } from "./teams/playerNamesModal.js";
import { registerAdvancedStatsResize } from "./details/advancedStats.js";
import { registerMatchDetailsControls } from "./details/matchDetails.js";
import { registerShareButtons } from "./sharing/share.js";

import { initCourtQrLogoImage } from "./qr/courtQr.js";
import { initializeCourtQrPanelInteractions } from "./qr/qrPanelInteractions.js";
import { initializeCourtQrResizeHandleVisibility } from "./qr/qrHandleVisibility.js";

import { initNfc, registerNfcActivation } from "./nfc/nfc.js";

import { registerAdminPortal, registerAdminTabs } from "./admin/admin.js";
import {
  registerAdminCourtEditor,
  registerAdminCourtFilters,
  registerCreateCourt
} from "./admin/courts.js";
import { registerDeviceAdmin } from "./admin/devices.js";

import { registerHotkeys } from "./shell/hotkeys.js";
import { registerScoreboardControls } from "./shell/scoreboardControls.js";
import { registerSettingsModal } from "./shell/settingsModal.js";
import { registerViewportLayout } from "./shell/viewportResize.js";

// Routing records navigation through the view controller, which depends on
// the features; binding it here keeps the import graph acyclic.
bindViewController({ getCurrentViewState, restoreViewState });

// ---------------------------------------------------------------------------
// 1. Module evaluation
// ---------------------------------------------------------------------------

installChangeover();

document.addEventListener("DOMContentLoaded", startApplication);

registerSelectionGuards();
registerMobileInputAutoScroll();

// ---------------------------------------------------------------------------
// 2. DOMContentLoaded
// ---------------------------------------------------------------------------

function startApplication()
{
  // State
  registerChangeoverStateListeners();
  initAdminSession();
  initDeviceIdentity();
  updateMobileDeviceClass();
  initCourtQrLogoImage();
  initThemeState();
  initTeamColourPickerTracking();

  // DOM
  initElements();
  initializeCourtQrPanelInteractions();
  initializeCourtQrResizeHandleVisibility();
  registerAdvancedStatsResize();

  // Theme, startup loading and the initial route
  initializeTheme();
  initializeWaves();
  updateFullscreenButton();
  beginStartupLoading();
  void initializeAppNavigation();

  // Feature modules
  registerFullscreenChangeListeners();
  registerEnterKeySubmit();
  registerCourtScoringRuleControls();
  registerAdminCourtFilters();
  registerEscapeKeyNavigation();
  registerHotkeys();
  registerHistoryNavigation();
  registerAdminCourtEditor();
  registerAdminPortal();
  registerNfcActivation();
  registerCreateCourt();
  registerPlayAndSpectatePages();
  registerGlobalButtonVisibility();
  registerAppearanceControls();
  registerInputTapFixes();
  registerAppearanceMenuDismissal();
  registerWaveToggleButtons();
  registerCourtSearch();
  registerResetControls();
  registerScoreboardControls();
  registerPlayerNamesModal();
  registerSettingsModal();
  registerScoringOptionControls();
  registerMatchDetailsControls();
  registerShareButtons();
  registerViewportLayout();

  // Lifecycle
  initToastContainerPositionObservers();
  updateUI();
  initNfc();
  registerCourtListenerResume();
  registerAdminTabs();
  registerDeviceAdmin();
}
