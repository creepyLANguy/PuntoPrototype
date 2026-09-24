const SVG_NS = "http://www.w3.org/2000/svg";

function snap(value)
{
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric) : 0;
}

function escapeXml(value)
{
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function isTransparentColor(value)
{
  const normalized = String(value || "").trim().toLowerCase();
  return !normalized ||
    normalized === "transparent" ||
    normalized === "rgba(0, 0, 0, 0)" ||
    normalized === "rgba(0,0,0,0)";
}

function cssNumber(value, fallback = 0)
{
  const numeric = parseFloat(String(value ?? ""));
  return Number.isFinite(numeric) ? numeric : fallback;
}

function transformedText(text, textTransform)
{
  switch (textTransform)
  {
    case "uppercase":
      return text.toUpperCase();
    case "lowercase":
      return text.toLowerCase();
    case "capitalize":
      return text.replace(/\b([a-z])/g, match => match.toUpperCase());
    default:
      return text;
  }
}

function collectFontFaceRules()
{
  const rules = [];

  for (const stylesheet of Array.from(document.styleSheets || []))
  {
    let cssRules;

    try
    {
      cssRules = stylesheet.cssRules;
    }
    catch (error)
    {
      continue;
    }

    if (!cssRules)
    {
      continue;
    }

    for (const rule of Array.from(cssRules))
    {
      if (rule.type === CSSRule.FONT_FACE_RULE)
      {
        rules.push(rule.cssText);
      }
    }
  }

  return rules.join("\n");
}

function shouldSkipElement(element, filter)
{
  if (element.nodeType !== Node.ELEMENT_NODE)
  {
    return true;
  }

  if (filter && !filter(element))
  {
    return true;
  }

  const style = getComputedStyle(element);

  if (style.display === "none" || style.visibility === "hidden")
  {
    return true;
  }

  return false;
}

function getRelativeRect(element, rootRect)
{
  const rect = element.getBoundingClientRect();

  return {
    x: snap(rect.left - rootRect.left),
    y: snap(rect.top - rootRect.top),
    width: snap(rect.width),
    height: snap(rect.height)
  };
}

function rectHasArea(rect)
{
  return rect.width > 0 && rect.height > 0;
}

function buildTextLineRects(element, rootRect, textNode)
{
  const text = textNode.textContent || "";

  if (!text.trim())
  {
    return [];
  }

  const computed = getComputedStyle(element);
  const allowWrapping =
    computed.whiteSpace !== "nowrap" ||
    computed.overflowWrap === "anywhere" ||
    computed.wordBreak === "break-word";

  if (!allowWrapping)
  {
    const rect = getRelativeRect(element, rootRect);
    return [{
      text: transformedText(text.replace(/\s+/g, " ").trim(), computed.textTransform),
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height
    }];
  }

  const lineMap = new Map();

  for (let index = 0; index < text.length; index++)
  {
    const range = document.createRange();
    range.setStart(textNode, index);
    range.setEnd(textNode, index + 1);

    const clientRects = Array.from(range.getClientRects());
    if (clientRects.length === 0)
    {
      continue;
    }

    const rect = clientRects[0];
    if (rect.width === 0 && text[index].trim() === "")
    {
      continue;
    }

    const top = snap(rect.top - rootRect.top);
    const key = String(top);

    if (!lineMap.has(key))
    {
      lineMap.set(key, {
        top,
        right: snap(rect.right - rootRect.left),
        left: snap(rect.left - rootRect.left),
        height: snap(rect.height),
        chars: []
      });
    }

    const line = lineMap.get(key);
    line.left = Math.min(line.left, snap(rect.left - rootRect.left));
    line.right = Math.max(line.right, snap(rect.right - rootRect.left));
    line.height = Math.max(line.height, snap(rect.height));
    line.chars.push(text[index]);
  }

  const elementRect = getRelativeRect(element, rootRect);
  const sortedLines = Array.from(lineMap.values()).sort((a, b) => a.top - b.top);

  if (sortedLines.length <= 1)
  {
    return [{
      text: transformedText(text.replace(/\s+/g, " ").trim(), computed.textTransform),
      x: elementRect.x,
      y: elementRect.y,
      width: elementRect.width,
      height: elementRect.height
    }];
  }

  return sortedLines
    .map(line => ({
      text: transformedText(line.chars.join("").replace(/\s+/g, " ").trim(), computed.textTransform),
      x: line.left,
      y: line.top,
      width: Math.max(1, line.right - line.left),
      height: Math.max(1, line.height)
    }))
    .filter(line => line.text.length > 0);
}

function textAnchorFor(computed)
{
  switch (computed.textAlign)
  {
    case "center":
      return "middle";
    case "right":
    case "end":
      return "end";
    default:
      return "start";
  }
}

function textXFor(elementRect, computed)
{
  const paddingLeft = snap(cssNumber(computed.paddingLeft));
  const paddingRight = snap(cssNumber(computed.paddingRight));

  switch (computed.textAlign)
  {
    case "center":
      return snap(elementRect.x + (elementRect.width / 2));
    case "right":
    case "end":
      return snap(elementRect.x + elementRect.width - paddingRight);
    default:
      return snap(elementRect.x + paddingLeft);
  }
}

function serializeTextElement(element, rootRect)
{
  const textNodes = Array.from(element.childNodes)
    .filter(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());

  if (textNodes.length === 0)
  {
    return "";
  }

  const computed = getComputedStyle(element);
  const elementRect = getRelativeRect(element, rootRect);
  const fontSize = Math.max(1, snap(cssNumber(computed.fontSize, 16)));
  const fontWeight = computed.fontWeight || "400";
  const fontStyle = computed.fontStyle || "normal";
  const fontFamily = computed.fontFamily || "Inter, system-ui, sans-serif";
  const letterSpacingValue = computed.letterSpacing === "normal"
    ? 0
    : snap(cssNumber(computed.letterSpacing));
  const fill = computed.color || "#000000";
  const opacity = Math.max(0, Math.min(1, cssNumber(computed.opacity, 1)));
  const anchor = textAnchorFor(computed);
  const lineNodes = [];

  for (const textNode of textNodes)
  {
    lineNodes.push(...buildTextLineRects(element, rootRect, textNode));
  }

  return lineNodes.map(line =>
  {
    const x = textXFor(
      elementRect,
      computed
    );

    const y = snap(line.y + (line.height / 2));

    return [
      "<text",
      ` x="${x}"`,
      ` y="${y}"`,
      ` fill="${escapeXml(fill)}"`,
      ` fill-opacity="${opacity}"`,
      ` font-family="${escapeXml(fontFamily)}"`,
      ` font-size="${fontSize}px"`,
      ` font-weight="${escapeXml(fontWeight)}"`,
      ` font-style="${escapeXml(fontStyle)}"`,
      ` text-anchor="${anchor}"`,
      ` dominant-baseline="middle"`,
      ` letter-spacing="${letterSpacingValue}px"`,
      ` text-rendering="geometricPrecision"`,
      ` style="font-kerning:normal"`,
      ">",
      escapeXml(line.text),
      "</text>"
    ].join("");
  }).join("");
}

function serializeImageElement(element, rootRect)
{
  const src = element.getAttribute("src") || "";
  if (!src)
  {
    return "";
  }

  const rect = getRelativeRect(element, rootRect);
  if (!rectHasArea(rect))
  {
    return "";
  }

  const computed = getComputedStyle(element);
  const opacity = Math.max(0, Math.min(1, cssNumber(computed.opacity, 1)));

  return [
    "<image",
    ` x="${rect.x}"`,
    ` y="${rect.y}"`,
    ` width="${rect.width}"`,
    ` height="${rect.height}"`,
    ` href="${escapeXml(src)}"`,
    ` opacity="${opacity}"`,
    ' preserveAspectRatio="xMidYMid meet"',
    " />"
  ].join("");
}

function serializeBackgroundAndBorder(element, rootRect)
{
  const rect = getRelativeRect(element, rootRect);
  if (!rectHasArea(rect))
  {
    return "";
  }

  const computed = getComputedStyle(element);
  const backgroundColor = computed.backgroundColor;
  const borderColor = computed.borderTopColor || "#000000";
  const borderWidth = snap(cssNumber(computed.borderTopWidth));
  const borderRadius = Math.max(0, snap(cssNumber(computed.borderTopLeftRadius)));

  if (isTransparentColor(backgroundColor) && borderWidth <= 0)
  {
    return "";
  }

  const attributes = [
    ` x="${rect.x}"`,
    ` y="${rect.y}"`,
    ` width="${rect.width}"`,
    ` height="${rect.height}"`,
    ` rx="${borderRadius}"`
  ];

  if (!isTransparentColor(backgroundColor))
  {
    attributes.push(` fill="${escapeXml(backgroundColor)}"`);
  }
  else
  {
    attributes.push(' fill="none"');
  }

  if (borderWidth > 0 && !isTransparentColor(borderColor))
  {
    attributes.push(` stroke="${escapeXml(borderColor)}"`);
    attributes.push(` stroke-width="${borderWidth}"`);
  }
  else
  {
    attributes.push(' stroke="none"');
  }

  return `<rect${attributes.join("")} shape-rendering="geometricPrecision" />`;
}

function serializeElement(element, rootRect, filter)
{
  if (shouldSkipElement(element, filter))
  {
    return "";
  }

  const pieces = [];
  const computed = getComputedStyle(element);
  const opacity = Math.max(0, Math.min(1, cssNumber(computed.opacity, 1)));

  if (element.tagName === "IMG")
  {
    const image = serializeImageElement(element, rootRect);
    return opacity < 1 ? `<g opacity="${opacity}">${image}</g>` : image;
  }

  const background = serializeBackgroundAndBorder(element, rootRect);
  if (background)
  {
    pieces.push(background);
  }

  if (element.children.length === 0)
  {
    pieces.push(serializeTextElement(element, rootRect));
  }

  for (const child of Array.from(element.children))
  {
    pieces.push(serializeElement(child, rootRect, filter));
  }

  const inner = pieces.join("");

  if (!inner)
  {
    return "";
  }

  if (opacity < 1)
  {
    return `<g opacity="${opacity}">${inner}</g>`;
  }

  return inner;
}

function serializeQr(qrGenerator, qrElement, rootRect)
{
  if (!qrGenerator || !qrElement)
  {
    return "";
  }

  const qrModel = qrGenerator?._oQRCode;
  if (!qrModel || typeof qrModel.getModuleCount !== "function" || typeof qrModel.isDark !== "function")
  {
    throw new Error("QR generator did not expose its generated module matrix");
  }

  const moduleCount = qrModel.getModuleCount();
  const qrRect = getRelativeRect(qrElement, rootRect);

  if (!Number.isInteger(moduleCount) || moduleCount <= 0 || !rectHasArea(qrRect))
  {
    return "";
  }

  const size = Math.min(qrRect.width, qrRect.height);
  const modulePixels = Math.max(1, Math.ceil(size / moduleCount));
  const actualSize = moduleCount * modulePixels;
  const drawX = snap(qrRect.x + (size - actualSize) / 2);
  const drawY = snap(qrRect.y + (size - actualSize) / 2);

  const pieces = [
    `<rect x="${qrRect.x}" y="${qrRect.y}" width="${size}" height="${size}" fill="#ffffff" shape-rendering="crispEdges" />`
  ];

  for (let row = 0; row < moduleCount; row++)
  {
    for (let column = 0; column < moduleCount; column++)
    {
      if (!qrModel.isDark(row, column))
      {
        continue;
      }

      pieces.push(
        `<rect x="${drawX + column * modulePixels}" y="${drawY + row * modulePixels}" width="${modulePixels}" height="${modulePixels}" fill="#000000" shape-rendering="crispEdges" />`
      );
    }
  }

  return `<g shape-rendering="crispEdges">${pieces.join("")}</g>`;
}

function buildShareCardSvg(root, width, height, filter, qrGenerator, qrElement)
{
  const rootRect = root.getBoundingClientRect();
  const fontFaces = collectFontFaceRules();
  const contents = serializeElement(root, rootRect, filter);
  const qr = serializeQr(qrGenerator, qrElement, rootRect);

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="${SVG_NS}" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" shape-rendering="geometricPrecision">`,
    "<defs>",
    "<style>",
    fontFaces,
    "</style>",
    "</defs>",
    `<rect x="0" y="0" width="${width}" height="${height}" fill="none" />`,
    contents,
    qr,
    "</svg>"
  ].join("");
}

