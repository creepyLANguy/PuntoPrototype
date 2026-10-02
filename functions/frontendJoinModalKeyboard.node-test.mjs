import assert from "node:assert/strict";
import test from "node:test";

import { bootFrontend, seedBaseData, seedCourt, settle } from "./frontendHarness/harness.mjs";

let dom;
let document;
let window;
let setJoinModalViewportHeight;

test.before(async () => {
  seedBaseData();
  seedCourt("joinmodal", { name: "Join Modal Court" });

  dom = await bootFrontend({ url: "https://padel.test/" });
  document = dom.window.document;
  window = dom.window;

  let visualViewportHeight = 450;
  Object.defineProperty(window, "visualViewport", {
    configurable: true,
    get: () => ({
      height: visualViewportHeight,
      offsetTop: 0,
    }),
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
