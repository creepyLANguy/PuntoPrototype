import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

test("join-as-player icon sizing is constrained by the circular button", async () =>
{
  const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>");
  const previousDocument = globalThis.document;
  globalThis.document = dom.window.document;

  try
  {
    await import(`../app/js/scoreSync.mjs?join-player-icon-test=${Date.now()}`);

    const style = dom.window.document.getElementById("join-player-button-sizing");
    assert.ok(style, "join player sizing stylesheet should be installed");
    assert.match(style.textContent, /\.join-as-player-btn\s*\{[^}]*padding:\s*0\s*!important/s);
    assert.match(style.textContent, /\.join-as-player-btn\s+svg\s*\{[^}]*width:\s*68%\s*!important/s);
    assert.match(style.textContent, /\.join-as-player-btn\s+svg\s*\{[^}]*height:\s*68%\s*!important/s);
    assert.match(style.textContent, /\.join-as-player-btn\s+svg\s*\{[^}]*max-width:\s*100%/s);
    assert.match(style.textContent, /\.join-as-player-btn\s+svg\s*\{[^}]*max-height:\s*100%/s);
  }
  finally
  {
    globalThis.document = previousDocument;
    dom.window.close();
  }
});
