// Court QR panel drag and corner-resize interaction (pointer events, frame-synced).
import { clampCourtQrPanelToViewport, rerasterizeCourtQrLogoAtCurrentSize } from "./courtQr.js";
import { qrState } from "./qrState.js";
import { elements } from "../ui/dom.js";

let hasInitializedQrPanelInteractions = false;

export function initializeCourtQrPanelInteractions()
{
  if (hasInitializedQrPanelInteractions || !elements.courtQrPanel || !elements.scoreboardPage)
  {
    return;
  }

  const panel = elements.courtQrPanel;

  let interactionMode = null;
  let resizeCorner = null;
  let activeResizeHandle = null;
  let pointerId = null;

  // Geometry is captured once at pointerdown. Pointermove never performs layout
  // reads; drag uses the compositor path, while resize updates left/top/width
  // once per animation frame.
  let parentWidth = 0;
  let parentHeight = 0;
  let parentLeft = 0;
  let parentTop = 0;
  let baseLeft = 0;
  let baseTop = 0;
  let baseRight = 0;
  let baseBottom = 0;
  let panelWidth = 0;
  let panelHeight = 0;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let resizeStartX = 0;
  let resizeStartY = 0;
  let resizeStartWidth = 0;
  let resizeAspectRatio = 1.24;

  let pendingLeft = null;
  let pendingTop = null;
  let pendingWidth = null;
  let framePending = false;

  const applyPendingQrPanelFrame = () =>
  {
    framePending = false;

    const nextLeft = pendingLeft;
    const nextTop = pendingTop;
    const nextWidth = pendingWidth;

    pendingLeft = null;
    pendingTop = null;
    pendingWidth = null;

    if (interactionMode === "drag" && nextLeft !== null && nextTop !== null)
    {
      panel.style.transform =
        "translate3d(" +
        (nextLeft - baseLeft) +
        "px, " +
        (nextTop - baseTop) +
        "px, 0)";
      return;
    }

    if (interactionMode === "resize" && nextLeft !== null && nextTop !== null && nextWidth !== null)
    {
      panel.style.left = nextLeft + "px";
      panel.style.top = nextTop + "px";
      panel.style.width = nextWidth + "px";
    }
  };

  const scheduleQrPanelFrame = ({ left = null, top = null, width = null } = {}) =>
  {
    if (left !== null) pendingLeft = left;
    if (top !== null) pendingTop = top;
    if (width !== null) pendingWidth = width;

    if (!framePending)
    {
      framePending = window.requestAnimationFrame(applyPendingQrPanelFrame);
    }
  };

  const calculateDragPosition = (clientX, clientY) =>
  {
    const maxLeft = Math.max(0, parentWidth - panelWidth);
    const maxTop = Math.max(0, parentHeight - panelHeight);

    return {
      left: Math.min(
        maxLeft,
        Math.max(0, clientX - parentLeft - dragOffsetX)
      ),
      top: Math.min(
        maxTop,
        Math.max(0, clientY - parentTop - dragOffsetY)
      )
    };
  };

  const calculateResizeGeometry = (clientX, clientY) =>
  {
    if (!resizeCorner)
    {
      return null;
    }

    const horizontalDirection = resizeCorner.endsWith("e") ? 1 : -1;
    const verticalDirection = resizeCorner.startsWith("s") ? 1 : -1;
    const deltaX = (clientX - resizeStartX) * horizontalDirection;
    const deltaY = (clientY - resizeStartY) * verticalDirection;

    const minWidth = 130;
    const maxWidthByHorizontalEdge =
      horizontalDirection > 0
        ? parentWidth - baseLeft - 8
        : baseRight - 8;
    const maxWidthByVerticalEdge =
      verticalDirection > 0
        ? (parentHeight - baseTop - 8) / resizeAspectRatio
        : (baseBottom - 8) / resizeAspectRatio;

    const maxWidth = Math.max(
      minWidth,
      Math.min(maxWidthByHorizontalEdge, maxWidthByVerticalEdge)
    );

    const requestedWidth =
      resizeStartWidth + Math.max(deltaX, deltaY / resizeAspectRatio);
    const width = Math.max(
      minWidth,
      Math.min(maxWidth, requestedWidth)
    );
    const height = width * resizeAspectRatio;

    return {
      left: resizeCorner.includes("w")
        ? baseRight - width
        : baseLeft,
      top: resizeCorner.includes("n")
        ? baseBottom - height
        : baseTop,
      width
    };
  };

  const queueInteractionPosition = (clientX, clientY) =>
  {
    if (interactionMode === "drag")
    {
      scheduleQrPanelFrame(calculateDragPosition(clientX, clientY));
      return;
    }

    if (interactionMode === "resize")
    {
      const geometry = calculateResizeGeometry(clientX, clientY);
      if (geometry)
      {
        scheduleQrPanelFrame(geometry);
      }
    }
  };

  const flushScheduledFrame = () =>
  {
    if (!framePending)
    {
      return;
    }

    window.cancelAnimationFrame(framePending);
    framePending = false;
    applyPendingQrPanelFrame();
  };

  const stopInteraction = (event = null) =>
  {
    if (!interactionMode || (event && event.pointerId !== pointerId))
    {
      return;
    }

    const modeAtStop = interactionMode;
    const releasedPointerId = pointerId;

    if (event)
    {
      queueInteractionPosition(event.clientX, event.clientY);
    }

    const finalLeft = pendingLeft;
    const finalTop = pendingTop;
    const finalWidth = pendingWidth;

    flushScheduledFrame();

    if (modeAtStop === "drag")
    {
      panel.style.left = (finalLeft !== null ? finalLeft : baseLeft) + "px";
      panel.style.top = (finalTop !== null ? finalTop : baseTop) + "px";
    }
    else if (modeAtStop === "resize")
    {
      panel.style.left = (finalLeft !== null ? finalLeft : baseLeft) + "px";
      panel.style.top = (finalTop !== null ? finalTop : baseTop) + "px";
      panel.style.width = (finalWidth !== null ? finalWidth : resizeStartWidth) + "px";
    }

    panel.style.transform = "";
    panel.classList.remove("dragging", "resizing", "qr-panel-resizing", "qr-panel-interacting");

    if (activeResizeHandle)
    {
      activeResizeHandle.classList.remove("is-active");
    }

    interactionMode = null;
    resizeCorner = null;
    activeResizeHandle = null;
    pointerId = null;
    parentWidth = 0;
    parentHeight = 0;
    parentLeft = 0;
    parentTop = 0;

    pendingLeft = null;
    pendingTop = null;
    pendingWidth = null;

    if (releasedPointerId !== null && panel.hasPointerCapture?.(releasedPointerId))
    {
      try
      {
        panel.releasePointerCapture(releasedPointerId);
      }
      catch
      {
        // Pointer capture can already have been released by the browser.
      }
    }

    if (modeAtStop === "resize")
    {
      clampCourtQrPanelToViewport();
      rerasterizeCourtQrLogoAtCurrentSize();
    }

    qrState.refreshCourtQrResizeHandleVisibility?.();
  };

  panel.addEventListener("pointerdown", (event) =>
  {
    if (event.button !== 0)
    {
      return;
    }

    const currentParentRect = elements.scoreboardPage.getBoundingClientRect();
    const currentPanelRect = panel.getBoundingClientRect();
    const resizeHandle = event.target instanceof Element
      ? event.target.closest(".qr-resize-handle")
      : null;
    const isResizeAction = Boolean(resizeHandle?.dataset.corner);

    parentWidth = currentParentRect.width;
    parentHeight = currentParentRect.height;
    parentLeft = currentParentRect.left;
    parentTop = currentParentRect.top;
    panelWidth = currentPanelRect.width;
    panelHeight = currentPanelRect.height;
    baseLeft = currentPanelRect.left - currentParentRect.left;
    baseTop = currentPanelRect.top - currentParentRect.top;
    baseRight = baseLeft + panelWidth;
    baseBottom = baseTop + panelHeight;
    pointerId = event.pointerId;

    panel.style.right = "auto";
    panel.style.bottom = "auto";
    panel.style.left = baseLeft + "px";
    panel.style.top = baseTop + "px";
    panel.style.transformOrigin = "top left";

    if (isResizeAction)
    {
      interactionMode = "resize";
      resizeCorner = resizeHandle.dataset.corner;
      resizeStartX = event.clientX;
      resizeStartY = event.clientY;
      resizeStartWidth = currentPanelRect.width;
      resizeAspectRatio = currentPanelRect.width > 0
        ? currentPanelRect.height / currentPanelRect.width
        : 1.24;
      activeResizeHandle = resizeHandle;
      activeResizeHandle.classList.add("is-active");
      panel.classList.add("resizing", "qr-panel-resizing", "qr-panel-interacting");
    }
    else
    {
      interactionMode = "drag";
      dragOffsetX = event.clientX - currentPanelRect.left;
      dragOffsetY = event.clientY - currentPanelRect.top;
      panel.classList.add("dragging", "qr-panel-interacting");
    }

    panel.setPointerCapture(event.pointerId);
    event.preventDefault();
  }, { capture: true });

  document.addEventListener("pointermove", (event) =>
  {
    if (!interactionMode || event.pointerId !== pointerId)
    {
      return;
    }

    queueInteractionPosition(event.clientX, event.clientY);
    event.preventDefault();
  }, { passive: false });

  const stopInteractionFromPointer = (event) =>
  {
    stopInteraction(event);
  };

  panel.addEventListener("lostpointercapture", stopInteraction);
  document.addEventListener("pointerup", stopInteractionFromPointer);
  document.addEventListener("pointercancel", stopInteractionFromPointer);

  window.addEventListener("resize", () =>
  {
    if (interactionMode)
    {
      stopInteraction();
      return;
    }

    clampCourtQrPanelToViewport();
  });

  hasInitializedQrPanelInteractions = true;
}
