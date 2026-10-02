// Scoring options controls: the settings modal's scoring selects and the shared
// rule that disables deuce / tiebreak controls outside games-and-sets scoring.
import { DEFAULT_SCORING_OPTIONS, SCORING_LABELS, TOAST_TYPES } from "../config/constants.js";
import { updateScoringOptions } from "../firebase/callables.js";
import { areScoringOptionsEqual, normalizeScoringOptions, resolveScoringOptions } from "./options.js";
import { updateUI } from "./scoreboard.js";
import { invalidateMatchDetailsCache, session } from "../state/sessionState.js";
import { elements } from "../ui/dom.js";
import { showToast } from "../ui/toast.js";

// Deuce and tiebreak rules only apply to games-and-sets scoring; explicitly
// mark those controls as not applicable whenever another scoring format is selected.
export function syncCourtScoringRuleControlsDisabled(scoringSelect, deuceSelect, tiebreakSelect)
{
  if (!scoringSelect) return;

  const disabled = scoringSelect.value !== "standard";
  const controlledSelects = [deuceSelect, tiebreakSelect].filter(Boolean);

  controlledSelects.forEach(select =>
  {
    select.disabled = disabled;

    const field = select.closest(".scoring-field, .form-group");
    if (field)
    {
      field.classList.toggle("is-disabled", disabled);
      field.setAttribute("aria-disabled", String(disabled));
    }
  });
}

export function registerCourtScoringRuleControls()
{
  if (elements.courtScoringMode)
  {
    elements.courtScoringMode.addEventListener("change", () =>
      syncCourtScoringRuleControlsDisabled(
        elements.courtScoringMode,
        elements.courtDeuceMode,
        elements.courtTiebreakMode
      ));
    syncCourtScoringRuleControlsDisabled(
      elements.courtScoringMode,
      elements.courtDeuceMode,
      elements.courtTiebreakMode
    );
  }

  if (elements.editCourtScoringMode)
  {
    elements.editCourtScoringMode.addEventListener("change", () =>
      syncCourtScoringRuleControlsDisabled(
        elements.editCourtScoringMode,
        elements.editCourtDeuceMode,
        elements.editCourtTiebreakMode
      ));

    syncCourtScoringRuleControlsDisabled(
      elements.editCourtScoringMode,
      elements.editCourtDeuceMode,
      elements.editCourtTiebreakMode
    );
  }
}

let isSyncingScoringControls = false;

export function syncScoringControls()
{
  isSyncingScoringControls = true;
  const options = resolveScoringOptions(session.score);

  if (elements.scoringModeSelect) elements.scoringModeSelect.value = options.scoringMode;
  if (elements.deuceModeSelect) elements.deuceModeSelect.value = options.deuceMode;
  if (elements.tiebreakModeSelect) elements.tiebreakModeSelect.value = options.tiebreakMode;

  const standardFormat = options.scoringMode === "standard";
  [elements.scoringModeSelect, elements.deuceModeSelect, elements.tiebreakModeSelect].forEach(select =>
  {
    if (select) select.disabled = session.isSpectating || !session.currentCourtId;
  });

  if (elements.deuceModeSelect) elements.deuceModeSelect.disabled = session.isSpectating || !session.currentCourtId || !standardFormat;
  if (elements.tiebreakModeSelect) elements.tiebreakModeSelect.disabled = session.isSpectating || !session.currentCourtId || !standardFormat;

  if (elements.scoringStatus)
  {
    if (session.isSpectating)
    {
      elements.scoringStatus.textContent = "Spectating";
    }
    else if (options.scoringMode === "straight")
    {
      elements.scoringStatus.textContent = "Running point totals";
    }
    else if (options.scoringMode === "tiebreakTen")
    {
      elements.scoringStatus.textContent = "Single 10-point tiebreak";
    }
    else
    {
      elements.scoringStatus.textContent = `${SCORING_LABELS[options.deuceMode]}, ${SCORING_LABELS[options.tiebreakMode]}`;
    }
  }

  isSyncingScoringControls = false;
}

function readScoringControls()
{
  const scoringMode = elements.scoringModeSelect?.value || DEFAULT_SCORING_OPTIONS.scoringMode;
  const standardFormat = scoringMode === "standard";

  return normalizeScoringOptions({
    scoringMode,
    deuceMode: standardFormat ? elements.deuceModeSelect?.value : DEFAULT_SCORING_OPTIONS.deuceMode,
    tiebreakMode: standardFormat ? elements.tiebreakModeSelect?.value : DEFAULT_SCORING_OPTIONS.tiebreakMode
  });
}

async function saveScoringOptionsFromSettings()
{
  if (isSyncingScoringControls || session.isSpectating || !session.currentCourtId) return;

  const nextOptions = readScoringControls();
  if (areScoringOptionsEqual(nextOptions, session.currentScoringOptions)) return;

  try
  {
    if (elements.scoringStatus) elements.scoringStatus.textContent = "Recalculating...";
    [elements.scoringModeSelect, elements.deuceModeSelect, elements.tiebreakModeSelect].forEach(select =>
    {
      if (select) select.disabled = true;
    });

    const result = await updateScoringOptions({
      courtId: session.currentCourtId,
      scoringOptions: nextOptions,
      scoringMode: nextOptions.scoringMode
    });

    const serverOptions = normalizeScoringOptions(result?.data?.scoringOptions || nextOptions);
    session.currentScoringOptions = serverOptions;

    // Apply the freshly replayed score returned by the Cloud Function
    // directly, instead of relying on the local `score` variable. The local
    // copy is only updated by the onSnapshot pipeline, so rendering it here
    // races the WebSocket delivery and can show a stale score.
    const serverScore = result?.data?.score;
    if (serverScore && serverScore.A && serverScore.B)
    {
      session.score = serverScore;
      invalidateMatchDetailsCache();
    }

    syncScoringControls();
    updateUI();
    showToast("Scoring updated", TOAST_TYPES.SUCCESS);
  }
  catch (err)
  {
    console.error("Scoring update failed:", err);
    showToast("Scoring update failed: " + (err.message || "Unknown error"), TOAST_TYPES.ERROR);
    syncScoringControls();
  }
}

export function registerScoringOptionControls()
{
  [elements.scoringModeSelect, elements.deuceModeSelect, elements.tiebreakModeSelect].forEach(select =>
  {
    if (!select) return;
    select.addEventListener("change", saveScoringOptionsFromSettings);
  });
}
