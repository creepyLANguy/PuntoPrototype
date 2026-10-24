// Document-level input behaviour: selection guards outside the admin portal,
// mobile soft-keyboard fixes and keeping focused inputs (and the join modals)
// visible above the on-screen keyboard.
import { isTextInputElement } from "../utils/domHelpers.js";

// Fix for mobile soft keyboard not re-opening when tapping an input box that remained activeElement
let lastInputTapTime = 0;

let lastInputTapTarget = null;

function handleInputTap(e) {
  const target = e.target?.closest?.(
    "input, textarea, [contenteditable='true']",
  );
  if (!target) return;
  if (target.readOnly || target.disabled) return;

  const now = Date.now();
  if (lastInputTapTarget === target && now - lastInputTapTime < 300) {
    return;
  }
  lastInputTapTime = now;
  lastInputTapTarget = target;

  if (document.activeElement === target) {
    target.blur();
    target.focus();
  }
}

export function registerInputTapFixes() {
  document.addEventListener("pointerdown", handleInputTap, { capture: true });
  document.addEventListener("touchstart", handleInputTap, {
    capture: true,
    passive: true,
  });

  document.addEventListener(
    "pointerdown",
    (e) => {
      const active = document.activeElement;
      if (
        active &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          active.isContentEditable)
      ) {
        const isInteractive = e.target?.closest?.(
          "input, textarea, [contenteditable='true'], label, button, .court-item, .admin-court-item, select, option, a",
        );
        if (!isInteractive) {
          active.blur();
        }
      }
    },
    { capture: true },
  );
}

const ADMIN_PORTAL_SELECTOR =
  "#adminAuthPage, #adminDashboardPage, #createPage, #editCourtPage, #addDevicePage, #editDevicePage, #editClubPage";

function isAdminPortalTarget(target) {
  return !!target?.closest?.(ADMIN_PORTAL_SELECTOR);
}

export function registerSelectionGuards() {
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
      if (
        !isAdminPortalTarget(e.target) &&
        e.target.tagName !== "INPUT" &&
        e.target.tagName !== "TEXTAREA"
      ) {
        e.preventDefault();
      }
    }
  });

  document.addEventListener("mouseup", (e) => {
    if (
      isAdminPortalTarget(e.target) ||
      e.target?.tagName === "INPUT" ||
      e.target?.tagName === "TEXTAREA"
    )
      return;
    window.getSelection()?.removeAllRanges();
  });

  document.addEventListener("touchend", (e) => {
    if (
      isAdminPortalTarget(e.target) ||
      e.target?.tagName === "INPUT" ||
      e.target?.tagName === "TEXTAREA"
    )
      return;
    window.getSelection()?.removeAllRanges();
  });
}

const JOIN_MODAL_VIEWPORT_GUTTER_PX = 16;
const KEYBOARD_FOCUS_WAIT_MS = 700;
const JOIN_MODAL_MOVE_MS = 180;
const JOIN_MODAL_SELECTOR =
  "#playPage, #spectatePage, #joinCourtModal, #resetModal, #adminAuthPage";
const joinModalAnimations = new Map();

function stopJoinModalAnimation(page) {
  const state = joinModalAnimations.get(page);
  if (!state) return;
  joinModalAnimations.delete(page);
  clearTimeout(state.timer);
  state.animation.cancel();
}

function animateJoinModalPosition(page, card, previousTop) {
  const offset = previousTop - card.getBoundingClientRect().top;
  if (
    Math.abs(offset) < 1 ||
    typeof card.animate !== "function" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) return;

  const animation = card.animate(
    [
      { transform: `translateY(${offset}px)` },
      { transform: "translateY(0)" },
    ],
    { duration: JOIN_MODAL_MOVE_MS, easing: "ease-out" },
  );
  const inputs = new Map(
    [...page.querySelectorAll("input, textarea, select")].map((input) => [
      input,
      {
        value: input.value,
        checked: input.checked,
        selectionStart: input.selectionStart,
        selectionEnd: input.selectionEnd,
        selectionDirection: input.selectionDirection,
      },
    ]),
  );
  const state = { animation, inputs, timer: null };
  joinModalAnimations.set(page, state);
  const finish = () => {
    if (joinModalAnimations.get(page) !== state) return;
    stopJoinModalAnimation(page);
  };
  animation.onfinish = finish;
  animation.oncancel = finish;
  // Also release the lock if a browser fails to deliver the animation event.
  state.timer = setTimeout(finish, JOIN_MODAL_MOVE_MS + 50);
}

