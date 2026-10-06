// Scoring options controls: the settings modal's scoring selects and the shared
// rule that disables deuce / tiebreak controls outside games-and-sets scoring.
import {
  DEFAULT_FIXED_TOTAL_POINTS,
  DEFAULT_SCORING_OPTIONS,
  SCORING_LABELS,
  TOAST_TYPES,
} from "../config/constants.js";
import { updateScoringOptions } from "../firebase/callables.js";
import {
  areScoringOptionsEqual,
  normalizeScoringOptions,
  resolveScoringOptions,
} from "./options.js";
import { updateUI } from "./scoreboard.js";
import { getCourtCredentials } from "../state/credentialsState.js";
import { invalidateMatchDetailsCache, session } from "../state/sessionState.js";
import { elements } from "../ui/dom.js";
import { showToast } from "../ui/toast.js";

// Deuce and tiebreak rules only apply to games-and-sets scoring; explicitly
// mark those controls as not applicable whenever another scoring format is selected.
export function syncCourtScoringRuleControlsDisabled(
  scoringSelect,
  deuceSelect,
  tiebreakSelect,
  fixedControls = [],
) {
  if (!scoringSelect) return;

  const disabled = scoringSelect.value !== "standard";
  const fixedDisabled = scoringSelect.value !== "fixedTotalPoints";
  const controlledSelects = [deuceSelect, tiebreakSelect].filter(Boolean);

  controlledSelects.forEach((select) => {
    select.disabled = disabled;

    const field = select.closest(".scoring-field, .form-group");
    if (field) {
      field.classList.toggle("is-disabled", disabled);
      field.setAttribute("aria-disabled", String(disabled));
    }
  });

  fixedControls.filter(Boolean).forEach((control) => {
    control.disabled = fixedDisabled;
    const field = control.closest(".scoring-field, .form-group");
    if (field) {
      field.classList.toggle("is-disabled", fixedDisabled);
      field.setAttribute("aria-disabled", String(fixedDisabled));
    }
  });

  const fixedGroup = fixedControls.find(Boolean)?.closest(".fixed-scoring-options");
  if (fixedGroup) {
    fixedGroup.classList.toggle("hidden", fixedDisabled);
  }
}

export function registerCourtScoringRuleControls() {
  if (elements.courtScoringMode) {
    elements.courtScoringMode.addEventListener("change", () =>
      syncCourtScoringRuleControlsDisabled(
        elements.courtScoringMode,
        elements.courtDeuceMode,
        elements.courtTiebreakMode,
        [
          elements.courtFixedPointsTarget,
          elements.courtFixedServeOrder,
          elements.courtFixedServesPerPlayer,
          elements.courtFixedServeBlockLength,
          elements.courtFixedSideSwapRule,
          elements.courtFixedTieResolution,
        ],
      ),
    );
    syncCourtScoringRuleControlsDisabled(
      elements.courtScoringMode,
      elements.courtDeuceMode,
      elements.courtTiebreakMode,
      [
        elements.courtFixedPointsTarget,
        elements.courtFixedServeOrder,
        elements.courtFixedServesPerPlayer,
        elements.courtFixedServeBlockLength,
        elements.courtFixedSideSwapRule,
        elements.courtFixedTieResolution,
      ],
    );
  }

  if (elements.editCourtScoringMode) {
    elements.editCourtScoringMode.addEventListener("change", () =>
      syncCourtScoringRuleControlsDisabled(
        elements.editCourtScoringMode,
        elements.editCourtDeuceMode,
        elements.editCourtTiebreakMode,
        [
          elements.editCourtFixedPointsTarget,
          elements.editCourtFixedServeOrder,
          elements.editCourtFixedServesPerPlayer,
          elements.editCourtFixedServeBlockLength,
          elements.editCourtFixedSideSwapRule,
          elements.editCourtFixedTieResolution,
        ],
      ),
    );

    syncCourtScoringRuleControlsDisabled(
      elements.editCourtScoringMode,
      elements.editCourtDeuceMode,
      elements.editCourtTiebreakMode,
      [
        elements.editCourtFixedPointsTarget,
        elements.editCourtFixedServeOrder,
        elements.editCourtFixedServesPerPlayer,
        elements.editCourtFixedServeBlockLength,
        elements.editCourtFixedSideSwapRule,
        elements.editCourtFixedTieResolution,
      ],
    );
  }
}

