// Document-level input behaviour: selection guards outside the admin portal,
// mobile soft-keyboard fixes and keeping focused inputs (and the join modals)
// visible above the on-screen keyboard.
import { isTextInputElement } from "../utils/domHelpers.js";

// Fix for mobile soft keyboard not re-opening when tapping an input box that remained activeElement
let lastInputTapTime = 0;

let lastInputTapTarget = null;

function handleInputTap(e)
{
  const target = e.target?.closest?.("input, textarea, [contenteditable='true']");
  if (!target) return;
  if (target.readOnly || target.disabled) return;

  const now = Date.now();
  if (lastInputTapTarget === target && (now - lastInputTapTime < 300))
  {
    return;
  }
  lastInputTapTime = now;
  lastInputTapTarget = target;

  if (document.activeElement === target)
  {
    target.blur();
    target.focus();
  }
}

export function registerInputTapFixes()
{
  document.addEventListener("pointerdown", handleInputTap, { capture: true });
  document.addEventListener("touchstart", handleInputTap, { capture: true, passive: true });

  document.addEventListener("pointerdown", (e) =>
  {
    const active = document.activeElement;
    if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable))
    {
      const isInteractive = e.target?.closest?.("input, textarea, [contenteditable='true'], label, button, .court-item, .admin-court-item, select, option, a");
      if (!isInteractive)
      {
        active.blur();
      }
    }
  }, { capture: true });
}

const ADMIN_PORTAL_SELECTOR = "#adminAuthPage, #adminDashboardPage, #createPage, #editCourtPage, #addDevicePage, #editDevicePage";

function isAdminPortalTarget(target)
{
  return !!target?.closest?.(ADMIN_PORTAL_SELECTOR);
}

export function registerSelectionGuards()
{
  document.addEventListener("keydown", (e) =>
  {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a")
    {
      if (!isAdminPortalTarget(e.target) && e.target.tagName !== "INPUT" && e.target.tagName !== "TEXTAREA"){
        e.preventDefault();
      }      
    }
  });

  document.addEventListener("mouseup", (e) =>
  {
    if (isAdminPortalTarget(e.target) || e.target?.tagName === "INPUT" || e.target?.tagName === "TEXTAREA") return;
    window.getSelection()?.removeAllRanges();
  });

  document.addEventListener("touchend", (e) =>
  {
    if (isAdminPortalTarget(e.target) || e.target?.tagName === "INPUT" || e.target?.tagName === "TEXTAREA") return;
    window.getSelection()?.removeAllRanges();
  });
}

const JOIN_MODAL_VIEWPORT_GUTTER_PX = 16;

let joinModalViewportFrame = null;

function positionJoinModalsForVisualViewport()
{
  if (joinModalViewportFrame !== null) return;

  joinModalViewportFrame = requestAnimationFrame(() =>
  {
    joinModalViewportFrame = null;

    const visualViewport = window.visualViewport;
    const viewportTop = visualViewport?.offsetTop ?? window.scrollY;
    const viewportHeight = visualViewport?.height ?? window.innerHeight;
    const viewportBottom = viewportTop + viewportHeight;
    const safeTop = viewportTop + JOIN_MODAL_VIEWPORT_GUTTER_PX;
    const safeBottom = viewportBottom - JOIN_MODAL_VIEWPORT_GUTTER_PX;

    ["playPage", "spectatePage"].forEach((pageId) =>
    {
      const page = document.getElementById(pageId);
      const card = page?.querySelector(".create-card");
      if (!card) return;

      if (page.style.display === "none")
      {
        card.style.setProperty("--keyboard-shift-y", "0px");
        return;
      }

      const rect = card.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0)
      {
        card.style.setProperty("--keyboard-shift-y", "0px");
        return;
      }

      const currentShift = parseFloat(card.style.getPropertyValue("--keyboard-shift-y")) || 0;
      const baseTop = rect.top - currentShift;
      const baseBottom = rect.bottom - currentShift;
      const overlap = Math.max(0, baseBottom - safeBottom);
      const maximumUpwardShift = Math.max(0, baseTop - safeTop);
      const shift = Math.min(overlap, maximumUpwardShift);

      card.style.setProperty("--keyboard-shift-y", (-shift) + "px");
    });
  });
}

function isJoinCourtInput(el)
{
  return Boolean(el?.closest?.("#playPage, #spectatePage"));
}

function isInputObscured(el)
{
  if (!isTextInputElement(el)) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;

  const vv = window.visualViewport;
  const viewportHeight = vv ? vv.height : window.innerHeight;

  // Safety margins:
  // Top margin to clear fixed headers/bars (50px)
  // Bottom margin to clear virtual keyboard and footers (20px)
  const minTop = 50;
  const maxBottom = viewportHeight - 20;

  return rect.bottom > maxBottom || rect.top < minTop;
}

// Single in-flight scroll, re-armed via rAF instead of stacked timeouts, so the
// keyboard's continuous resize/scroll events nudge the input rather than
// re-triggering competing "smooth" animations (which caused visible snapping).
let obscuredScrollFrame = null;

function scrollInputIntoViewIfNeeded(el)
{
  if (!isTextInputElement(el)) return;
  if (obscuredScrollFrame !== null) return;

  obscuredScrollFrame = requestAnimationFrame(() =>
  {
    obscuredScrollFrame = null;
    if (document.activeElement !== el) return;
    if (!isInputObscured(el)) return;

    try
    {
      el.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "nearest"
      });
    }
    catch (e)
    {
      el.scrollIntoView(false);
    }
  });
}

export function registerMobileInputAutoScroll()
{
  document.addEventListener("focusin", (e) =>
  {
    if (isTextInputElement(e.target))
    {
      scrollInputIntoViewIfNeeded(e.target);
      if (isJoinCourtInput(e.target))
      {
        positionJoinModalsForVisualViewport();
      }
    }
  }, { capture: true, passive: true });

  document.addEventListener("focusout", (e) =>
  {
    if (isTextInputElement(e.target) && isJoinCourtInput(e.target))
    {
      positionJoinModalsForVisualViewport();
    }
  }, { capture: true, passive: true });

  if (window.visualViewport)
  {
    window.visualViewport.addEventListener("resize", () =>
    {
      positionJoinModalsForVisualViewport();
      if (document.activeElement && isTextInputElement(document.activeElement))
      {
        scrollInputIntoViewIfNeeded(document.activeElement);
      }
    }, { passive: true });

    window.visualViewport.addEventListener("scroll", () =>
    {
      positionJoinModalsForVisualViewport();
      if (document.activeElement && isTextInputElement(document.activeElement))
      {
        scrollInputIntoViewIfNeeded(document.activeElement);
      }
    }, { passive: true });
  }

  window.addEventListener("resize", () =>
  {
    positionJoinModalsForVisualViewport();
    if (document.activeElement && isTextInputElement(document.activeElement))
    {
      scrollInputIntoViewIfNeeded(document.activeElement);
    }
  }, { passive: true });
}
