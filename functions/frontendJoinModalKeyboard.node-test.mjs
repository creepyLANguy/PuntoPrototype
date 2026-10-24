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
      ["Spectate", "spectatePage", "spectateCourtSearch"],
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
      await settle(30);
      input.focus();

      for (const height of [450, 800, 450]) {
        window.innerHeight = height;
        setJoinModalViewportHeight(height);
        window.dispatchEvent(new window.Event("resize"));
        await settle(30);
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
      await settle(30);
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
