import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { setButtonIcon } from "../app/js/ui/icons.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePaths = [
  "app/templates/match.template.html",
  "app/templates/tournament.template.html",
  "app/templates/global/controls.html",
  "app/templates/global/details-modal.html",
  "app/templates/global/modals.html",
  "app/templates/global/player-names-modal.html",
  "app/templates/global/settings-modal.html",
  "app/templates/pages/menu.html",
  "app/templates/pages/play.html",
  "app/templates/pages/scoreboard.html",
  "app/templates/pages/spectate.html",
  "app/overlay/template.html",
];
const iconCss = readFileSync(path.join(root, "app/css/components/icons.css"), "utf8");

test("in-scope button icons are external SVG masks and accessible", () => {
  const iconButtons = [];

  for (const sourcePath of sourcePaths) {
    const html = readFileSync(path.join(root, sourcePath), "utf8");
    const document = new JSDOM(html).window.document;

    for (const button of document.querySelectorAll("button, [role='button']")) {
      assert.equal(button.querySelector("svg"), null, `${sourcePath} has inline button SVG`);
      for (const icon of button.querySelectorAll(".icon")) {
        assert.equal(icon.getAttribute("aria-hidden"), "true", `${sourcePath} icon is decorative`);
        iconButtons.push(button);
      }
    }
  }

  for (const button of new Set(iconButtons)) {
    const text = button.cloneNode(true);
    text.querySelectorAll(".icon").forEach((icon) => icon.remove());
    if (!text.textContent.trim()) {
      assert.ok(
        button.getAttribute("aria-label") || button.title,
        `icon-only button ${button.id || button.className} has an accessible label`,
      );
    }
  }

  const icons = readdirSync(path.join(root, "app/media/icons")).filter((file) =>
    file.endsWith(".svg"),
  );
  assert.ok(icons.length > 0, "the app has external SVG assets");
  for (const file of icons) {
    const svg = readFileSync(path.join(root, "app/media/icons", file), "utf8");
    assert.match(svg, /viewBox="0 0 24 24"/, `${file} uses the shared viewBox`);
    assert.match(svg, /stroke-width="2"/, `${file} uses the shared stroke width`);
    assert.match(svg, /stroke-linecap="round"/, `${file} uses round caps`);
    assert.match(svg, /stroke-linejoin="round"/, `${file} uses round joins`);
    assert.match(svg, /stroke="currentColor"/, `${file} inherits theme color`);
    assert.match(
      iconCss,
      new RegExp(`url\\("/app/media/icons/${file}"\\)`),
      `${file} is mapped in CSS`,
    );
  }
});

test("runtime icon changes replace icon markup without text glyphs", () => {
  const dom = new JSDOM(
    "<button aria-label='Swap views'><span class='icon icon--swap'></span></button>",
  );
  const previousDocument = globalThis.document;
  globalThis.document = dom.window.document;

  try {
    const button = dom.window.document.querySelector("button");
    setButtonIcon(button, "swap-alt");
    assert.equal(button.textContent, "");
    assert.equal(button.childElementCount, 1);
    assert.equal(button.firstElementChild.className, "icon icon--swap-alt");
    assert.equal(button.firstElementChild.getAttribute("aria-hidden"), "true");
    assert.equal(button.getAttribute("aria-label"), "Swap views");
  } finally {
    globalThis.document = previousDocument;
    dom.window.close();
  }
});

test("visual report previews every changed icon on light and dark backgrounds", () => {
  const reportPath = path.join(root, "docs/iconography-report/index.html");
  const dom = new JSDOM(readFileSync(reportPath, "utf8"), {
    runScripts: "dangerously",
  });
  const rows = dom.window.document.querySelectorAll("#iconRows tr");

  assert.equal(rows.length, 38, "the report covers every changed icon occurrence");
  for (const row of rows) {
    for (const column of [row.cells[2], row.cells[3]]) {
      assert.ok(column.querySelector(".theme-tile.light"), "light preview is present");
      assert.ok(column.querySelector(".theme-tile.dark"), "dark preview is present");
    }
    for (const image of row.querySelectorAll("img.before-svg")) {
      assert.ok(
        existsSync(path.resolve(path.dirname(reportPath), image.getAttribute("src"))),
        `original SVG preview ${image.getAttribute("src")} exists`,
      );
    }
    for (const code of row.cells[3].querySelectorAll("code")) {
      const value = code.textContent;
      if (value.startsWith("app/media/icons/")) {
        assert.ok(existsSync(path.join(root, value)), `${value} exists`);
      }
    }
  }

  dom.window.close();
});
