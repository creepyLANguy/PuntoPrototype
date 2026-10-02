// Court QR panel (#courtQrPanel): the spectator link it encodes, rendering the QR
// and logo canvases, and keeping the panel inside the scoreboard.
import { qrState } from "./qrState.js";
import { elements } from "../ui/dom.js";

let courtQrLogoImage = null;

export function initCourtQrLogoImage()
{
  courtQrLogoImage = typeof window.Image === "function"
    ? new window.Image()
    : null;
  if (courtQrLogoImage)
  {
    courtQrLogoImage.decoding = "async";
    courtQrLogoImage.src = "/media/logo.svg";
  }
}

// The spectator link encoded in the court QR code and in share text. Existing
// printed codes depend on this exact format: {origin}/c/{courtId}.
export function buildCourtQrUrl(courtId, origin = window.location.origin)
{
  const baseUrl = origin.replace(/\/$/, "");

  if (!courtId)
  {
    return baseUrl;
  }

  return `${baseUrl}/c/${encodeURIComponent(courtId)}`;
}

function updateCourtQrPanelScale()
{
  if (!elements.courtQrPanel)
  {
    return;
  }

  Math.floor(elements.courtQrPanel.clientWidth);
}

export function clampCourtQrPanelToViewport()
{
  if (!elements.courtQrPanel || !elements.scoreboardPage)
  {
    return;
  }

  const panel = elements.courtQrPanel;
  if (panel.classList.contains("hidden"))
  {
    return;
  }

  const parentRect = elements.scoreboardPage.getBoundingClientRect();
  const safeGap = 8;
  const minSize = 130;
  const panelAspectRatio = 1.24;

  const maxWidth = Math.max(minSize, parentRect.width - safeGap * 2);
  const maxHeight = Math.max(minSize, parentRect.height - safeGap * 2);

  const maxWidthByHeight = maxHeight / panelAspectRatio;
  const maxAllowedWidth = Math.max(24, Math.min(maxWidth, maxWidthByHeight));
  const minAllowedWidth = Math.min(minSize, maxAllowedWidth);

  const panelRectNow = panel.getBoundingClientRect();
  const nextWidth = Math.min(
    maxAllowedWidth,
    Math.max(minAllowedWidth, panelRectNow.width)
  );

  if (Math.abs(panelRectNow.width - nextWidth) > 0.25)
  {
    panel.style.width = `${nextWidth}px`;
  }

  const panelRect = panel.getBoundingClientRect();
  const maxLeft = Math.max(safeGap, parentRect.width - panelRect.width - safeGap);
  const maxTop = Math.max(safeGap, parentRect.height - panelRect.height - safeGap);

  const currentLeft = Number.parseFloat(panel.style.left);
  const currentTop = Number.parseFloat(panel.style.top);

  // Before the user has dragged or resized the panel, keep the CSS bottom/right
  // anchor intact. This avoids a transient zero-sized scoreboard turning the
  // initial fallback into the top-left corner.
  if (!Number.isFinite(currentLeft) && !Number.isFinite(currentTop))
  {
    panel.style.left = "auto";
    panel.style.top = "auto";
    panel.style.right = `${safeGap}px`;
    panel.style.bottom = `${safeGap}px`;
    updateCourtQrPanelScale();
    return;
  }

  const nextLeft = Math.min(
    maxLeft,
    Math.max(safeGap, Number.isFinite(currentLeft) ? currentLeft : safeGap)
  );
  const nextTop = Math.min(
    maxTop,
    Math.max(safeGap, Number.isFinite(currentTop) ? currentTop : safeGap)
  );

  if (!Number.isFinite(currentLeft) || Math.abs(currentLeft - nextLeft) > 0.25)
  {
    panel.style.left = `${nextLeft}px`;
  }

  if (!Number.isFinite(currentTop) || Math.abs(currentTop - nextTop) > 0.25)
  {
    panel.style.top = `${nextTop}px`;
  }

  panel.style.right = "auto";
  panel.style.bottom = "auto";

  updateCourtQrPanelScale();
}