let isSyncingScoringControls = false;

export function syncScoringControls() {
  isSyncingScoringControls = true;
  const options = resolveScoringOptions(session.score);

  if (elements.scoringModeSelect)
    elements.scoringModeSelect.value = options.scoringMode;
  if (elements.deuceModeSelect)
    elements.deuceModeSelect.value = options.deuceMode;
  if (elements.tiebreakModeSelect)
    elements.tiebreakModeSelect.value = options.tiebreakMode;

  if (elements.fixedPointsTargetInput)
    elements.fixedPointsTargetInput.value = options.pointsTarget ?? DEFAULT_FIXED_TOTAL_POINTS.pointsTarget;
  if (elements.fixedServeOrderInput)
    elements.fixedServeOrderInput.value = (options.serving?.order || DEFAULT_FIXED_TOTAL_POINTS.serving.order).join(", ");
  if (elements.fixedServesPerPlayerInput)
    elements.fixedServesPerPlayerInput.value = options.serving?.servesPerPlayer ?? DEFAULT_FIXED_TOTAL_POINTS.serving.servesPerPlayer;
  if (elements.fixedServeBlockLengthInput)
    elements.fixedServeBlockLengthInput.value = options.serving?.serveBlockLength ?? DEFAULT_FIXED_TOTAL_POINTS.serving.serveBlockLength;
  if (elements.fixedSideSwapRuleSelect)
    elements.fixedSideSwapRuleSelect.value = options.serving?.sideSwapRule ?? DEFAULT_FIXED_TOTAL_POINTS.serving.sideSwapRule;
  if (elements.fixedTieResolutionSelect)
    elements.fixedTieResolutionSelect.value = options.completion?.tieResolution ?? DEFAULT_FIXED_TOTAL_POINTS.completion.tieResolution;

  const standardFormat = options.scoringMode === "standard";
  const fixedFormat = options.scoringMode === "fixedTotalPoints";
  // Tournament matches carry a snapshotted rule set that cannot change.
  const locked =
    session.isSpectating ||
    !session.currentCourtId ||
    Boolean(session.currentTournamentId);
  [
    elements.scoringModeSelect,
    elements.deuceModeSelect,
    elements.tiebreakModeSelect,
    elements.fixedPointsTargetInput,
    elements.fixedServeOrderInput,
    elements.fixedServesPerPlayerInput,
    elements.fixedServeBlockLengthInput,
    elements.fixedSideSwapRuleSelect,
    elements.fixedTieResolutionSelect,
  ].forEach((select) => {
    if (select) select.disabled = locked;
  });

  if (elements.deuceModeSelect)
    elements.deuceModeSelect.disabled = locked || !standardFormat;
  if (elements.tiebreakModeSelect)
    elements.tiebreakModeSelect.disabled = locked || !standardFormat;

  const fixedControls = [
    elements.fixedPointsTargetInput,
    elements.fixedServeOrderInput,
    elements.fixedServesPerPlayerInput,
    elements.fixedServeBlockLengthInput,
    elements.fixedSideSwapRuleSelect,
    elements.fixedTieResolutionSelect,
  ].filter(Boolean);

  fixedControls.forEach((control) => {
    control.disabled = locked || !fixedFormat;
  });
  if (elements.fixedScoringOptions) {
    elements.fixedScoringOptions.classList.toggle("hidden", !fixedFormat);
  }

  if (elements.scoringStatus) {
    if (session.isSpectating) {
      elements.scoringStatus.textContent = "Spectating";
    } else if (options.scoringMode === "fixedTotalPoints") {
      elements.scoringStatus.textContent = `${options.pointsTarget} total points - tournament rules`;
    } else if (session.currentTournamentId) {
      elements.scoringStatus.textContent = "Tournament rules";
    } else if (options.scoringMode === "straight") {
      elements.scoringStatus.textContent = "Running point totals";
    } else if (options.scoringMode === "tiebreakTen") {
      elements.scoringStatus.textContent = "Single 10-point tiebreak";
    } else {
      elements.scoringStatus.textContent = `${SCORING_LABELS[options.deuceMode]}, ${SCORING_LABELS[options.tiebreakMode]}`;
    }
  }

  isSyncingScoringControls = false;
}

