import assert from "node:assert/strict";
import test from "node:test";

import { bootFrontend, seedBaseData, seedCourt, settle } from "./frontendHarness/harness.mjs";

let dom;
let document;
let window;
let setJoinModalViewportHeight;
let visualViewportScale = 1;
let useVisualViewport = true;

test.before(async () => {
  seedBaseData();
  seedCourt("jmada", { name: "Join Modal Court" });

  dom = await bootFrontend({ url: "https://padel.test/" });
  document = dom.window.document;
  window = dom.window;

  let visualViewportHeight = 450;
  Object.defineProperty(window, "visualViewport", {
    configurable: true,
    get: () => useVisualViewport ? ({
      height: visualViewportHeight,
      offsetTop: 0,
      scale: visualViewportScale,
    }) : undefined,
  });

  setJoinModalViewportHeight = (height) => {
    visualViewportHeight = height;
  };

  document.getElementById("playPage").style.display = "flex";
  document.getElementById("spectatePage").style.display = "flex";

  const playCard = document.querySelector("#playPage .create-card");
  const spectateCard = document.querySelector("#spectatePage .create-card");

  const playBaseRect = {
    top: 300,
    bottom: 700,
    left: 0,
    right: 320,
    width: 320,
    height: 400,
  };

  const spectateBaseRect = {
    top: 300,
    bottom: 650,
    left: 0,
    right: 320,
    width: 320,
    height: 350,
  };

  playCard.getBoundingClientRect = () => {
    const shift = parseFloat(playCard.style.getPropertyValue("--keyboard-shift-y")) || 0;
    return {
      ...playBaseRect,
      top: playBaseRect.top + shift,
      bottom: playBaseRect.bottom + shift,
    };
  };

  spectateCard.getBoundingClientRect = () => {
    const shift = parseFloat(spectateCard.style.getPropertyValue("--keyboard-shift-y")) || 0;
    return {
      ...spectateBaseRect,
      top: spectateBaseRect.top + shift,
      bottom: spectateBaseRect.bottom + shift,
    };
  };
});

test("join modals move above a reduced viewport", async () => {
  setJoinModalViewportHeight(450);

  window.dispatchEvent(new window.Event("resize"));
  await settle(30);

  assert.equal(
    document.querySelector("#playPage .create-card").style.getPropertyValue("--keyboard-shift-y"),
    "-266px",
  );
  assert.equal(
    document
      .querySelector("#spectatePage .create-card")
      .style.getPropertyValue("--keyboard-shift-y"),
    "-216px",
  );
});

test("join modal shift clears when the viewport is restored", async () => {
  setJoinModalViewportHeight(800);

  window.dispatchEvent(new window.Event("resize"));
  await settle(30);

  assert.equal(
    document.querySelector("#playPage .create-card").style.getPropertyValue("--keyboard-shift-y"),
    "0px",
  );
  assert.equal(
    document
      .querySelector("#spectatePage .create-card")
      .style.getPropertyValue("--keyboard-shift-y"),
    "0px",
  );
});

test("mobile input panels recenter on keyboard dismissal even while the input stays focused", async () => {
  const originalMatchMedia = window.matchMedia;
  window.matchMedia = (query) => ({
    ...originalMatchMedia(query),
    matches: query === "(max-width: 768px), (pointer: coarse)",
  });
  const modal = document.getElementById("joinCourtModal");
  modal.classList.remove("hidden");
  const input = document.getElementById("joinCourtModalPassword");

  try {
    setJoinModalViewportHeight(800);
    input.focus();
    await settle(30);
    assert.equal(modal.style.getPropertyValue("--join-vertical-alignment"), "flex-start");

    for (const height of [450, 320, 800, 450, 800]) {
      setJoinModalViewportHeight(height);
      window.dispatchEvent(new window.Event("resize"));
      await settle(30);
      if (height === 800) await settle(380);

      for (const id of [
        "playPage",
        "spectatePage",
        "joinCourtModal",
        "resetModal",
        "adminAuthPage",
      ]) {
        const page = document.getElementById(id);
        assert.equal(page.style.getPropertyValue("--join-viewport-height"), `${height}px`);
        assert.equal(
          page.style.getPropertyValue("--join-vertical-alignment"),
          height === 800 ? "center" : "flex-start",
        );
        assert.equal(
          page
            .querySelector(".create-card, .reset-box")
            .style.getPropertyValue("--keyboard-shift-y"),
          "0px",
        );
      }
      assert.equal(document.activeElement, input);
    }

    // Zoom must neither imitate a keyboard nor freeze an existing open state.
    setJoinModalViewportHeight(450);
    window.dispatchEvent(new window.Event("resize"));
    await settle(30);
    visualViewportScale = 2;
    setJoinModalViewportHeight(225);
    window.dispatchEvent(new window.Event("resize"));
    await settle(30);
    assert.equal(modal.style.getPropertyValue("--join-vertical-alignment"), "flex-start");
    setJoinModalViewportHeight(400);
    window.dispatchEvent(new window.Event("resize"));
    await settle(410);
    assert.equal(modal.style.getPropertyValue("--join-vertical-alignment"), "center");
  } finally {
    visualViewportScale = 1;
    setJoinModalViewportHeight(800);
    input.blur();
    window.matchMedia = originalMatchMedia;
    modal.classList.add("hidden");
  }
});

