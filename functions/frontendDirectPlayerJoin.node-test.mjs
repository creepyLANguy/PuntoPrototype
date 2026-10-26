import assert from "node:assert/strict";
import test from "node:test";

import {
  bootFrontend,
  seedBaseData,
  seedCourt,
  seedDoc,
  writeDoc,
  firestoreState,
  pushScoreSnapshot,
  makeScore,
  waitFor,
  settle,
} from "./frontendHarness/harness.mjs";

let document;
let window;

function submitJoinModal() {
  document.getElementById("joinCourtModalForm").dispatchEvent(
    new window.Event("submit", { bubbles: true, cancelable: true }),
  );
}

test.before(async () => {
  seedBaseData();
  seedCourt("drcta", { name: "Direct Player Court" });

  seedCourt("mtcha", {
    name: "Match Route Court",
    activeMatchId: "qrstux",
    matchName: "Active Match",
  });
  seedDoc("matches/abcdef", {
    matchId: "abcdef",
    name: "Linked Match",
    kind: "tournament",
    visibility: "public",
    status: "live",
    currentCourtId: "mtcha",
    lastCourtId: "mtcha",
    teamNames: { A: "Linked A", B: "Linked B" },
    playerNames: { A1: "", A2: "", B1: "", B2: "" },
    scoringMode: "straight",
    scoringOptions: {
      scoringMode: "straight",
      deuceMode: "standard",
      tiebreakMode: "sixAllSeven",
    },
    scoreVersion: 0,
    tournamentId: "abcdefg",
  });
  pushScoreSnapshot(
    "abcdef",
    makeScore({
      A: { points: 7, games: 0, sets: 0, totalPoints: 7 },
      B: { points: 2, games: 0, sets: 0, totalPoints: 2 },
      scoringOptions: {
        scoringMode: "straight",
        deuceMode: "standard",
        tiebreakMode: "sixAllSeven",
      },
    }),
  );

  const dom = await bootFrontend({ url: "https://padel.test/p/drcta" });
  document = dom.window.document;
  window = dom.window;

  await waitFor(
    () =>
      !document.getElementById("joinCourtModal").classList.contains("hidden") &&
      document.getElementById("scoreboardPage").style.display !== "none",
    { label: "direct player join modal" },
  );
  await settle(30);
});

test("/p/<court> autofocuses the player password field", () => {
  assert.equal(document.activeElement?.id, "joinCourtModalPassword");
});

test("Play password errors clear loading and allow another attempt without a success toast", async () => {
  const passwordInput = document.getElementById("joinCourtModalPassword");
  const submit = () => document.getElementById("joinCourtModalForm").dispatchEvent(
    new window.Event("submit", { bubbles: true, cancelable: true }),
  );
  const spinner = () => document.querySelector("#joinCourtModal > .inline-loading-overlay");
  const playerToasts = () =>
    [...document.querySelectorAll(".toast")].filter(
      (toast) => toast.textContent === "Switched to Player view.",
    );
  submit();
  assert.equal(document.getElementById("joinCourtModalPasswordError").textContent, "Password required.");
  assert.equal(spinner(), null);

  passwordInput.value = "incorrect";
  submit();
  assert.equal(
    spinner()?.style.display,
    "flex",
    "loading is visible before the first request resolves",
  );
  assert.equal(window.getComputedStyle(spinner()).position, "absolute");
  assert.ok(
    Number(window.getComputedStyle(spinner()).zIndex) >
      Number(
        window.getComputedStyle(document.querySelector("#joinCourtModal > .join-court-modal-card")).zIndex || 0,
      ),
    "the spinner overlay stacks above the password card",
  );
  await waitFor(
    () => document.getElementById("joinCourtModalPasswordError").textContent === "Incorrect password.",
  );
  assert.equal(spinner().style.display, "none");
  assert.equal(playerToasts().length, 0);
  assert.equal(window.location.pathname, "/p/drcta");

  const admin = firestoreState.docs.get("admin/goodies");
  firestoreState.docs.delete("admin/goodies");
  try {
    passwordInput.value = "pw";
    submit();
    assert.equal(spinner().style.display, "flex");
    await waitFor(() =>
      document.getElementById("joinCourtModalError").textContent.includes("Admin document missing"),
    );
    assert.equal(spinner().style.display, "none", "backend errors release the loading overlay");
    assert.equal(playerToasts().length, 0);
  } finally {
    firestoreState.docs.set("admin/goodies", admin);
  }
});

test("/p/<court> player submit primes and plays the join sound", async () => {
  const passwordInput = document.getElementById("joinCourtModalPassword");
  passwordInput.value = "pw";

  submitJoinModal();
  assert.equal(
    document.querySelector("#joinCourtModal > .inline-loading-overlay")?.style.display,
    "flex",
  );
  submitJoinModal();

  await waitFor(() => document.getElementById("scoreboardPage").style.display !== "none", {
    label: "player scoreboard to be shown",
  });
  await waitFor(() => window.__audioTestState.starts === 1, { label: "direct player join sound" });

  assert.ok(
    window.__audioTestState.resumeCalls > 0,
    "the AudioContext should be resumed from the submit gesture",
  );
  assert.equal(window.__audioTestState.starts, 1);
  await waitFor(
    () => document.querySelector("#joinCourtModal > .inline-loading-overlay")?.style.display === "none",
  );
  assert.equal(
    [...document.querySelectorAll(".toast")].filter(
      (toast) => toast.textContent === "Switched to Player view.",
    ).length,
    1,
    "duplicate submits produce only one completed player join",
  );
  assert.equal(window.location.pathname, "/c/drcta");
});