function resetCourtQrPanelPosition()
{
  if (!elements.courtQrPanel)
  {
    return;
  }

  elements.courtQrPanel.style.left = "auto";
  elements.courtQrPanel.style.top = "auto";
  elements.courtQrPanel.style.bottom = "8px";
  elements.courtQrPanel.style.right = "8px";
  elements.courtQrPanel.style.width = "";
  elements.courtQrPanel.style.height = "";
  elements.courtQrPanel.style.transform = "";
  updateCourtQrPanelScale();
}

function getCourtQrSize()
{
  if (!elements.courtQrPanel)
  {
    return 256;
  }

  const panelWidth = Math.floor(elements.courtQrPanel.clientWidth);
  if (!panelWidth || panelWidth <= 0)
  {
    return 256;
  }

  return Math.max(256, panelWidth - 24);
}

function getCourtQrContentSize()
{
  if (!elements.courtQrCode)
  {
    return 256;
  }

  const rect = elements.courtQrCode.getBoundingClientRect();
  const computedStyle = window.getComputedStyle(elements.courtQrCode);
  const paddingLeft = Number.parseFloat(computedStyle.paddingLeft) || 0;
  const paddingRight = Number.parseFloat(computedStyle.paddingRight) || 0;
  const contentWidth = rect.width - paddingLeft - paddingRight;

  return Math.max(72, Math.floor(contentWidth));
}

function drawCourtQrLogo(context, size)
{
  const logoSize = size * 0.4;
  const logoX = (size - logoSize) / 2;
  const logoY = logoX;

  context.clearRect(0, 0, size, size);
  context.fillStyle = "#000000";
  context.beginPath();
  context.arc(size / 2, size / 2, logoSize / 2, 0, Math.PI * 2);
  context.fill();

  const logoImage = courtQrLogoImage;
  if (logoImage?.complete && logoImage.naturalWidth > 0)
  {
    const imageInset = logoSize * 0.07;
    context.imageSmoothingEnabled = true;
    context.drawImage(
      logoImage,
      logoX + imageInset,
      logoY + imageInset,
      logoSize * 0.86,
      logoSize * 0.86
    );
    context.imageSmoothingEnabled = false;
  }
}

function getCourtQrBackingSize()
{
  const cssSize = getCourtQrContentSize();
  const devicePixelRatio = Math.max(1, window.devicePixelRatio || 1);
  return Math.max(512, Math.round(cssSize * devicePixelRatio));
}

function createCourtQrLogoCanvas(size)
{
  const canvas = document.createElement("canvas");
  let context = null;

  try
  {
    context = canvas.getContext("2d", {
      alpha: true,
      desynchronized: true
    });
  }
  catch
  {
    return null;
  }

  if (!context)
  {
    return null;
  }

  canvas.className = "court-qr-logo-canvas";
  canvas.width = size;
  canvas.height = size;
  canvas.setAttribute("aria-hidden", "true");

  drawCourtQrLogo(context, size);

  if (courtQrLogoImage && !(courtQrLogoImage.complete && courtQrLogoImage.naturalWidth > 0))
  {
    courtQrLogoImage.addEventListener("load", () =>
    {
      if (canvas.isConnected)
      {
        drawCourtQrLogo(context, size);
      }
    }, { once: true });
  }

  return canvas;
}

export function rerasterizeCourtQrLogoAtCurrentSize()
{
  const canvas = elements.courtQrCode?.querySelector(".court-qr-logo-canvas");

  if (!canvas || !courtQrLogoImage?.complete || courtQrLogoImage.naturalWidth <= 0)
  {
    return;
  }

  const backingSize = getCourtQrBackingSize();

  if (canvas.width === backingSize && canvas.height === backingSize)
  {
    return;
  }

  canvas.width = backingSize;
  canvas.height = backingSize;

  const context = canvas.getContext("2d");
  if (!context)
  {
    return;
  }

  drawCourtQrLogo(context, backingSize);
}