test("mobile focus without a software keyboard falls back to centered panels", async () => {
  const originalMatchMedia = window.matchMedia;
  window.matchMedia = (query) => ({
    ...originalMatchMedia(query),
    matches: query === "(max-width: 768px), (pointer: coarse)",
  });
  const modal = document.getElementById("joinCourtModal");
  const input = document.getElementById("joinCourtModalPassword");
  modal.classList.remove("hidden");

  try {
    setJoinModalViewportHeight(800);
    input.focus();
    await settle(30);
    assert.equal(modal.style.getPropertyValue("--join-vertical-alignment"), "flex-start");

    await settle(750);
    assert.equal(modal.style.getPropertyValue("--join-vertical-alignment"), "center");
    assert.equal(document.activeElement, input);

    // A small browser-toolbar change is not a keyboard opening.
    setJoinModalViewportHeight(750);
    window.dispatchEvent(new window.Event("resize"));
    await settle(30);
    assert.equal(modal.style.getPropertyValue("--join-vertical-alignment"), "center");

    visualViewportScale = 2;
    setJoinModalViewportHeight(400);
    window.dispatchEvent(new window.Event("resize"));
    await settle(30);
    assert.equal(modal.style.getPropertyValue("--join-vertical-alignment"), "center");
  } finally {
    visualViewportScale = 1;
    setJoinModalViewportHeight(800);
    input.blur();
    window.matchMedia = originalMatchMedia;
    modal.classList.add("hidden");
  }
});

test("mobile panels recenter on blur when no keyboard opened", async () => {
  const originalMatchMedia = window.matchMedia;
  window.matchMedia = (query) => ({
    ...originalMatchMedia(query),
    matches: query === "(max-width: 768px), (pointer: coarse)",
  });
  const modal = document.getElementById("joinCourtModal");
  const input = document.getElementById("joinCourtModalPassword");
  modal.classList.remove("hidden");

  try {
    input.focus();
    await settle(30);
    assert.equal(modal.style.getPropertyValue("--join-vertical-alignment"), "flex-start");
    input.blur();
    await settle(30);
    assert.equal(modal.style.getPropertyValue("--join-vertical-alignment"), "center");
  } finally {
    input.blur();
    window.matchMedia = originalMatchMedia;
    modal.classList.add("hidden");
  }
});

test("Play and Spectate focus synchronously on opening, before court loading", async () => {
  const originalMatchMedia = window.matchMedia;
  window.matchMedia = (query) => ({
    ...originalMatchMedia(query),
    matches: query === "(max-width: 768px), (pointer: coarse)",
  });

  try {
    for (const [action, id, inputId] of [
      ["Play", "playPage", "playCourtSearch"],
      ["Watch", "spectatePage", "spectateCourtSearch"],
    ]) {
      const page = document.getElementById(id);
      const input = document.getElementById(inputId);
      page.style.display = "none";
      const button = [...document.querySelectorAll(".menu-btn")]
        .find((element) => element.textContent.trim() === action);

      button.click();
      assert.equal(document.activeElement, input);
      await settle(30);
      assert.equal(page.style.getPropertyValue("--join-vertical-alignment"), "flex-start");

      input.blur();
      page.style.display = "none";
    }
  } finally {
    window.matchMedia = originalMatchMedia;
  }
});

