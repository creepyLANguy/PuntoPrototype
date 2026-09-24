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
  assert.match(source, /node\.style\.maxWidth = '100%'/);
  assert.match(source, /node\.style\.width = '100%'/);
  assert.match(source, /node\.style\.lineHeight = '1\.15'/);
  assert.doesNotMatch(source, /node\.style\.whiteSpace = 'nowrap'/);
  assert.doesNotMatch(source, /node\.style\.textOverflow = 'ellipsis'/);
});

test("capture uses the match-details modal surface", () => {
  assert.match(source, /const cardBackground = getComputedStyle\(element\)\.backgroundColor/);
  assert.match(source, /clone\.style\.background = cardBackground/);
  assert.match(source, /backgroundColor: cardBackground/);
});

test("share export uses 1080x1350 as both CSS and PNG dimensions", () => {
  assert.match(source, /const SHARE_IMAGE_WIDTH = 1080/);
  assert.match(source, /const SHARE_IMAGE_HEIGHT = 1350/);
  assert.ok(source.includes("clone.style.width = `${SHARE_IMAGE_WIDTH}px`;"));
  assert.ok(source.includes("clone.style.height = `${SHARE_IMAGE_HEIGHT}px`;"));
  assert.match(source, /width: SHARE_IMAGE_WIDTH/);
  assert.match(source, /height: SHARE_IMAGE_HEIGHT/);
  assert.match(source, /canvasWidth: SHARE_IMAGE_WIDTH/);
  assert.match(source, /canvasHeight: SHARE_IMAGE_HEIGHT/);
  assert.match(source, /pixelRatio: 2/);
  assert.match(source, /const highResolutionBlob = await toBlob\(clone/);
  assert.match(source, /const highResolutionImage = new Image\(\)/);
  assert.match(source, /outputCanvas\.width = SHARE_IMAGE_WIDTH/);
  assert.match(source, /outputCanvas\.height = SHARE_IMAGE_HEIGHT/);
  assert.match(source, /outputContext\.imageSmoothingEnabled = true/);
  assert.match(source, /outputContext\.imageSmoothingQuality = 'high'/);
  assert.match(source, /highResolutionImage\.naturalWidth/);
  assert.match(source, /highResolutionImage\.naturalHeight/);
  assert.match(source, /'image\/png'/);
  assert.match(source, /URL\.revokeObjectURL\(highResolutionUrl\)/);
  assert.doesNotMatch(source, /pixelRatio: 1/);
  assert.doesNotMatch(source, /SHARE_IMAGE_CSS_WIDTH/);
  assert.doesNotMatch(source, /SHARE_IMAGE_CSS_HEIGHT/);
  assert.doesNotMatch(source, /const sourceWidth =/);
});

test("share content uses a common 840px CSS-pixel column", () => {
  assert.match(source, /const SHARE_IMAGE_CONTENT_WIDTH = 840/);
  assert.match(source, /const SHARE_IMAGE_SCORE_PANEL_WIDTH = 720/);
  assert.match(source, /const SHARE_IMAGE_QR_PANEL_WIDTH = 720/);
  assert.match(source, /const SHARE_IMAGE_QR_LEFT_OFFSET = 104/);
  assert.match(source, /footerPanel\.style\.width = `\$\{SHARE_IMAGE_QR_PANEL_WIDTH\}px`/);
  assert.match(source, /footerPanel\.style\.justifyContent = 'flex-start'/);
  assert.match(source, /footerPanel\.style\.paddingLeft = `\$\{SHARE_IMAGE_QR_LEFT_OFFSET\}px`/);
  assert.match(source, /shareTableWrap\.style\.width = `\$\{SHARE_IMAGE_SCORE_PANEL_WIDTH\}px`/);
  assert.match(source, /footerPanel\.style\.width = `\$\{SHARE_IMAGE_QR_PANEL_WIDTH\}px`/);
  assert.match(source, /SHARE_IMAGE_CONTENT_WIDTH/);
  assert.match(source, /shareTableWrap\.style\.padding = '16px 24px'/);
  assert.match(source, /shareTable\.style\.width = '100%'/);
  assert.match(source, /shareTable\.style\.minWidth = '0'/);
  assert.match(source, /node\.style\.padding = '6px 16px 12px'/);
  assert.match(source, /node\.style\.padding = '14px 16px'/);
  assert.match(source, /node\.style\.minWidth = '84px'/);
  assert.doesNotMatch(source, /shareTable\.style\.width = 'max-content'/);
});

test("share-only visual scaling stays inside the image-capture path", () => {
  assert.match(source, /const SHARE_IMAGE_SCALE = 2/);
  assert.match(source, /clone\.style\.padding = `40px 56px 16px`/);
  assert.match(source, /shareNames\.forEach/);
  assert.match(source, /shareLogo\.style\.width = `144px`/);
  assert.match(source, /shareLogo\.style\.height = `144px`/);
  assert.match(source, /shareTitle\.style\.fontSize = `4rem`/);
  assert.match(source, /shareSets\.forEach/);
  assert.match(source, /node\.style\.fontSize = `6\.5rem`/);
  assert.match(source, /watermarkImage\.style\.width = '88%'/);
  assert.match(source, /watermarkImage\.style\.maxWidth = 'none'/);
  assert.match(source, /node\.style\.fontSize = `2\.8rem`/);
  assert.match(source, /shareTableWrap\.style\.borderRadius = '32px'/);
  assert.match(source, /node\.style\.fontSize = '1\.9rem'/);
  assert.match(source, /node\.style\.fontSize = '3\.5rem'/);
  assert.match(source, /node\.style\.minHeight = '72px'/);
  assert.match(source, /footerPanel\.style\.width/);
  assert.match(source, /qrSize = Math\.max\(168, Math\.min\(240, footerHeight - 48\)\)/);
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

test("QR is generated off-DOM and composited directly onto the final canvas", () => {
  assert.match(source, /qrGenerator = new window\.QRCode\(document\.createElement\('div'\)/);
  assert.match(source, /qrMount\.style\.width = qrSize \+ 'px'/);
  assert.match(source, /qrMount\.style\.height = qrSize \+ 'px'/);
  assert.match(source, /function drawPixelAlignedQr\(outputContext, qrGenerator, x, y, size\)/);
  assert.match(source, /const qrModel = qrGenerator\?\._oQRCode/);
  assert.match(source, /outputContext\.imageSmoothingEnabled = false/);
  assert.match(source, /const modulePixels = Math\.ceil\(size \/ moduleCount\)/);
  assert.match(source, /const actualSize = moduleCount \* modulePixels/);
  assert.match(source, /const qrModulePixels = Math\.ceil\(qrSize \/ qrModuleCount\)/);
  assert.match(source, /const qrRenderSize = qrModuleCount \* qrModulePixels/);
  assert.match(source, /qrMount\.style\.width = qrRenderSize \+ 'px'/);
  assert.match(source, /qrMount\.style\.height = qrRenderSize \+ 'px'/);
  assert.match(source, /drawX \+ column \* modulePixels/);
  assert.match(source, /drawY \+ row \* modulePixels/);
  assert.match(source, /outputContext\.fillRect\(\s*drawX \+ column \* modulePixels,/s);
  assert.doesNotMatch(source, /const qrDataUrl = qrCanvas\.toDataURL\('image\/png'\)/);
  assert.doesNotMatch(source, /qrMount\.appendChild\(qrImage\)/);
  assert.doesNotMatch(source, /qrLogoBadge/);
  assert.doesNotMatch(source, /qrLogo\.src = shareLogoDataUrl/);
  assert.doesNotMatch(source, /const shareLogoDataUrl = /);
});

test("QR compositing happens after the smoothed card downsample and before PNG encoding", () => {
  const exportStartIndex = source.indexOf("async function cacheShareableScoreCard()");
  const downsampleIndex = source.indexOf(
    "outputContext.drawImage(\n        highResolutionImage,",
    exportStartIndex
  );
  const qrCompositeIndex = source.indexOf(
    "drawPixelAlignedQr(outputContext, qrGenerator, qrX, qrY, qrFinalSize);",
    exportStartIndex
  );
  const pngEncodeIndex = source.indexOf("outputCanvas.toBlob(", exportStartIndex);

  assert.ok(exportStartIndex >= 0);
  assert.ok(downsampleIndex >= 0);
  assert.ok(qrCompositeIndex > downsampleIndex);
  assert.ok(pngEncodeIndex > qrCompositeIndex);
});

test("share output no longer uses square-image post-processing", () => {
  assert.doesNotMatch(source, /blobToImage/);
  assert.doesNotMatch(source, /padShareImageToSquare/);
  assert.doesNotMatch(source, /squareBlob/);
  assert.match(source, /const file = new File\(\s*\[blob\],\s*'share-image\.png'/s);
});
