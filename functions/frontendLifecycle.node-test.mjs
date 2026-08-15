// Frontend integration tests: court lifecycle flows that affect scoring —
// reset (scoreVersion bump), set-win detection, admin closure, spectating.
import assert from "node:assert/strict";
import test from "node:test";

import
{
  bootFrontend,
  seedBaseData,
  seedCourt,
  joinCourtAsPlayer,
  getRenderedScore,
  pushScoreSnapshot,
  makeScore,
  waitFor,
  settle,
  firestoreState,
  callableHandlers,
  writeDoc
} from "./frontendHarness/harness.mjs";

let document;
let window;

test.before(async () =>
{
  seedBaseData();
  seedCourt("lifecourt");
  seedCourt("watchcourt", { teamNames: { A: "Reds", B: "Blues" } });

  // Mimic the resetCourt Cloud Function: zero the score, clear the event log,
  // bump the court's scoreVersion so pre-reset events become stale.
  callableHandlers.set("resetCourt", async ({ courtId, newPassword }) =>
  {
    const courtPath = `courts/${courtId}`;
    const court = firestoreState.docs.get(courtPath) || {};
    const scoreVersion = (Number(court.scoreVersion) || 0) + 1;

    for (const path of [...firestoreState.docs.keys()])
    {
      if (path.startsWith(`courts/${courtId}/events/`))
      {
        firestoreState.docs.delete(path);
      }
    }
    firestoreState.backendScores.delete(courtId);

    writeDoc(courtPath, {
      ...court,
      scoreVersion,
      password: newPassword || court.password
    });
    pushScoreSnapshot(courtId, makeScore());

    return { data: { scoreVersion } };
  });

  const dom = await bootFrontend();
  window = dom.window;
  document = window.document;
});

test("set win: winning a set fills a set dot and shows the celebration overlay", async () =>
{
  await joinCourtAsPlayer(document, "lifecourt");

  // Take team A to 5-0 games, 40-0, entirely through real point events.
  for (let i = 0; i < 23; i++)
  {
    document.getElementById("addPointA").click();
    await settle(0);
  }

  await waitFor(() => getRenderedScore(document).gamesA === 5, { label: "A at 5 games" });
  await waitFor(() => getRenderedScore(document).pointsA === "40", { label: "A at 40" });

  document.getElementById("addPointA").click();
  await waitFor(() => getRenderedScore(document).setsA === 1, { label: "A wins the set" });

  const rendered = getRenderedScore(document);
  assert.equal(rendered.gamesA, 0);
  assert.equal(rendered.pointsA, "0");

  const overlay = document.getElementById("setWinOverlay");
  assert.equal(overlay.classList.contains("hidden"), false);
  assert.equal(overlay.dataset.winner, "A");
  overlay.click(); // dismiss
});

test("shallow reset through the UI zeroes the scoreboard", async () =>
{
  document.getElementById("settingsBtn").click();
  await settle(10);
  document.getElementById("resetSettingsBtn").click();
  await waitFor(
    () => !document.getElementById("resetModal").classList.contains("hidden"),
    { label: "reset modal" }
  );

  document.getElementById("resetCourtPassword").value = "newpw1";
  document.getElementById("shallowReset").click();

  await waitFor(
    () => getRenderedScore(document).setsA === 0 && getRenderedScore(document).pointsA === "0",
    { label: "scoreboard zeroed after reset" }
  );
});

test("CORE: scoring still works after a reset bumps the scoreVersion", async () =>
{
  document.getElementById("addPointA").click();
  await waitFor(() => getRenderedScore(document).pointsA === "15", { label: "A at 15 after reset" });

  document.getElementById("addPointB").click();
  await waitFor(() => getRenderedScore(document).pointsB === "15", { label: "B at 15 after reset" });
});

test("court closed by admin kicks the player back to the menu", async () =>
{
  const court = firestoreState.docs.get("courts/lifecourt");
  writeDoc("courts/lifecourt", { ...court, status: "closed" });

  await waitFor(
    () => document.getElementById("menuPage").style.display !== "none",
    { label: "menu page after closure" }
  );
  assert.equal(document.getElementById("scoreboardPage").style.display, "none");
});

test("spectator sees live score updates pushed by other devices", async () =>
{
  const spectateButton = [...document.querySelectorAll(".menu-btn")]
    .find((btn) => btn.textContent.trim() === "Spectate");
  assert.ok(spectateButton, "Spectate menu button exists");
  spectateButton.click();

  await waitFor(
    () => document.querySelector(`#spectateCourtList [data-court-name="watchcourt"]`),
    { label: "watchcourt in spectate list" }
  );
  document.querySelector(`#spectateCourtList [data-court-name="watchcourt"]`).click();

  await waitFor(
    () => document.getElementById("scoreboardPage").style.display !== "none",
    { label: "scoreboard shown for spectator" }
  );

  await waitFor(
    () => document.querySelector("#teamA .name-text").textContent === "Reds",
    { label: "spectated team names" }
  );

  pushScoreSnapshot("watchcourt", makeScore({
    A: { points: 3, games: 2, sets: 0, totalPoints: 11 },
    B: { points: 1, games: 3, sets: 1, totalPoints: 17 },
    lastPointTeam: "A"
  }));

  await waitFor(() => getRenderedScore(document).pointsA === "40", { label: "spectated score renders" });
  const rendered = getRenderedScore(document);
  assert.equal(rendered.pointsB, "15");
  assert.equal(rendered.gamesA, 2);
  assert.equal(rendered.gamesB, 3);
  assert.equal(rendered.setsB, 1);

  // Spectators must not be able to score: undo hidden, tap-to-score disabled.
  assert.equal(document.body.classList.contains("spectating-mode"), true);
  assert.equal(document.getElementById("undoBtn").style.display, "none");
  assert.equal(document.getElementById("addPointA").style.pointerEvents, "none");
  assert.equal(document.getElementById("addPointB").style.pointerEvents, "none");
});