test("mobile panels handle keyboards that also resize the layout viewport, with or without VisualViewport", async () => {
  const originalMatchMedia = window.matchMedia;
  const originalHeight = window.innerHeight;
  window.matchMedia = (query) => ({
    ...originalMatchMedia(query),
    matches: query === "(max-width: 768px), (pointer: coarse)",
  });
  const modal = document.getElementById("joinCourtModal");
  const input = document.getElementById("joinCourtModalPassword");
  modal.classList.remove("hidden");

  try {
    for (const withVisualViewport of [true, false]) {
      useVisualViewport = withVisualViewport;
      window.innerHeight = 800;
      setJoinModalViewportHeight(800);
      window.dispatchEvent(new window.Event("resize"));
      await settle(410);
      input.focus();

      for (const height of [450, 800, 450]) {
        window.innerHeight = height;
        setJoinModalViewportHeight(height);
        window.dispatchEvent(new window.Event("resize"));
        await settle(30);
        if (height === 800) await settle(380);
        assert.equal(
          modal.style.getPropertyValue("--join-vertical-alignment"),
          height === 800 ? "center" : "flex-start",
        );
      }

      // Blur can precede the keyboard's closing animation.
      input.blur();
      await settle(30);
      assert.equal(modal.style.getPropertyValue("--join-vertical-alignment"), "flex-start");
      window.innerHeight = 800;
      setJoinModalViewportHeight(800);
      window.dispatchEvent(new window.Event("resize"));
      await settle(410);
      assert.equal(modal.style.getPropertyValue("--join-vertical-alignment"), "center");
    }
  } finally {
    useVisualViewport = true;
    window.innerHeight = originalHeight;
    setJoinModalViewportHeight(800);
    input.blur();
    window.matchMedia = originalMatchMedia;
    modal.classList.add("hidden");
  }
});

