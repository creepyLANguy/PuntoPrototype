// Integration tests for the direct "Join as a player" password modal.
import assert from "node:assert/strict";
import test from "node:test";

import {
  bootFrontend,
  firestoreState,
  seedBaseData,
  seedCourt,
  settle,
  waitFor,
} from "./frontendHarness/harness.mjs";

let document;
let window;

const $ = (id) => document.getElementById(id);

test("shared theme buttons synchronize selection, persist changes, and retain per-theme team colours", () => {
  const locations = [$("appearanceMenu"), $("settingsModal")];
  const colours = {
    light: { A: "#123456", B: "#654321" },
    dark: { A: "#abcdef", B: "#fedcba" },
  };
  const assertTheme = (theme) => {
    assert.equal(window.localStorage.getItem("theme"), theme);
    assert.equal(document.body.classList.contains("light-mode"), theme === "light");
    for (const location of locations) {
      const buttons = location.querySelectorAll("[data-theme-choice]");
      assert.equal(buttons.length, 2);
      for (const button of buttons) {
        const active = button.dataset.themeChoice === theme;
        assert.equal(button.classList.contains("active"), active);
        assert.equal(button.getAttribute("aria-pressed"), String(active));
      }
    }
  };
  const choose = (location, theme) => {
    location.querySelector(`[data-theme-choice="${theme}"]`).click();
    assertTheme(theme);
  };
  const setColours = (location, theme) => {
    for (const [team, colour] of Object.entries(colours[theme])) {
      const input = location.querySelector(`[data-team-colour="${team}"]`);
      input.value = colour;
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
    }
  };
  const assertColours = (theme) => {
    for (const [team, colour] of Object.entries(colours[theme])) {
      assert.equal(document.body.style.getPropertyValue(`--team${team}colour`), colour);
      for (const location of locations) {
        assert.equal(location.querySelector(`[data-team-colour="${team}"]`).value, colour);
      }
    }
  };

  choose(locations[0], "light");
  setColours(locations[0], "light");
  choose(locations[1], "dark");
  setColours(locations[1], "dark");
  choose(locations[1], "light");
  assertColours("light");
  choose(locations[0], "dark");
  assertColours("dark");
  assert.deepEqual(JSON.parse(window.localStorage.getItem("punto_team_colours")), colours);
});

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

  await waitFor(() => $("scoreboardPage").style.display !== "none", {
    label: "scoreboard for the selected court",
  });
  await settle(30);
});

