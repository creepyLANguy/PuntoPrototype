// Court reset: the reset modal (#resetModal) and the shallow / full reset actions,
// including the optional password change.
import { playSound } from "../audio/audio.js";
import { SOUND_IDS, TOAST_TYPES } from "../config/constants.js";
import { NAV_PAGES } from "../config/routes.js";
import { resetCourt } from "../firebase/callables.js";
import { stepBackInApp, syncCurrentViewState } from "../routing/history.js";
import { createViewState } from "../routing/viewState.js";
import { session } from "../state/sessionState.js";
import { elements } from "../ui/dom.js";
import { hideSpinner, showSpinner } from "../ui/loading.js";
import { syncSettingsTiles } from "../ui/settingsTiles.js";
import { showToast } from "../ui/toast.js";

// The reset password field is optional: a blank field keeps the current court
// password, any other value replaces it. Returns { valid, password } where a null
// password means "leave the existing password alone".
function readResetPassword()
{
  const newPassword = elements.resetCourtPassword.value.trim();
  elements.resetPasswordError.textContent = "";

  if (!newPassword)
  {
    return { valid: true, password: null };
  }

  if (newPassword.length < 4)
  {
    elements.resetPasswordError.textContent = "Password must be at least 4 characters, or leave it blank to keep the current password.";
    return { valid: false, password: null };
  }

  if (newPassword === session.currentCourtId)
  {
    elements.resetPasswordError.textContent = "Password must be different from court name.";
    return { valid: false, password: null };
  }

  // Re-entering the existing password is not a change, so nobody gets switched
  // to spectate mode.
  if (session.currentCourtPassword !== null && newPassword === session.currentCourtPassword)
  {
    return { valid: true, password: null };
  }

  return { valid: true, password: newPassword };
}

export async function performShallowReset(promptForPassword = false)
{
  if (!session.currentCourtId) return;

  let newPassword = null;
  if (promptForPassword)
  {
    const { valid, password } = readResetPassword();
    if (!valid) return;
    newPassword = password;
  }

  try
  {
    if (newPassword)
    {
      session.pendingLocalPasswordUpdate = newPassword;
    }

    const result = await resetCourt(session.currentCourtId, false, newPassword, false);
    if (newPassword)
    {
      session.currentCourtPassword = newPassword;
    }
    if (Number.isInteger(result?.data?.scoreVersion))
    {
      session.currentScoreVersion = result.data.scoreVersion;
    }
    session.beaconSidesSwapped = false;
    syncSettingsTiles();

    elements.resetCourtPassword.value = "";
    elements.resetModal.classList.add("hidden");
    syncCurrentViewState("replace");
    playSound(SOUND_IDS.START);
    showToast(
      newPassword
        ? "Score reset and password updated. Team and player names kept."
        : "Score reset. Team and player names kept.",
      TOAST_TYPES.SUCCESS
    );
  }
  catch (err)
  {
    session.pendingLocalPasswordUpdate = null;
    console.error("Reset failed:", err);
    showToast("Reset Failed: " + (err.message || "Unknown error"), TOAST_TYPES.ERROR);
  }
}

export function registerResetControls()
{
  elements.shallowResetBtn.addEventListener("click", async () =>
  {
    showSpinner(elements.resetModal);
    await performShallowReset(true);
    hideSpinner(elements.resetModal);
  });

  elements.confirmResetBtn.addEventListener("click", async () =>
  {
    if (!session.currentCourtId) return;
    const { valid, password: newPassword } = readResetPassword();
    if (!valid) return;

    try
    {
      showSpinner(elements.resetModal);

      if (newPassword)
      {
        session.pendingLocalPasswordUpdate = newPassword;
      }
      const result = await resetCourt(session.currentCourtId, true, newPassword, false);
      if (newPassword)
      {
        session.currentCourtPassword = newPassword;
      }
      if (Number.isInteger(result?.data?.scoreVersion))
      {
        session.currentScoreVersion = result.data.scoreVersion;
      }
      session.beaconSidesSwapped = false;
      syncSettingsTiles();

      elements.resetCourtPassword.value = "";
      elements.resetModal.classList.add("hidden");
      syncCurrentViewState("replace");
      playSound(SOUND_IDS.START);
      showToast(
        newPassword
          ? "Full reset complete and password updated. Team and player names restored."
          : "Full reset complete. Team and player names restored.",
        TOAST_TYPES.SUCCESS
      );
    }
    catch (err)
    {
      session.pendingLocalPasswordUpdate = null;
      console.error("Reset failed:", err);
      showToast("Reset Failed: " + (err.message || "Unknown error"), TOAST_TYPES.ERROR);
    }
    finally
    {
      hideSpinner(elements.resetModal);
    }
  });

  elements.cancelResetBtn.addEventListener("click", () =>
  {
    void stepBackInApp(createViewState({
      page: NAV_PAGES.SCOREBOARD,
      courtId: session.currentCourtId,
      spectate: session.isSpectating
    }));
  });

  elements.resetModal.addEventListener("click", (e) =>
  {
    if (e.target === elements.resetModal)
      void stepBackInApp(createViewState({
        page: NAV_PAGES.SCOREBOARD,
        courtId: session.currentCourtId,
        spectate: session.isSpectating
      }));
  });
}

export function openResetModal()
{
  playSound(SOUND_IDS.WARNING);
  elements.resetCourtPassword.value = "";
  elements.resetPasswordError.textContent = "";
  elements.resetModal.classList.remove("hidden");
  elements.resetCourtPassword.focus();
  syncCurrentViewState();
}