test("modal movement animates briefly and blocks input only until it settles", async (t) => {
  const originalMatchMedia = window.matchMedia;
  const modal = document.getElementById("joinCourtModal");
  const card = modal.querySelector(".create-card");
  const input = document.getElementById("joinCourtModalPassword");
  const originalRect = card.getBoundingClientRect;
  const originalAnimate = card.animate;
  const animations = [];
  let activeAnimation = null;
  let reducedMotion = false;
  window.matchMedia = (query) => ({
    ...originalMatchMedia(query),
    matches: query === "(max-width: 768px), (pointer: coarse)" ||
      (query === "(prefers-reduced-motion: reduce)" && reducedMotion),
  });
  card.getBoundingClientRect = () => ({
    top: (modal.style.getPropertyValue("--join-vertical-alignment") === "center" ? 200 : 16) +
      (activeAnimation?.offset || 0),
    width: 320,
    height: 400,
  });
  card.animate = (keyframes, options) => {
    const animation = {
      keyframes,
      options,
      offset: parseFloat(keyframes[0].transform.slice("translateY(".length)),
      cancel() {
        if (activeAnimation === animation) activeAnimation = null;
        animation.oncancel?.();
      },
    };
    activeAnimation = animation;
    animations.push(animation);
    return animation;
  };
  const resize = async (height) => {
    setJoinModalViewportHeight(height);
    window.dispatchEvent(new window.Event("resize"));
    await settle(30);
    if (height === 800) await settle(380);
  };
  const dispatch = (target, type) => {
    const event = new window.Event(type, { bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  };
  modal.classList.remove("hidden");

  try {
    await resize(800);
    input.focus();
    await resize(450);
    await settle(260);
    await resize(800);

    await t.test("animates recentering and blocks pointer, typing, paste, and submit without blurring", () => {
      const animation = animations.at(-1);
      assert.equal(animation.options.duration, 180);
      assert.deepEqual(animation.keyframes, [
        { transform: "translateY(-184px)" },
        { transform: "translateY(0)" },
      ]);
      for (const type of ["pointerdown", "touchstart", "click", "keydown", "beforeinput", "paste", "submit"]) {
        assert.equal(dispatch(input, type), true, type);
      }
      const previousValue = input.value;
      const previousSelection = input.selectionStart;
      let observedEdits = 0;
      const observeEdit = () => { observedEdits += 1; };
      input.addEventListener("input", observeEdit);
      input.dispatchEvent(new window.InputEvent("beforeinput", {
        bubbles: true,
        cancelable: false,
        inputType: "insertCompositionText",
        data: "あ",
        isComposing: true,
      }));
      input.value += "あ";
      input.dispatchEvent(new window.InputEvent("input", {
        bubbles: true,
        cancelable: false,
        inputType: "insertCompositionText",
        data: "あ",
        isComposing: true,
      }));
      assert.equal(input.value, previousValue);
      assert.equal(input.selectionStart, previousSelection);
      assert.equal(observedEdits, 0);
      assert.equal(dispatch(document.body, "click"), false);
      assert.equal(document.activeElement, input);
      activeAnimation = null;
      animation.onfinish();
      assert.equal(dispatch(input, "beforeinput"), false);
      assert.equal(dispatch(input, "click"), false);
      input.value += "a";
      dispatch(input, "input");
      assert.equal(input.value, previousValue + "a");
      assert.equal(observedEdits, 1);
      input.removeEventListener("input", observeEdit);
      input.value = previousValue;
    });

    await t.test("animates upward and restores input on cancellation", async () => {
      await resize(450);
      const animation = animations.at(-1);
      assert.equal(animation.keyframes[0].transform, "translateY(184px)");
      assert.equal(dispatch(input, "beforeinput"), true);
      animation.cancel();
      assert.equal(dispatch(input, "beforeinput"), false);
    });

    await t.test("retargets an interrupted move without an old callback unlocking the new animation", async () => {
      await resize(800);
      const previous = animations.at(-1);
      previous.offset = -92;
      await resize(450);
      const current = animations.at(-1);
      assert.notEqual(previous, current);
      assert.equal(current.keyframes[0].transform, "translateY(92px)");
      previous.onfinish();
      assert.equal(dispatch(input, "beforeinput"), true);
      activeAnimation = null;
      current.onfinish();
      assert.equal(dispatch(input, "beforeinput"), false);
    });

    await t.test("has a bounded fallback lock if animation events never arrive", async () => {
      await resize(800);
      assert.equal(dispatch(input, "beforeinput"), true);
      await settle(260);
      assert.equal(dispatch(input, "beforeinput"), false);
    });

    await t.test("keeps the modal up through a quick submission error and refocus without locking input", async () => {
      await resize(450);
      activeAnimation?.cancel();
      const count = animations.length;
      input.blur();
      setJoinModalViewportHeight(800);
      window.dispatchEvent(new window.Event("resize"));
      await settle(80);
      assert.equal(modal.style.getPropertyValue("--join-vertical-alignment"), "flex-start");
      assert.equal(animations.length, count);
      assert.equal(dispatch(input, "beforeinput"), false);

      input.focus();
      await settle(30);
      // Even if the keyboard takes longer than the close grace period to
      // reopen, the new focus anticipation keeps the modal at the top.
      await settle(380);
      assert.equal(modal.style.getPropertyValue("--join-vertical-alignment"), "flex-start");
      assert.equal(animations.length, count);
      await resize(450);
      await settle(400);
      assert.equal(modal.style.getPropertyValue("--join-vertical-alignment"), "flex-start");
      assert.equal(animations.length, count);
      assert.equal(document.activeElement, input);
      assert.equal(dispatch(input, "beforeinput"), false);
    });

    await t.test("recenters once after a genuine dismissal despite repeated viewport events", async () => {
      input.blur();
      setJoinModalViewportHeight(800);
      window.dispatchEvent(new window.Event("resize"));
      await settle(30);
      const count = animations.length;
      for (let i = 0; i < 3; i += 1) {
        window.dispatchEvent(new window.Event("resize"));
        await settle(10);
        assert.equal(modal.style.getPropertyValue("--join-vertical-alignment"), "flex-start");
        assert.equal(animations.length, count);
      }
      await settle(260);
      assert.equal(modal.style.getPropertyValue("--join-vertical-alignment"), "center");
      assert.equal(animations.length, count + 1);
      activeAnimation = null;
      animations.at(-1).onfinish();
      input.focus();
      await resize(450);
      activeAnimation?.cancel();
    });

    await t.test("skips animation and input locking for reduced motion or missing animation support", async () => {
      await resize(800);
      activeAnimation = null;
      animations.at(-1).onfinish();
      reducedMotion = true;
      const count = animations.length;
      await resize(450);
      assert.equal(animations.length, count);
      assert.equal(dispatch(input, "beforeinput"), false);
      reducedMotion = false;
      card.animate = undefined;
      await resize(800);
      assert.equal(animations.length, count);
      assert.equal(dispatch(input, "beforeinput"), false);
    });
  } finally {
    activeAnimation?.cancel();
    input.blur();
    modal.classList.add("hidden");
    card.getBoundingClientRect = originalRect;
    card.animate = originalAnimate;
    window.matchMedia = originalMatchMedia;
    setJoinModalViewportHeight(800);
  }
});
