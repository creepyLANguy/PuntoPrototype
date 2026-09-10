const joinPlayerButtonStyleId = "join-player-button-sizing";

if (typeof document !== "undefined" && !document.getElementById(joinPlayerButtonStyleId))
{
  const style = document.createElement("style");
  style.id = joinPlayerButtonStyleId;
  style.textContent = `
    .join-as-player-btn {
      padding: 0 !important;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    .join-as-player-btn svg {
      width: 68% !important;
      height: 68% !important;
      max-width: 100%;
      max-height: 100%;
      display: block;
      flex: 0 0 auto;
    }
  `;
  document.head.appendChild(style);
}

export function applyActiveScoreSnapshot(scoreData, listenerToken, activeListenerToken, renderScore)
{
  if (!scoreData || listenerToken !== activeListenerToken)
  {
    return false;
  }

  renderScore(scoreData);
  return true;
}
