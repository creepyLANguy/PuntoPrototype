// Score feedback animations on the team cards and point displays.
import { $, elements } from "./dom.js";

const pointAnimationRuns = new WeakMap();

function getPointAnimations(cards) {
  return cards
    .flatMap((card) => card.getAnimations?.({ subtree: true }) || [])
    .filter(
      (animation) =>
        ["team-pop", "burst"].includes(animation.animationName) &&
        (animation.playState === "running" || animation.pending),
    );
}

function finishPointAnimations(animations) {
  return Promise.all(
    animations.map((animation) =>
      animation.finished.catch((error) => {
        if (error.name !== "AbortError") throw error;
      }),
    ),
  );
}

export function animate(team) {
  const el = $(`team${team}`);
  pointAnimationRuns.get(el)?.removeListeners?.();
  const run = {};
  pointAnimationRuns.set(el, run);
  el.classList.remove("score-animate");
  void el.offsetWidth;
  el.classList.add("score-animate");

  const cleanup = () => {
    if (pointAnimationRuns.get(el) !== run) return;
    run.removeListeners?.();
    el.classList.remove("score-animate");
    pointAnimationRuns.delete(el);
  };

  if (typeof el.getAnimations === "function") {
    finishPointAnimations(getPointAnimations([el]))
      .then(cleanup)
      .catch((error) => console.error("Point animation failed", error));
  } else {
    const onEnd = (event) => {
      if (
        event.target === el &&
        event.animationName === "team-pop" &&
        !event.pseudoElement
      ) {
        cleanup();
      }
    };
    run.removeListeners = () => el.removeEventListener("animationend", onEnd);
    el.addEventListener("animationend", onEnd);
  }
}

export function animateUndo(team) {
  const el = elements.points[team];
  if (!el) return;
  el.classList.remove("undo-flash");
  void el.offsetWidth;
  el.classList.add("undo-flash");
}

export async function waitForPointAnimations() {
  for (;;) {
    const animations = getPointAnimations([
      ...document.querySelectorAll(".team.score-animate"),
    ]);
    if (!animations.length) return;

    await finishPointAnimations(animations);
  }
}

const SWAP_DURATION_MS = 650;
const CHANGEOVER_DURATION_MS = 900;
const SWAP_CUE_CLASSES = ["swap-animating", "changeover-animating"];
let swapCueTimer = null;

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

// Toggles the scoreboard's "swapped" view and animates the team cards from
// their previous positions to their new ones (FLIP), so a view swap or a
// changeover is visibly a movement rather than an instant jump. The class
// change itself is synchronous; only the presentation is animated.
export function swapScoreboardViews({ changeover = false } = {}) {
  const scoreboard = document.querySelector(".scoreboard");
  if (!scoreboard) return false;

  const cards = [...scoreboard.querySelectorAll(".team")];
  const canAnimate = cards.every((card) => typeof card.animate === "function");

  // Measure where the cards currently appear (including any in-flight swap
  // animation) so a rapid second swap continues from the visible position.
  const before = canAnimate
    ? cards.map((card) => card.getBoundingClientRect())
    : [];
  if (canAnimate) {
    cards.forEach((card) =>
      card.getAnimations?.().forEach((animation) => {
        if (animation.id === "scoreboard-swap") animation.cancel();
      }),
    );
  }

  // Manual swaps can interrupt feedback; do not let it restart after the cue.
  cards.forEach((card) => {
    pointAnimationRuns.get(card)?.removeListeners?.();
    pointAnimationRuns.delete(card);
    card.classList.remove("score-animate");
  });
  const swapped = scoreboard.classList.toggle("swapped");

  const duration = changeover ? CHANGEOVER_DURATION_MS : SWAP_DURATION_MS;
  const reduced = prefersReducedMotion();

  if (canAnimate) {
    cards.forEach((card, index) => {
      const after = card.getBoundingClientRect();
      const dx = before[index].left - after.left;
      const dy = before[index].top - after.top;

      const keyframes = reduced
        ? [{ opacity: 0.35 }, { opacity: 1 }]
        : [
            { transform: `translate(${dx}px, ${dy}px) scale(1)`, opacity: 1 },
            {
              transform: `translate(${dx / 2}px, ${dy / 2}px) scale(0.86)`,
              opacity: 0.75,
              offset: 0.5,
            },
            { transform: "translate(0, 0) scale(1)", opacity: 1 },
          ];

      const animation = card.animate(keyframes, {
        duration: reduced ? 250 : duration,
        easing: "cubic-bezier(0.65, 0, 0.35, 1)",
      });
      animation.id = "scoreboard-swap";
    });
  }

  // A scoreboard-level cue (glow, plus a "Changeover" label for changeovers)
  // makes it obvious what is happening even when the cards barely move.
  scoreboard.classList.remove(...SWAP_CUE_CLASSES);
  void scoreboard.offsetWidth;
  scoreboard.classList.add(
    changeover ? "changeover-animating" : "swap-animating",
  );

  if (swapCueTimer) clearTimeout(swapCueTimer);
  swapCueTimer = setTimeout(
    () => {
      swapCueTimer = null;
      scoreboard.classList.remove(...SWAP_CUE_CLASSES);
    },
    changeover ? CHANGEOVER_DURATION_MS + 600 : duration,
  );

  return swapped;
}

const MATCH_TRANSITION_MS = 280;

function fadeScoreboard(scoreboard, from, to) {
  if (typeof scoreboard?.animate !== "function") return Promise.resolve();
  const reduced = prefersReducedMotion();
  const animation = scoreboard.animate(
    reduced
      ? [{ opacity: from }, { opacity: to }]
      : [
          { opacity: from, transform: `scale(${from === 1 ? 1 : 0.96})` },
          { opacity: to, transform: `scale(${to === 1 ? 1 : 0.96})` },
        ],
    { duration: MATCH_TRANSITION_MS, easing: "ease-in-out", fill: "forwards" },
  );
  return (animation.finished || Promise.resolve())
    .catch(() => {})
    .then(() => animation);
}

// Animates the current match out, runs `swap` (which loads the new match) while
// the scoreboard is hidden, then animates the new match in. The scoreboard is
// always restored, even when `swap` fails.
export async function transitionScoreboardMatch(swap) {
  const scoreboard = document.querySelector(".scoreboard");
  const outAnimation = await fadeScoreboard(scoreboard, 1, 0);
  try {
    return await swap();
  } finally {
    outAnimation?.cancel?.();
    const inAnimation = await fadeScoreboard(scoreboard, 0, 1);
    inAnimation?.cancel?.();
  }
}
