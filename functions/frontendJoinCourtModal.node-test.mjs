// Integration tests for the direct "Join as a player" password modal.
import assert from "node:assert/strict";
import test from "node:test";

import {
  bootFrontend,
  seedBaseData,
  seedCourt,
  settle,
  waitFor,
} from "./frontendHarness/harness.mjs";

let document;
let window;

const $ = (id) => document.getElementById(id);

function submitJoinForm() {
  $("joinCourtModalForm").dispatchEvent(
    new window.Event("submit", { bubbles: true, cancelable: true }),
  );
}

test.before(async () => {
  seedBaseData();
  seedCourt("jmada", { name: "Join Modal Court" });

  const dom = await bootFrontend({ url: "https://padel.test/c/jmada" });
  window = dom.window;
  document = window.document;

  await waitFor(
    () => $("scoreboardPage").style.display !== "none",
    { label: "scoreboard for the selected court" },
  );
  await settle(30);
});

test("Join as a player opens a direct password modal without displaying Play", async () => {
  $("settingsBtn").click();
  await waitFor(
    () => !$("settingsModal").classList.contains("hidden"),
    { label: "scoreboard settings modal" },
  );

  $("joinCourtBtn").click();

  assert.equal($("joinCourtModal").classList.contains("hidden"), false);
  const joinPanel = $("joinCourtModal").querySelector(".join-court-modal-card");
  const optionsPanel = $("settingsModal").querySelector(".settings-box");
  const panelBackground = window.getComputedStyle(joinPanel).backgroundColor;
  assert.equal(
    panelBackground,
    window.getComputedStyle(optionsPanel).backgroundColor,
    "join panel uses the Options panel's dark background",
  );
  assert.notEqual(panelBackground, "rgba(0, 0, 0, 0)");
  assert.notEqual(panelBackground, "transparent");
  document.body.classList.add("light-mode");
  assert.equal(
    window.getComputedStyle(joinPanel).backgroundColor,
    window.getComputedStyle(optionsPanel).backgroundColor,
    "join panel uses the Options panel's light background",
  );
  document.body.classList.remove("light-mode");
  assert.notEqual(
    window.getComputedStyle($("appearanceMenuBtn")).display,
    "none",
    "floating appearance button remains visible outside the Admin Portal",
  );
  assert.equal($("joinCourtModalCourtName").textContent, "Join Modal Court");
  assert.equal($("playPage").style.display, "none");
  assert.equal($("joinCourtModalPassword").value, "");
  assert.equal(document.activeElement?.id, "joinCourtModalPassword");
});

test("the join modal surfaces required and incorrect password errors inline", async () => {
  submitJoinForm();
  await settle();

  assert.equal($("joinCourtModalPasswordError").textContent, "Password required.");
  assert.equal(
    window.getComputedStyle($("joinCourtModalPasswordError")).display,
    "block",
    "a populated password error remains visible",
  );
  assert.equal(
    window.getComputedStyle($("joinCourtModalError")).display,
    "none",
    "empty general error does not reserve vertical space",
  );
  assert.equal($("joinCourtModal").classList.contains("hidden"), false);

  $("joinCourtModalPassword").value = "incorrect";
  submitJoinForm();

  await waitFor(
    () => $("joinCourtModalPasswordError").textContent === "Incorrect password.",
    { label: "incorrect password error" },
  );
  assert.equal($("joinCourtModalError").textContent, "");
  assert.equal(
    window.getComputedStyle($("joinCourtModalError")).display,
    "none",
  );
  assert.equal($("joinCourtModal").classList.contains("hidden"), false);
});

test("Escape dismisses the join modal without leaving the court", async () => {
  document.body.dispatchEvent(
    new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );

  await waitFor(
    () =>
      $("joinCourtModal").classList.contains("hidden") &&
      $("scoreboardPage").style.display !== "none" &&
      !$("settingsModal").classList.contains("hidden"),
    { label: "join modal dismissed back to the Options menu" },
  );
  assert.equal(window.location.pathname, "/c/jmada");
  assert.equal($("settingsModal").classList.contains("hidden"), false);

  $("joinCourtBtn").click();
  await waitFor(
    () => !$("joinCourtModal").classList.contains("hidden"),
    { label: "join modal reopened from Options" },
  );
});

test("a correct password joins the selected court and dismisses the modal", async () => {
  $("joinCourtModalPassword").value = "pw";
  submitJoinForm();

  await waitFor(
    () =>
      $("joinCourtModal").classList.contains("hidden") &&
      !document.body.classList.contains("spectating-mode"),
    { label: "player session after successful join" },
  );

  assert.equal($("playPage").style.display, "none");
  assert.equal($("scoreboardPage").style.display, "flex");
});

function stubScoreboardAnimations() {
  const scoreboard = document.querySelector(".scoreboard");
  const hadOwnAnimate = Object.prototype.hasOwnProperty.call(scoreboard, "animate");
  const originalAnimate = scoreboard.animate;
  const calls = [];

  scoreboard.animate = (keyframes, options) => {
    calls.push({ keyframes, options });
    return { finished: Promise.resolve(), cancel() {} };
  };

  return {
    calls,
    restore() {
      if (hadOwnAnimate) scoreboard.animate = originalAnimate;
      else delete scoreboard.animate;
    },
  };
}

function assertFadeOutAndIn(calls, context) {
  assert.ok(calls.length >= 2, `${context}: expected fade-out and fade-in animations`);
  assert.equal(calls[0].keyframes[0].opacity, 1, `${context}: fade starts visible`);
  assert.equal(calls[0].keyframes.at(-1).opacity, 0, `${context}: fade-out ends hidden`);
  assert.equal(calls[1].keyframes[0].opacity, 0, `${context}: fade-in starts hidden`);
  assert.equal(calls[1].keyframes.at(-1).opacity, 1, `${context}: fade-in ends visible`);
}

test("switching between player and spectator modes fades smoothly in both directions", async () => {
  const animationStub = stubScoreboardAnimations();
  try {
    $("settingsBtn").click();
    await waitFor(
      () => !$("settingsModal").classList.contains("hidden"),
      { label: "Options before switching to spectator" },
    );
    $("switchToSpectateBtn").click();
    await waitFor(
      () =>
        document.body.classList.contains("spectating-mode") &&
        animationStub.calls.length >= 2,
      { label: "spectator mode and its fade transition" },
    );
    assertFadeOutAndIn(animationStub.calls, "player to spectator");

    $("settingsBtn").click();
    await waitFor(
      () => !$("settingsModal").classList.contains("hidden"),
      { label: "Options before joining as player" },
    );
    $("joinCourtBtn").click();
    await waitFor(
      () => !$("joinCourtModal").classList.contains("hidden"),
      { label: "join modal from spectator mode" },
    );
    animationStub.calls.length = 0;
    $("joinCourtModalPassword").value = "pw";
    submitJoinForm();
    await waitFor(
      () =>
        $("joinCourtModal").classList.contains("hidden") &&
        !document.body.classList.contains("spectating-mode") &&
        animationStub.calls.length >= 2,
      { label: "player mode and its fade transition" },
    );
    assertFadeOutAndIn(animationStub.calls, "spectator to player");
  } finally {
    animationStub.restore();
  }
});
