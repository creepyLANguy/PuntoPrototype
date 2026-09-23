(() =>
{
  const init = () =>
  {
    const panel = document.getElementById("courtQrPanel");
    const scoreboard = document.getElementById("scoreboardPage");

    if (!panel || !scoreboard || panel.dataset.qrResizeInteractionBound === "true")
    {
      return;
    }

    panel.dataset.qrResizeInteractionBound = "true";
    panel.style.resize = "none";
    panel.style.touchAction = "none";
    panel.style.boxSizing = "border-box";

    let resizing = false;
    let pointerId = null;
    let startPointerX = 0;
    let startPointerY = 0;
    let startWidth = 0;
    let aspectRatio = 1.24;
    let pendingWidth = null;
    let pendingHeight = null;
    let framePending = false;

    const cancelScheduledFrame = () =>
    {
      if (!framePending)
      {
        return;
      }

      window.cancelAnimationFrame(framePending);
      framePending = false;
    };

    const applyPendingSize = () =>
    {
      framePending = false;

      if (!resizing || pendingWidth === null || pendingHeight === null)
      {
        return;
      }

      panel.style.width = `${pendingWidth}px`;
      panel.style.height = `${pendingHeight}px`;
    };

    const scheduleSize = (width, height) =>
    {
      pendingWidth = width;
      pendingHeight = height;

      if (!framePending)
      {
        framePending = window.requestAnimationFrame(applyPendingSize);
      }
    };

    const getMaxWidth = (parentRect, left, top) =>
    {
      const maxWidthByRightEdge = parentRect.width - left - 8;
      const maxWidthByBottomEdge = (parentRect.height - top - 8) / aspectRatio;
      return Math.max(72, Math.min(maxWidthByRightEdge, maxWidthByBottomEdge));
    };

    const finishResize = (event = null) =>
    {
      if (!resizing || (event && event.pointerId !== pointerId))
      {
        return;
      }

      // Put the final pointer position through the same frame-synced path before
      // releasing the interaction, so the last visible frame is never one step behind.
      if (event)
      {
        const parentRect = scoreboard.getBoundingClientRect();
        const panelRect = panel.getBoundingClientRect();
        const left = panelRect.left - parentRect.left;
        const top = panelRect.top - parentRect.top;
        const maxWidth = getMaxWidth(parentRect, left, top);
        const deltaX = event.clientX - startPointerX;
        const deltaY = event.clientY - startPointerY;
        const requestedWidth = startWidth + Math.max(deltaX, deltaY / aspectRatio);
        const width = Math.max(72, Math.min(maxWidth, requestedWidth));
        const height = width * aspectRatio;
        scheduleSize(width, height);
      }

      if (framePending)
      {
        window.cancelAnimationFrame(framePending);
        framePending = false;
        applyPendingSize();
      }

      resizing = false;
      pointerId = null;
      pendingWidth = null;
      pendingHeight = null;
      panel.classList.remove("resizing");
    };

    panel.addEventListener("pointerdown", (event) =>
    {
      if (event.button !== 0)
      {
        return;
      }

      const rect = panel.getBoundingClientRect();
      const handleZone = 28;
      const inResizeHandle = event.clientX >= rect.right - handleZone &&
        event.clientY >= rect.bottom - handleZone;

      if (!inResizeHandle)
      {
        return;
      }

      const parentRect = scoreboard.getBoundingClientRect();
      const computed = window.getComputedStyle(panel);
      const computedAspect = Number.parseFloat(computed.aspectRatio);
      const currentWidth = rect.width;
      const currentHeight = rect.height;

      resizing = true;
      pointerId = event.pointerId;
      startPointerX = event.clientX;
      startPointerY = event.clientY;
      startWidth = currentWidth;
      aspectRatio = Number.isFinite(computedAspect) && computedAspect > 0
        ? computedAspect
        : currentWidth > 0
          ? currentHeight / currentWidth
          : 1.24;

      // Keep the panel in the scoreboard's coordinate system while resizing.
      panel.style.right = "auto";
      panel.style.bottom = "auto";
      panel.style.left = `${rect.left - parentRect.left}px`;
      panel.style.top = `${rect.top - parentRect.top}px`;
      panel.classList.add("resizing");

      panel.setPointerCapture(event.pointerId);
      event.preventDefault();
      event.stopImmediatePropagation();
    }, { capture: true });

    document.addEventListener("pointermove", (event) =>
    {
      if (!resizing || event.pointerId !== pointerId)
      {
        return;
      }

      const parentRect = scoreboard.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const left = panelRect.left - parentRect.left;
      const top = panelRect.top - parentRect.top;
      const maxWidth = getMaxWidth(parentRect, left, top);
      const deltaX = event.clientX - startPointerX;
      const deltaY = event.clientY - startPointerY;

      // The bottom-right handle controls one scalar size. Both dimensions are
      // derived from it, so they can never visually drift apart during resize.
      const requestedWidth = startWidth + Math.max(deltaX, deltaY / aspectRatio);
      const width = Math.max(72, Math.min(maxWidth, requestedWidth));
      const height = width * aspectRatio;

      scheduleSize(width, height);
      event.preventDefault();
    }, { passive: false });

    document.addEventListener("pointerup", finishResize);
    document.addEventListener("pointercancel", finishResize);
    panel.addEventListener("lostpointercapture", finishResize);

    window.addEventListener("resize", () =>
    {
      if (!resizing)
      {
        return;
      }

      cancelScheduledFrame();
      finishResize();
    });
  };

  if (document.readyState === "loading")
  {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  }
  else
  {
    init();
  }
})();
