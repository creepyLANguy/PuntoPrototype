import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../app/js/script.js", import.meta.url), "utf8");

test("interactive details UI is excluded before capture and by the serializer", () => {
  assert.match(source, /querySelectorAll\('\.dm-close, \.dm-share-btn, \.dm-details-panel, \.dm-empty-state, \.dm-error-state'\)/);
  assert.match(source, /'dm-details-panel'/);
});

test("long team names wrap rather than ellipsize", () => {
  assert.match(source, /node\.style\.whiteSpace = 'normal'/);
  assert.match(source, /node\.style\.overflow = 'visible'/);
  assert.match(source, /node\.style\.textOverflow = 'clip'/);
  assert.match(source, /node\.style\.overflowWrap = 'anywhere'/);
  assert.match(source, /node\.style\.wordBreak = 'break-word'/);
});

test("capture uses the match-details modal surface", () => {
  assert.match(source, /const cardBackground = getComputedStyle\(element\)\.backgroundColor/);
  assert.match(source, /clone\.style\.background = cardBackground/);
  assert.match(source, /backgroundColor: cardBackground/);
});

test("per-set table spacing is compacted only on the cloned share card", () => {
  assert.match(source, /const shareTableWrap = clone\.querySelector\('\.dm-table-wrap'\)/);
  assert.match(source, /shareTableWrap\.style\.padding = '6px 10px'/);
  assert.match(source, /shareTable\.style\.width = 'max-content'/);
  assert.match(source, /shareTable\.style\.minWidth = '0'/);
  assert.match(source, /shareTable\.style\.margin = '0 auto'/);
  assert.match(source, /node\.style\.padding = '2px 6px 4px'/);
  assert.match(source, /node\.style\.padding = '5px 6px'/);
  assert.match(source, /node\.style\.minWidth = '38px'/);
  assert.doesNotMatch(source, /\.dm-table-wrap\s*\{[^}]*padding:\s*6px 10px/s);
});

test("light-theme watermark is explicitly embedded", () => {
  assert.match(source, /const watermarkColor = isLightTheme \? '#111111' : '#ffffff'/);
  assert.match(source, /watermarkImage\.src = watermarkLogoDataUrl/);
  assert.match(source, /watermarkImage\.style\.filter = 'none'/);
});

test("QR contains only the QR image without an overlaid Padel Push logo", () => {
  assert.match(source, /new window\.QRCode\(qrMount/);
  assert.match(source, /const qrDataUrl = qrCanvas\.toDataURL\('image\/png'\)/);
  assert.doesNotMatch(source, /qrLogoBadge/);
  assert.doesNotMatch(source, /qrLogo\.src = shareLogoDataUrl/);
  assert.doesNotMatch(source, /const shareLogoDataUrl = /);
});

test("share output retains the natural captured aspect ratio", () => {
  assert.doesNotMatch(source, /blobToImage/);
  assert.doesNotMatch(source, /padShareImageToSquare/);
  assert.doesNotMatch(source, /squareBlob/);
  assert.match(source, /const file = new File\(\s*\[blob\],\s*'share-image\.png'/s);
});