test("Join as a player opens a direct password modal without displaying Play", async () => {
  $("settingsBtn").click();
  await waitFor(() => !$("settingsModal").classList.contains("hidden"), {
    label: "scoreboard settings modal",
  });

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
  // The active surface is synchronized when the modal opens, so switching
  // themes while it is open is not the same scenario as opening in light mode.
  $("joinCourtModal").classList.add("hidden");
  document.body.classList.add("light-mode");
  $("settingsModal").classList.remove("hidden");
  $("joinCourtBtn").click();
  assert.equal(
    window.getComputedStyle(joinPanel).backgroundColor,
    window.getComputedStyle(optionsPanel).backgroundColor,
    "opening the join modal in light mode matches the Options surface",
  );
  $("joinCourtModal").classList.add("hidden");
  document.body.classList.remove("light-mode");
  $("settingsModal").classList.remove("hidden");
  $("joinCourtBtn").click();
  assert.equal(
    window.getComputedStyle($("appearanceMenuBtn")).display,
    "none",
    "floating appearance button is hidden while the court view is active",
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
  assert.equal(
    $("joinCourtModal").querySelector(":scope > .inline-loading-overlay")?.style.display,
    "flex",
    "password submission shows a spinner synchronously",
  );
  const overlay = $("joinCourtModal").querySelector(":scope > .inline-loading-overlay");
  assert.equal(window.getComputedStyle(overlay).position, "absolute");
  assert.ok(
    Number(window.getComputedStyle(overlay).zIndex) >
      Number(window.getComputedStyle($("joinCourtModalForm")).zIndex || 0),
    "the loading spinner stacks above the modal card",
  );

  await waitFor(() => $("joinCourtModalPasswordError").textContent === "Incorrect password.", {
    label: "incorrect password error",
  });
  assert.equal($("joinCourtModalError").textContent, "");
  assert.equal(window.getComputedStyle($("joinCourtModalError")).display, "none");
  assert.equal($("joinCourtModal").classList.contains("hidden"), false);
  assert.equal(
    $("joinCourtModal").querySelector(":scope > .inline-loading-overlay").style.display,
    "none",
  );
  assert.equal(document.querySelector(".toast")?.textContent === "Switched to Player view.", false);
});

test("join modal backend errors release loading and keep the modal route available for retry", async () => {
  const admin = firestoreState.docs.get("admin/goodies");
  firestoreState.docs.delete("admin/goodies");
  try {
    $("joinCourtModalPassword").value = "pw";
    submitJoinForm();
    assert.equal(
      $("joinCourtModal").querySelector(":scope > .inline-loading-overlay").style.display,
      "flex",
    );
    await waitFor(() => $("joinCourtModalError").textContent.includes("Admin document missing"));
    assert.equal(
      $("joinCourtModal").querySelector(":scope > .inline-loading-overlay").style.display,
      "none",
    );
    assert.equal($("joinCourtModal").classList.contains("hidden"), false);
    assert.equal(window.location.pathname, "/c/jmada");
    assert.equal(document.body.classList.contains("spectating-mode"), true);
    assert.equal(
      [...document.querySelectorAll(".toast")].some(
        (toast) => toast.textContent === "Switched to Player view.",
      ),
      false,
    );
  } finally {
    firestoreState.docs.set("admin/goodies", admin);
  }
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
  await waitFor(() => !$("joinCourtModal").classList.contains("hidden"), {
    label: "join modal reopened from Options",
  });
});

test("a court-load failure restores the join modal and clears both loading surfaces", async (t) => {
  const originalGet = firestoreState.docs.get.bind(firestoreState.docs);
  let reads = 0;
  const readStub = t.mock.method(firestoreState.docs, "get", (path) => {
    if (path === "courts/jmada" && ++reads === 2) {
      throw new Error("Court load failed.");
    }
    return originalGet(path);
  });
  try {
    $("joinCourtModalPassword").value = "pw";
    submitJoinForm();
    await waitFor(() => $("joinCourtModalError").textContent === "Court load failed.");
    assert.equal($("joinCourtModal").classList.contains("hidden"), false);
    assert.equal(
      $("joinCourtModal").querySelector(":scope > .inline-loading-overlay").style.display,
      "none",
    );
    assert.equal(
      $("scoreboardPage").querySelector(":scope > .inline-loading-overlay").style.display,
      "none",
    );
    assert.equal(window.history.state.viewState.modal, "joinCourt");
    assert.equal(window.location.pathname, "/c/jmada");
    assert.equal(document.body.classList.contains("spectating-mode"), true);
    assert.equal(
      [...document.querySelectorAll(".toast")].some(
        (toast) => toast.textContent === "Switched to Player view.",
      ),
      false,
    );
  } finally {
    readStub.mock.restore();
  }
});

test("a correct password joins the selected court and dismisses the modal", async () => {
  let releaseFade;
  const fadeGate = new Promise((resolve) => {
    releaseFade = resolve;
  });
  const animationStub = stubScoreboardAnimations(fadeGate);
  try {
    $("joinCourtModalPassword").value = "pw";
    submitJoinForm();
    submitJoinForm();
    await waitFor(() => $("joinCourtModal").classList.contains("hidden"));
    assert.equal(
      $("scoreboardPage").querySelector(":scope > .inline-loading-overlay").style.display,
      "flex",
    );
    assert.equal(document.body.classList.contains("spectating-mode"), true);
    assert.equal(
      [...document.querySelectorAll(".toast")].some(
        (toast) => toast.textContent === "Switched to Player view.",
      ),
      false,
      "success is not announced before the court finishes loading",
    );
    submitJoinForm();
    releaseFade();

    await waitFor(
      () =>
        $("joinCourtModal").classList.contains("hidden") &&
        !document.body.classList.contains("spectating-mode"),
      { label: "player session after successful join" },
    );

    assert.equal($("playPage").style.display, "none");
    assert.equal($("scoreboardPage").style.display, "flex");
    await waitFor(() =>
      [...document.querySelectorAll(".toast")].some(
        (toast) => toast.textContent === "Switched to Player view.",
      ),
    );
    assert.equal(
      [...document.querySelectorAll(".toast")].filter(
        (toast) => toast.textContent === "Switched to Player view.",
      ).length,
      1,
      "only a completed join produces a toast, even with duplicate submissions",
    );
    assert.equal(
      $("joinCourtModal").querySelector(":scope > .inline-loading-overlay").style.display,
      "none",
    );
    assert.equal(
      $("scoreboardPage").querySelector(":scope > .inline-loading-overlay").style.display,
      "none",
    );
    assert.equal(window.location.pathname, "/c/jmada");
  } finally {
    releaseFade();
    animationStub.restore();
  }
});

function stubScoreboardAnimations(finished = Promise.resolve()) {
  const scoreboard = document.querySelector(".scoreboard");
  const hadOwnAnimate = Object.prototype.hasOwnProperty.call(scoreboard, "animate");
  const originalAnimate = scoreboard.animate;
  const calls = [];

  scoreboard.animate = (keyframes, options) => {
    calls.push({ keyframes, options });
    return { finished, cancel() {} };
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
    await waitFor(() => !$("settingsModal").classList.contains("hidden"), {
      label: "Options before switching to spectator",
    });
    $("switchToSpectateBtn").click();
    await waitFor(
      () => document.body.classList.contains("spectating-mode") && animationStub.calls.length >= 2,
      { label: "spectator mode and its fade transition" },
    );
    assertFadeOutAndIn(animationStub.calls, "player to spectator");

    $("settingsBtn").click();
    await waitFor(() => !$("settingsModal").classList.contains("hidden"), {
      label: "Options before joining as player",
    });
    $("joinCourtBtn").click();
    await waitFor(() => !$("joinCourtModal").classList.contains("hidden"), {
      label: "join modal from spectator mode",
    });
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
