// Player / team names modal (#playerNamesModal): editing and saving the open
// court's team and player names.
import { TOAST_TYPES } from "../config/constants.js";
import { updateCourt } from "../firebase/courtRepository.js";
import { syncCurrentViewState } from "../routing/history.js";
import { applyTeamNamesToScoreboard } from "../scoring/scoreboard.js";
import { updateServerIndicator } from "../scoring/serverIndicator.js";
import { session } from "../state/sessionState.js";
import { normalizePlayerNames } from "./playerNames.js";
import { normalizeTeamNames, resolvePersistedTeamNames, resolveTeamNames } from "./teamNames.js";
import { elements } from "../ui/dom.js";
import { showToast } from "../ui/toast.js";

export function openPlayerNamesModal()
{
  const existingPlayers = normalizePlayerNames(session.currentPlayerNames);
  const existingTeams = normalizeTeamNames(session.currentRawTeamNames);

  elements.playerTeamAName.value = existingTeams.A;
  elements.playerTeamBName.value = existingTeams.B;
  elements.playerNameA1.value = existingPlayers.A1;
  elements.playerNameA2.value = existingPlayers.A2;
  elements.playerNameB1.value = existingPlayers.B1;
  elements.playerNameB2.value = existingPlayers.B2;
  elements.settingsModal.classList.add("hidden");
  elements.playerNamesModal.classList.remove("hidden");
  elements.playerTeamAName.focus();
  syncCurrentViewState();
}

function closePlayerNamesModal()
{
  elements.playerNamesModal.classList.add("hidden");
  elements.settingsModal.classList.remove("hidden");
  syncCurrentViewState();
}

async function savePlayerNamesFromModal()
{
  if (!session.currentCourtId)
  {
    showToast("No court is currently open.", TOAST_TYPES.ERROR);
    return;
  }

  const nextTeamNames = normalizeTeamNames({
    A: elements.playerTeamAName.value.trim(),
    B: elements.playerTeamBName.value.trim()
  });
  const nextPlayerNames = normalizePlayerNames({
    A1: elements.playerNameA1.value.trim(),
    A2: elements.playerNameA2.value.trim(),
    B1: elements.playerNameB1.value.trim(),
    B2: elements.playerNameB2.value.trim()
  });
  const derivedTeamNames = resolvePersistedTeamNames(nextTeamNames, nextPlayerNames);

  try
  {
    await updateCourt(session.currentCourtId, {
      playerNames: nextPlayerNames,
      teamNames: derivedTeamNames
    });

    session.currentPlayerNames = normalizePlayerNames(nextPlayerNames);
    session.currentRawTeamNames = normalizeTeamNames(derivedTeamNames);
    applyTeamNamesToScoreboard(resolveTeamNames(session.currentRawTeamNames, session.currentPlayerNames));
    updateServerIndicator();
    elements.playerNamesModal.classList.add("hidden");
    elements.settingsModal.classList.remove("hidden");
    showToast("Player/Team names updated.", TOAST_TYPES.SUCCESS);
  }
  catch (error)
  {
    console.error("Error updating player names:", error);
    showToast("Failed to update player names.", TOAST_TYPES.ERROR);
  }
}

export function registerPlayerNamesModal()
{
  if (elements.playerNamesForm)
  {
    elements.playerNamesForm.addEventListener("submit", (e) =>
    {
      e.preventDefault();
      void savePlayerNamesFromModal();
    });
  }

  if (elements.closePlayerNamesBtn)
  {
    elements.closePlayerNamesBtn.addEventListener("click", closePlayerNamesModal);
  }

  if (elements.cancelPlayerNamesBtn)
  {
    elements.cancelPlayerNamesBtn.addEventListener("click", closePlayerNamesModal);
  }

  if (elements.playerNamesModal)
  {
    elements.playerNamesModal.addEventListener("click", (e) =>
    {
      if (e.target === elements.playerNamesModal)
      {
        closePlayerNamesModal();
      }
    });
  }
}