test("/p/<matchId> loads that match on its court as a spectator and then authenticates as a player", async () => {
  window.history.pushState({}, "", "/p/abcdef");
  window.dispatchEvent(new window.PopStateEvent("popstate"));

  await waitFor(
    () =>
      !document.getElementById("joinCourtModal").classList.contains("hidden") &&
      document.getElementById("scoreboardPage").style.display !== "none",
    { label: "match-target join prompt" },
  );
  await waitFor(() => getRenderedScoreForDirectJoin(document).pointsA === "7", {
    label: "linked match score",
  });

  assert.equal(document.getElementById("joinCourtModalCourtName").textContent, "Match Route Court");
  assert.notEqual(document.getElementById("scoreboardPage").style.display, "none");
  assert.equal(window.location.pathname, "/p/abcdef");
  assert.equal(document.body.classList.contains("spectating-mode"), true);

  document.getElementById("joinCourtModalPassword").value = "pw";
  submitJoinModal();

  await waitFor(
    () =>
      document.getElementById("scoreboardPage").style.display !== "none" &&
      !document.body.classList.contains("spectating-mode"),
    { label: "linked match player join" },
  );
  await settle(30);

  assert.equal(getRenderedScoreForDirectJoin(document).pointsA, "7");
  assert.equal(getRenderedScoreForDirectJoin(document).pointsB, "2");
});

test("an explicit match link keeps its score after listener refresh", async () => {
  document.dispatchEvent(new window.Event("visibilitychange"));
  await settle(30);
  pushScoreSnapshot(
    "abcdef",
    makeScore({
      A: { points: 8, games: 0, sets: 0, totalPoints: 8 },
      B: { points: 2, games: 0, sets: 0, totalPoints: 2 },
      scoringOptions: {
        scoringMode: "straight",
        deuceMode: "standard",
        tiebreakMode: "sixAllSeven",
      },
    }),
  );
  await waitFor(() => getRenderedScoreForDirectJoin(document).pointsA === "8", {
    label: "linked match score after reconnect",
  });
});

test("switching to a court link clears the explicit match selection", async () => {
  pushScoreSnapshot("qrstux", makeScore({ A: { points: 1, games: 0, sets: 0, totalPoints: 1 } }));
  window.history.pushState({}, "", "/p/mtcha");
  window.dispatchEvent(new window.PopStateEvent("popstate"));

  await waitFor(() => getRenderedScoreForDirectJoin(document).pointsA === "15", {
    label: "court's active match score",
  });
  assert.equal(document.body.classList.contains("spectating-mode"), true);
});

test("an ordinary court player join follows subsequent active match changes", async () => {
  document.getElementById("joinCourtModalPassword").value = "pw";
  submitJoinModal();
  await waitFor(() => !document.body.classList.contains("spectating-mode"), {
    label: "court player join",
  });

  seedDoc("matches/jkmnpq", {
    ...firestoreState.docs.get("matches/qrstux"),
    matchId: "jkmnpq",
  });
  pushScoreSnapshot("jkmnpq", makeScore({ A: { points: 2, games: 0, sets: 0, totalPoints: 2 } }));
  writeDoc("courts/mtcha", {
    ...firestoreState.docs.get("courts/mtcha"),
    activeMatchId: "jkmnpq",
    lastMatchId: "jkmnpq",
  });
  await waitFor(() => getRenderedScoreForDirectJoin(document).pointsA === "30", {
    label: "new active match score after player join",
  });
});

test("an explicit link pins a match already followed through its court", async () => {
  window.history.pushState({}, "", "/p/jkmnpq");
  window.dispatchEvent(new window.PopStateEvent("popstate"));
  await waitFor(
    () =>
      !document.getElementById("joinCourtModal").classList.contains("hidden") &&
      document.body.classList.contains("spectating-mode"),
    { label: "explicit link to the current match" },
  );

  writeDoc("courts/mtcha", {
    ...firestoreState.docs.get("courts/mtcha"),
    activeMatchId: "qrstux",
    lastMatchId: "qrstux",
  });
  await settle(30);
  pushScoreSnapshot("jkmnpq", makeScore({ A: { points: 3, games: 0, sets: 0, totalPoints: 3 } }));
  await waitFor(() => getRenderedScoreForDirectJoin(document).pointsA === "40", {
    label: "explicitly pinned current match score",
  });
});

function getRenderedScoreForDirectJoin(document) {
  return {
    pointsA: document.getElementById("pointsA").textContent,
    pointsB: document.getElementById("pointsB").textContent,
  };
}
