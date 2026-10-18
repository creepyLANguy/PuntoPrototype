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
  assert.equal($("joinCourtModalCourtName").textContent, "Join Modal Court");
  assert.equal($("playPage").style.display, "none");
  assert.equal($("joinCourtModalPassword").value, "");
  assert.equal(document.activeElement?.id, "joinCourtModalPassword");
});

test("the join modal surfaces required and incorrect password errors inline", async () => {
  submitJoinForm();
  await settle();

  assert.equal($("joinCourtModalPasswordError").textContent, "Password required.");
  assert.equal($("joinCourtModal").classList.contains("hidden"), false);

  $("joinCourtModalPassword").value = "incorrect";
  submitJoinForm();

  await waitFor(
    () => $("joinCourtModalPasswordError").textContent === "Incorrect password.",
    { label: "incorrect password error" },
  );
  assert.equal($("joinCourtModalError").textContent, "");
  assert.equal($("joinCourtModal").classList.contains("hidden"), false);
});

test("Escape dismisses the join modal without leaving the court", async () => {
  document.body.dispatchEvent(
    new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );

  await waitFor(
    () =>
      $("joinCourtModal").classList.contains("hidden") &&
      $("scoreboardPage").style.display !== "none",
    { label: "join modal dismissed to the scoreboard" },
  );
  assert.equal(window.location.pathname, "/c/jmada");

  $("settingsBtn").click();
  await waitFor(
    () => !$("settingsModal").classList.contains("hidden"),
    { label: "settings modal reopened" },
  );
  $("joinCourtBtn").click();
  assert.equal($("joinCourtModal").classList.contains("hidden"), false);
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