function createCourtQrCanvas(qrUrl)
{
  if (!window.QRCode || !qrUrl)
  {
    return null;
  }

  const probe = document.createElement("div");
  const qr = new window.QRCode(probe, {
    text: qrUrl,
    width: 1,
    height: 1,
    colorDark: "#000000",
    colorLight: "#ffffff",
    correctLevel: window.QRCode.CorrectLevel.H
  });

  const matrix = qr?._oQRCode;
  const moduleCount = matrix?.getModuleCount?.();
  if (!matrix || !Number.isInteger(moduleCount) || moduleCount <= 0)
  {
    return null;
  }

  const backingSize = getCourtQrBackingSize();
  const canvas = document.createElement("canvas");
  let context = null;

  try
  {
    context = canvas.getContext("2d", {
      alpha: false,
      desynchronized: true
    });
  }
  catch
  {
    return null;
  }

  if (!context)
  {
    return null;
  }

  canvas.className = "court-qr-canvas";
  canvas.width = backingSize;
  canvas.height = backingSize;
  canvas.setAttribute("aria-hidden", "true");

  context.imageSmoothingEnabled = false;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, backingSize, backingSize);

  const moduleScale = backingSize / moduleCount;
  context.fillStyle = "#000000";

  for (let row = 0; row < moduleCount; row += 1)
  {
    for (let column = 0; column < moduleCount; column += 1)
    {
      if (!matrix.isDark(row, column))
      {
        continue;
      }

      const x0 = Math.round(column * moduleScale);
      const y0 = Math.round(row * moduleScale);
      const x1 = Math.round((column + 1) * moduleScale);
      const y1 = Math.round((row + 1) * moduleScale);
      context.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
  }

  return canvas;
}

export function clearCourtQr()
{
  if (!elements.courtQrPanel || !elements.courtQrCode || !elements.courtQrLabel)
  {
    return;
  }

  qrState.courtQrPanelVisible = false;
  elements.courtQrCode.classList.remove("has-canvas-qr");
  elements.courtQrCode.innerHTML = "";
  elements.courtQrLabel.textContent = "";
  elements.courtQrPanel.classList.add("hidden");
  resetCourtQrPanelPosition();
  qrState.refreshCourtQrResizeHandleVisibility?.();
}

export function renderCourtQr(courtId)
{
  if (!elements.courtQrPanel || !elements.courtQrCode || !elements.courtQrLabel)
  {
    return;
  }

  if (!window.QRCode || !courtId)
  {
    clearCourtQr();
    return;
  }

  const qrUrl = buildCourtQrUrl(courtId);
  qrState.courtQrPanelVisible = true;
  elements.courtQrPanel.classList.remove("hidden");
  clampCourtQrPanelToViewport();

  elements.courtQrCode.classList.remove("has-canvas-qr");
  elements.courtQrCode.innerHTML = "";

  const qrCanvas = createCourtQrCanvas(qrUrl);
  const qrLogoCanvas = qrCanvas
    ? createCourtQrLogoCanvas(qrCanvas.width)
    : null;

  if (qrCanvas)
  {
    elements.courtQrCode.classList.add("has-canvas-qr");
    elements.courtQrCode.replaceChildren(
      qrCanvas,
      ...(qrLogoCanvas ? [qrLogoCanvas] : [])
    );
  }
  else
  {
    new window.QRCode(elements.courtQrCode, {
      text: qrUrl,
      width: Math.max(512, getCourtQrSize()),
      height: Math.max(512, getCourtQrSize()),
      colorDark: "#000000",
      colorLight: "#ffffff",
      correctLevel: window.QRCode.CorrectLevel.H
    });
  }

  elements.courtQrLabel.textContent = courtId;
  qrState.refreshCourtQrResizeHandleVisibility?.(true);
}