function blockAnimatingModalInput(event) {
  const page = event.target?.closest?.(JOIN_MODAL_SELECTOR);
  const state = joinModalAnimations.get(page);
  if (!state) return;
  // IMEs can edit through non-cancelable beforeinput events. Restore those
  // edits before application input/change handlers can observe them.
  const previous = state.inputs.get(event.target);
  if (previous && (event.type === "input" || event.type === "change")) {
    event.target.value = previous.value;
    if (typeof previous.checked === "boolean") {
      event.target.checked = previous.checked;
    }
    if (typeof previous.selectionStart === "number") {
      event.target.setSelectionRange(
        previous.selectionStart,
        previous.selectionEnd,
        previous.selectionDirection,
      );
    }
  }
  // Preserve focus (and the soft keyboard), unlike disabling/inerting the form.
  event.preventDefault();
  event.stopImmediatePropagation();
}

let joinModalViewportFrame = null;
let unobscuredViewportHeight = 0;
let viewportWidth = 0;
let keyboardOpen = false;
let pendingKeyboardInput = null;
let keyboardFocusTimer = null;

function clearPendingKeyboardFocus() {
  clearTimeout(keyboardFocusTimer);
  keyboardFocusTimer = null;
  pendingKeyboardInput = null;
}

function positionJoinModalsForVisualViewport() {
  if (joinModalViewportFrame !== null) return;

  joinModalViewportFrame = requestAnimationFrame(() => {
    joinModalViewportFrame = null;

    const visualViewport = window.visualViewport;
    const viewportTop = visualViewport?.offsetTop ?? window.scrollY;
    const viewportHeight = visualViewport?.height ?? window.innerHeight;
    const viewportBottom = viewportTop + viewportHeight;
    const safeTop = viewportTop + JOIN_MODAL_VIEWPORT_GUTTER_PX;
    const safeBottom = viewportBottom - JOIN_MODAL_VIEWPORT_GUTTER_PX;
    const useTopAlignedJoin = window.matchMedia(
      "(max-width: 768px), (pointer: coarse)",
    ).matches;

    // Focus is not proof of a keyboard: hardware keyboards and browser focus
    // restrictions can suppress it. Ignore pinch zoom and small toolbar resizes.
    const unscaledViewportHeight =
      viewportHeight * (visualViewport?.scale ?? 1);
    if (Math.abs(window.innerWidth - viewportWidth) > 100) {
      unobscuredViewportHeight = window.innerHeight;
    }
    viewportWidth = window.innerWidth;
    unobscuredViewportHeight = Math.max(
      unobscuredViewportHeight,
      window.innerHeight,
      unscaledViewportHeight,
    );
    const reduced =
      unobscuredViewportHeight - unscaledViewportHeight >
      Math.max(100, unobscuredViewportHeight * 0.15);
    const wasKeyboardOpen = keyboardOpen;
    keyboardOpen =
      reduced &&
      (keyboardOpen ||
        (isTextInputElement(document.activeElement) &&
          isJoinCourtInput(document.activeElement)));
    if (wasKeyboardOpen && !keyboardOpen) clearPendingKeyboardFocus();

    [
      "playPage",
      "spectatePage",
      "joinCourtModal",
      "resetModal",
      "adminAuthPage",
    ].forEach((pageId) => {
      const page = document.getElementById(pageId);
      const card = page?.querySelector(".create-card, .reset-box");
      if (!card) return;
      const previousRect = useTopAlignedJoin ? card.getBoundingClientRect() : null;
      const previousAlignment =
        page.style.getPropertyValue("--join-vertical-alignment") || "flex-start";
      const wasAnimating = joinModalAnimations.has(page);
      stopJoinModalAnimation(page);
      page.style.setProperty("--join-viewport-height", `${viewportHeight}px`);

      if (useTopAlignedJoin) {
        const alignment = keyboardOpen || page.contains(pendingKeyboardInput)
          ? "flex-start"
          : "center";
        page.style.setProperty("--join-vertical-alignment", alignment);
        card.style.setProperty("--keyboard-shift-y", "0px");
        if (
          previousRect.height > 0 &&
          (alignment !== previousAlignment || wasAnimating)
        ) {
          animateJoinModalPosition(page, card, previousRect.top);
        }
        return;
      }

      if (pageId === "resetModal" || pageId === "adminAuthPage") return;

      if (page.style.display === "none") {
        card.style.setProperty("--keyboard-shift-y", "0px");
        return;
      }

      const rect = card.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        card.style.setProperty("--keyboard-shift-y", "0px");
        return;
      }

      const currentShift =
        parseFloat(card.style.getPropertyValue("--keyboard-shift-y")) || 0;
      const baseTop = rect.top - currentShift;
      const baseBottom = rect.bottom - currentShift;
      const overlap = Math.max(0, baseBottom - safeBottom);
      const maximumUpwardShift = Math.max(0, baseTop - safeTop);
      const shift = Math.min(overlap, maximumUpwardShift);

      card.style.setProperty("--keyboard-shift-y", -shift + "px");
    });
  });
}

