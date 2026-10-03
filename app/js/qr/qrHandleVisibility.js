// Court QR panel resize-handle visibility: fades the corner handles in as the
// pointer approaches the panel and out after inactivity.
import { qrState } from "./qrState.js";
import { elements } from "../ui/dom.js";

let hasInitializedQrResizeHandleVisibility = false;

export function initializeCourtQrResizeHandleVisibility()
{
  if (
    hasInitializedQrResizeHandleVisibility ||
    !elements.courtQrPanel ||
    !elements.scoreboardPage
  )
  {
    return;
  }

  const panel = elements.courtQrPanel;
  const handleUpdateIntervalMs = 40;
  const inactivityTimeoutMs = 3000;
  const maxHandleOpacity = 1;
  const opacityStartTravelPercentage = 0.3;
  const logarithmicCurveStrength = 12;

  let lastPointerX = 0;
  let lastPointerY = 0;
  let hasPointerPosition = false;
  let lastPointerMoveTime = 0;
  let updateTimer = 0;
  let inactivityTimer = 0;
  let lastOpacity = -1;
  let calculationsSuspended = false;

  const cachePanelGeometry = () =>
  {
    if (!qrState.courtQrPanelVisible)
    {
      qrState.courtQrPanelGeometry = null;
      return;
    }

    const rect = panel.getBoundingClientRect();

    qrState.courtQrPanelGeometry = {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      centerX: rect.left + rect.width / 2,
      centerY: rect.top + rect.height / 2,
      radius: Math.max(rect.width, rect.height)
    };
  };

  const setHandleOpacity = (opacity) =>
  {
    const clampedOpacity = Math.max(0, Math.min(maxHandleOpacity, opacity));

    if (Math.abs(clampedOpacity - lastOpacity) < 0.01)
    {
      return;
    }

    lastOpacity = clampedOpacity;
    panel.style.setProperty(
      "--qr-handle-opacity",
      clampedOpacity.toFixed(3)
    );
  };

  const clearHandleUpdateTimer = () =>
  {
    if (updateTimer)
    {
      window.clearTimeout(updateTimer);
      updateTimer = 0;
    }
  };

  const clearInactivityTimer = () =>
  {
    if (inactivityTimer)
    {
      window.clearTimeout(inactivityTimer);
      inactivityTimer = 0;
    }
  };

  const isPanelInteractionActive = () =>
    panel.classList.contains("dragging") ||
    panel.classList.contains("resizing") ||
    panel.classList.contains("qr-panel-interacting");

  const isPointerWithinPanel = () =>
  {
    if (!hasPointerPosition || !qrState.courtQrPanelVisible || !qrState.courtQrPanelGeometry)
    {
      return false;
    }

    return (
      lastPointerX >= qrState.courtQrPanelGeometry.left &&
      lastPointerX <= qrState.courtQrPanelGeometry.right &&
      lastPointerY >= qrState.courtQrPanelGeometry.top &&
      lastPointerY <= qrState.courtQrPanelGeometry.bottom
    );
  };

  const suspendHandleCalculations = () =>
  {
    calculationsSuspended = true;
    clearHandleUpdateTimer();
    setHandleOpacity(0);
  };

  const checkForPointerInactivity = () =>
  {
    inactivityTimer = 0;

    if (!qrState.courtQrPanelVisible)
    {
      calculationsSuspended = false;
      setHandleOpacity(0);
      return;
    }

    if (isPanelInteractionActive())
    {
      return;
    }

    const elapsedSincePointerMove = performance.now() - lastPointerMoveTime;

    if (elapsedSincePointerMove < inactivityTimeoutMs)
    {
      inactivityTimer = window.setTimeout(
        checkForPointerInactivity,
        inactivityTimeoutMs - elapsedSincePointerMove
      );
      return;
    }

    if (isPointerWithinPanel())
    {
      calculationsSuspended = false;
      return;
    }

    suspendHandleCalculations();
  };

  const scheduleInactivityCheck = () =>
  {
    if (
      !qrState.courtQrPanelVisible ||
      !hasPointerPosition ||
      isPanelInteractionActive() ||
      inactivityTimer
    )
    {
      return;
    }

    const elapsedSincePointerMove = performance.now() - lastPointerMoveTime;
    const delay = Math.max(
      0,
      inactivityTimeoutMs - elapsedSincePointerMove
    );

    inactivityTimer = window.setTimeout(
      checkForPointerInactivity,
      delay
    );
  };

  const calculateHandleOpacity = () =>
  {
    updateTimer = 0;

    if (
      !qrState.courtQrPanelVisible ||
      calculationsSuspended ||
      isPanelInteractionActive() ||
      !hasPointerPosition ||
      !qrState.courtQrPanelGeometry
    )
    {
      return;
    }

    const geometry = qrState.courtQrPanelGeometry;
    const deltaX = lastPointerX - geometry.centerX;
    const deltaY = lastPointerY - geometry.centerY;
    const distanceFromPanelCenter = Math.hypot(deltaX, deltaY);

    // Treat the longest panel side as the radius of a circular
    // interaction zone centered on the panel.
    if (distanceFromPanelCenter <= geometry.radius)
    {
      setHandleOpacity(1);
      return;
    }

    const xScale = deltaX > 0
      ? (window.innerWidth - geometry.centerX) / deltaX
      : (-geometry.centerX) / deltaX;
    const yScale = deltaY > 0
      ? (window.innerHeight - geometry.centerY) / deltaY
      : (-geometry.centerY) / deltaY;
    const rayScale = Math.min(
      Number.isFinite(xScale) && xScale > 0 ? xScale : Infinity,
      Number.isFinite(yScale) && yScale > 0 ? yScale : Infinity
    );

    const distanceToScreenEdge = Number.isFinite(rayScale)
      ? distanceFromPanelCenter * rayScale
      : distanceFromPanelCenter;

    // Measure all remaining distance from the outside of the circular
    // interaction zone rather than from the panel center.
    const effectiveDistance = distanceFromPanelCenter - geometry.radius;
    const effectiveMaxDistance = distanceToScreenEdge - geometry.radius;

    if (effectiveMaxDistance <= 0)
    {
      setHandleOpacity(1);
      return;
    }

    const travelPercentage = Math.min(
      1,
      Math.max(0, effectiveDistance / effectiveMaxDistance)
    );

    if (travelPercentage >= opacityStartTravelPercentage)
    {
      setHandleOpacity(0);
      return;
    }

    // Use an inverse logarithmic curve so opacity remains near zero at
    // the threshold, then rises increasingly quickly as the pointer
    // approaches the panel interaction zone.
    const logarithmicProximity = Math.max(
      0,
      Math.min(
        1,
        1 -
          Math.log1p(logarithmicCurveStrength * travelPercentage) /
          Math.log1p(
            logarithmicCurveStrength * opacityStartTravelPercentage
          )
      )
    );

    setHandleOpacity(maxHandleOpacity * logarithmicProximity);
  };

  const scheduleHandleOpacityUpdate = () =>
  {
    if (
      !qrState.courtQrPanelVisible ||
      calculationsSuspended ||
      isPanelInteractionActive() ||
      updateTimer
    )
    {
      return;
    }

    updateTimer = window.setTimeout(
      calculateHandleOpacity,
      handleUpdateIntervalMs
    );
  };

  document.addEventListener("pointermove", (event) =>
  {
    if (!qrState.courtQrPanelVisible)
    {
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;
      hasPointerPosition = true;
      lastPointerMoveTime = performance.now();
      return;
    }

    if (
      event.clientX === lastPointerX &&
      event.clientY === lastPointerY &&
      hasPointerPosition
    )
    {
      return;
    }

    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
    hasPointerPosition = true;
    lastPointerMoveTime = performance.now();

    if (isPanelInteractionActive())
    {
      calculationsSuspended = true;
      clearHandleUpdateTimer();
      return;
    }

    calculationsSuspended = false;
    scheduleInactivityCheck();
    scheduleHandleOpacityUpdate();
  }, { passive: true });

  qrState.refreshCourtQrResizeHandleVisibility = (startFreshVisibilityWindow = false) =>
  {
    if (!qrState.courtQrPanelVisible)
    {
      clearHandleUpdateTimer();
      clearInactivityTimer();
      qrState.courtQrPanelGeometry = null;
      setHandleOpacity(0);
      return;
    }

    cachePanelGeometry();

    if (startFreshVisibilityWindow)
    {
      clearInactivityTimer();
      lastPointerMoveTime = performance.now();
    }

    calculationsSuspended = false;
    scheduleInactivityCheck();
    scheduleHandleOpacityUpdate();
  };

  hasInitializedQrResizeHandleVisibility = true;
  qrState.refreshCourtQrResizeHandleVisibility();
}
