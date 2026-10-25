const joinPlayerButtonStyleId = "join-player-button-sizing";

if (
  typeof document !== "undefined" &&
  !document.getElementById(joinPlayerButtonStyleId)
) {
  const style = document.createElement("style");
  style.id = joinPlayerButtonStyleId;
  style.textContent = `
    .join-as-player-btn {
      padding: 0 !important;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    .join-as-player-btn .icon {
      width: 68% !important;
      height: 68% !important;
      max-width: 100%;
      max-height: 100%;
      display: block;
      flex: 0 0 auto;
    }

    /* Pending score feedback deliberately blurs slowly, then clears quickly
       when an authoritative score snapshot confirms the event. */
    .points {
      filter: blur(0);
      transition: filter 170ms ease-out;
    }

    .points.score-pending {
      filter: blur(2.8px);
      transition: filter 1250ms ease-in;
      will-change: filter;
    }

    .score-sync-status {
      position: fixed;
      z-index: 9500;
      left: 50%;
      bottom: calc(env(safe-area-inset-bottom, 0px) + 14px);
      transform: translateX(-50%);
      max-width: calc(100vw - 32px);
      overflow: hidden;
      padding: 8px 13px;
      border: 1px solid rgba(255, 255, 255, 0.22);
      border-radius: 999px;
      background: rgba(17, 24, 39, 0.88);
      color: #fff;
      box-shadow: 0 4px 18px rgba(0, 0, 0, 0.22);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      font: 600 0.82rem/1.25 system-ui, sans-serif;
      text-align: center;
      text-overflow: ellipsis;
      white-space: nowrap;
      pointer-events: none;
    }

    @media (prefers-reduced-motion: reduce) {
      .points,
      .points.score-pending {
        transition: none;
        will-change: auto;
      }

      .points.score-pending {
        filter: blur(1.6px);
      }
    }
  `;
  document.head.appendChild(style);
}

export function applyActiveScoreSnapshot(
  scoreData,
  listenerToken,
  activeListenerToken,
  renderScore,
) {
  if (!scoreData || listenerToken !== activeListenerToken) {
    return false;
  }

  renderScore(scoreData);
  return true;
}