function isJoinCourtInput(el) {
  return Boolean(el?.closest?.(JOIN_MODAL_SELECTOR));
}

function isInputObscured(el) {
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

function scrollInputIntoViewIfNeeded(el) {
  if (!isTextInputElement(el)) return;
  if (obscuredScrollFrame !== null) return;

  obscuredScrollFrame = requestAnimationFrame(() => {
    obscuredScrollFrame = null;
    if (document.activeElement !== el) return;
    if (!isInputObscured(el)) return;

    try {
      el.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "nearest",
      });
    } catch (e) {
      el.scrollIntoView(false);
    }
  });
}

export function registerMobileInputAutoScroll() {
  for (const type of [
    "pointerdown", "pointerup", "click", "dblclick", "contextmenu",
    "touchstart", "touchmove", "touchend", "mousedown", "mouseup",
    "keydown", "keypress", "keyup", "beforeinput", "input", "change",
    "compositionstart", "compositionupdate", "compositionend", "paste", "cut", "drop",
    "submit", "wheel",
  ]) {
    window.addEventListener(type, blockAnimatingModalInput, {
      capture: true,
      passive: false,
    });
  }
  unobscuredViewportHeight = window.innerHeight;
  viewportWidth = window.innerWidth;
  positionJoinModalsForVisualViewport();

  document.addEventListener(
    "focusin",
    (e) => {
      if (isTextInputElement(e.target)) {
        if (isJoinCourtInput(e.target)) {
          clearPendingKeyboardFocus();
          pendingKeyboardInput = e.target;
          // Keep the initial top position while the keyboard animates in, but
          // release it if the browser never opens a software keyboard.
          keyboardFocusTimer = setTimeout(() => {
            clearPendingKeyboardFocus();
            positionJoinModalsForVisualViewport();
          }, KEYBOARD_FOCUS_WAIT_MS);
          positionJoinModalsForVisualViewport();
        }
        scrollInputIntoViewIfNeeded(e.target);
      }
    },
    { capture: true, passive: true },
  );

  document.addEventListener(
    "focusout",
    (e) => {
      if (isTextInputElement(e.target) && isJoinCourtInput(e.target)) {
        clearPendingKeyboardFocus();
        positionJoinModalsForVisualViewport();
      }
    },
    { capture: true, passive: true },
  );

  if (window.visualViewport) {
    window.visualViewport.addEventListener(
      "resize",
      () => {
        positionJoinModalsForVisualViewport();
        if (
          document.activeElement &&
          isTextInputElement(document.activeElement)
        ) {
          scrollInputIntoViewIfNeeded(document.activeElement);
        }
      },
      { passive: true },
    );

    window.visualViewport.addEventListener(
      "scroll",
      () => {
        positionJoinModalsForVisualViewport();
        if (
          document.activeElement &&
          isTextInputElement(document.activeElement)
        ) {
          scrollInputIntoViewIfNeeded(document.activeElement);
        }
      },
      { passive: true },
    );
  }

  window.addEventListener(
    "resize",
    () => {
      positionJoinModalsForVisualViewport();
      if (
        document.activeElement &&
        isTextInputElement(document.activeElement)
      ) {
        scrollInputIntoViewIfNeeded(document.activeElement);
      }
    },
    { passive: true },
  );
}
