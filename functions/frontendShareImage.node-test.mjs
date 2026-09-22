import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../app/js/script.js", import.meta.url), "utf8");
const liveStyles = readFileSync(new URL("../app/css/style.css", import.meta.url), "utf8");

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

test("share export uses the fixed 1080x1350 canvas", () => {
  assert.match(source, /const SHARE_IMAGE_EXPORT_WIDTH = 1080/);
  assert.match(source, /const SHARE_IMAGE_EXPORT_HEIGHT = 1350/);
  assert.match(source, /const SHARE_IMAGE_CSS_WIDTH = SHARE_IMAGE_EXPORT_WIDTH \/ 2/);
  assert.match(source, /const SHARE_IMAGE_CSS_HEIGHT = SHARE_IMAGE_EXPORT_HEIGHT \/ 2/);
  assert.match(source, /width: SHARE_IMAGE_CSS_WIDTH/);
  assert.match(source, /height: SHARE_IMAGE_CSS_HEIGHT/);
  assert.match(source, /canvasWidth: SHARE_IMAGE_EXPORT_WIDTH/);
  assert.match(source, /canvasHeight: SHARE_IMAGE_EXPORT_HEIGHT/);
  assert.match(source, /pixelRatio: 1/);
  assert.doesNotMatch(source, /pixelRatio: 2/);
  assert.doesNotMatch(source, /const sourceWidth =/);
});

test("share content uses a common 840px final-resolution column", () => {
  assert.match(source, /const SHARE_IMAGE_EXPORT_CONTENT_WIDTH = 840/);
  assert.match(source, /const SHARE_IMAGE_CSS_CONTENT_WIDTH = SHARE_IMAGE_EXPORT_CONTENT_WIDTH \/ 2/);
  assert.match(source, /node\.style\.width = `\$\{SHARE_IMAGE_CSS_CONTENT_WIDTH\}px`/);
  assert.match(source, /shareTableWrap\.style\.padding = '8px 12px'/);
  assert.match(source, /shareTable\.style\.width = '100%'/);
  assert.match(source, /shareTable\.style\.minWidth = '0'/);
  assert.match(source, /node\.style\.padding = '3px 8px 6px'/);
  assert.match(source, /node\.style\.padding = '7px 8px'/);
  assert.match(source, /node\.style\.minWidth = '42px'/);
  assert.doesNotMatch(source, /shareTable\.style\.width = 'max-content'/);
});

test("share-only sizing does not alter the live modal stylesheet", () => {
  assert.match(liveStyles, /\.dm-box\s*\{[\s\S]*?width:\s*100%;[\s\S]*?max-width:\s*480px;/);
  assert.match(liveStyles, /\.dm-table\s*\{[\s\S]*?width:\s*100%;/);
  assert.doesNotMatch(liveStyles, /SHARE_IMAGE_(?:EXPORT|CSS)_/);
  assert.doesNotMatch(liveStyles, /shareContentWidth/);
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

test("share output no longer uses square-image post-processing", () => {
  assert.doesNotMatch(source, /blobToImage/);
  assert.doesNotMatch(source, /padShareImageToSquare/);
  assert.doesNotMatch(source, /squareBlob/);
  assert.match(source, /const file = new File\(\s*\[blob\],\s*'share-image\.png'/s);
});