async function imageFromBlob(blob)
{
  const image = new Image();
  const url = URL.createObjectURL(blob);

  try
  {
    image.src = url;
    await image.decode();
    return { image, url };
  }
  catch (error)
  {
    URL.revokeObjectURL(url);
    throw error;
  }
}

export async function renderShareCardSvgToPngBlob({
  root,
  width,
  height,
  scale = 3,
  backgroundColor = "#111111",
  filter,
  qrGenerator = null,
  qrElement = null
})
{
  if (!root)
  {
    throw new Error("Share card root is required");
  }

  const outputWidth = snap(width);
  const outputHeight = snap(height);
  const rasterScale = Math.max(1, snap(scale));
  const highWidth = outputWidth * rasterScale;
  const highHeight = outputHeight * rasterScale;

  if (outputWidth <= 0 || outputHeight <= 0)
  {
    throw new Error("Invalid share card dimensions");
  }

  await document.fonts?.ready;

  const svg = buildShareCardSvg(
    root,
    outputWidth,
    outputHeight,
    filter,
    qrGenerator,
    qrElement
  );

  const svgBlob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const { image: svgImage, url: svgUrl } = await imageFromBlob(svgBlob);
  const highResolutionCanvas = document.createElement("canvas");
  highResolutionCanvas.width = highWidth;
  highResolutionCanvas.height = highHeight;

  const highResolutionContext = highResolutionCanvas.getContext("2d");
  if (!highResolutionContext)
  {
    URL.revokeObjectURL(svgUrl);
    throw new Error("Failed to create high-resolution SVG canvas");
  }

  highResolutionContext.imageSmoothingEnabled = true;
  highResolutionContext.imageSmoothingQuality = "high";
  highResolutionContext.fillStyle = backgroundColor;
  highResolutionContext.fillRect(0, 0, highWidth, highHeight);
  highResolutionContext.drawImage(
    svgImage,
    0,
    0,
    highWidth,
    highHeight
  );

  URL.revokeObjectURL(svgUrl);

  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = outputWidth;
  outputCanvas.height = outputHeight;

  const outputContext = outputCanvas.getContext("2d");
  if (!outputContext)
  {
    throw new Error("Failed to create share image output canvas");
  }

  outputContext.imageSmoothingEnabled = true;
  outputContext.imageSmoothingQuality = "high";
  outputContext.drawImage(
    highResolutionCanvas,
    0,
    0,
    highWidth,
    highHeight,
    0,
    0,
    outputWidth,
    outputHeight
  );

  return new Promise((resolve, reject) =>
  {
    outputCanvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error("Failed to encode SVG-rendered share image")),
      "image/png"
    );
  });
}