function readScoringControls() {
  const scoringMode =
    elements.scoringModeSelect?.value || DEFAULT_SCORING_OPTIONS.scoringMode;
  const standardFormat = scoringMode === "standard";
  const fixedFormat = scoringMode === "fixedTotalPoints";

  const serveOrder = (elements.fixedServeOrderInput?.value || "")
    .split(",")
    .map((slot) => slot.trim().toUpperCase())
    .filter(Boolean);

  return normalizeScoringOptions({
    scoringMode,
    deuceMode: standardFormat
      ? elements.deuceModeSelect?.value
      : DEFAULT_SCORING_OPTIONS.deuceMode,
    tiebreakMode: standardFormat
      ? elements.tiebreakModeSelect?.value
      : DEFAULT_SCORING_OPTIONS.tiebreakMode,
    pointsTarget: fixedFormat
      ? Number(elements.fixedPointsTargetInput?.value)
      : undefined,
    serving: fixedFormat
      ? {
          enabled: true,
          order: serveOrder.length
            ? serveOrder
            : DEFAULT_FIXED_TOTAL_POINTS.serving.order,
          servesPerPlayer: Number(elements.fixedServesPerPlayerInput?.value),
          serveBlockLength: Number(elements.fixedServeBlockLengthInput?.value),
          sideSwapRule: elements.fixedSideSwapRuleSelect?.value,
        }
      : undefined,
    completion: fixedFormat
      ? {
          rule: "exact_total_points",
          tieResolution: elements.fixedTieResolutionSelect?.value,
        }
      : undefined,
  });
}

async function saveScoringOptionsFromSettings() {
  if (
    isSyncingScoringControls ||
    session.isSpectating ||
    !session.currentCourtId ||
    session.currentTournamentId
  )
    return;

  const nextOptions = readScoringControls();
  if (areScoringOptionsEqual(nextOptions, session.currentScoringOptions))
    return;

  try {
    if (elements.scoringStatus)
      elements.scoringStatus.textContent = "Recalculating...";
    [
      elements.scoringModeSelect,
      elements.deuceModeSelect,
      elements.tiebreakModeSelect,
    ].forEach((select) => {
      if (select) select.disabled = true;
    });

    const result = await updateScoringOptions({
      courtId: session.currentCourtId,
      matchId: session.currentMatchId,
      scoringOptions: nextOptions,
      scoringMode: nextOptions.scoringMode,
      credentials: getCourtCredentials(),
    });

    const serverOptions = normalizeScoringOptions(
      result?.data?.scoringOptions || nextOptions,
    );
    session.currentScoringOptions = serverOptions;

    // Apply the freshly replayed score returned by the Cloud Function
    // directly, instead of relying on the local `score` variable. The local
    // copy is only updated by the onSnapshot pipeline, so rendering it here
    // races the WebSocket delivery and can show a stale score.
    const serverScore = result?.data?.score;
    if (serverScore && serverScore.A && serverScore.B) {
      session.score = serverScore;
      invalidateMatchDetailsCache();
    }

    syncScoringControls();
    updateUI();
    showToast("Scoring updated", TOAST_TYPES.SUCCESS);
  } catch (err) {
    console.error("Scoring update failed:", err);
    showToast(
      "Scoring update failed: " + (err.message || "Unknown error"),
      TOAST_TYPES.ERROR,
    );
    syncScoringControls();
  }
}

export function registerScoringOptionControls() {
  [
    elements.scoringModeSelect,
    elements.deuceModeSelect,
    elements.tiebreakModeSelect,
  ].forEach((select) => {
    if (!select) return;
    select.addEventListener("change", saveScoringOptionsFromSettings);
  });
}
