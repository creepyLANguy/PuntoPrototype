// Assets for the shareable score card: the tinted logo data URL, the file-sharing
// capability probe and pixel-aligned QR drawing.

// Cache the Padel Push logo as a same-origin PNG data URL. This avoids relying on
// SVG/CSS filter rendering inside html-to-image, which is particularly fragile
// for the light-theme watermark.
const shareLogoDataUrlCache = new Map();

export async function getShareLogoDataUrl(color = '#ffffff')
{
  const normalizedColor = String(color || '#ffffff').toLowerCase();
  if (shareLogoDataUrlCache.has(normalizedColor))
  {
    return shareLogoDataUrlCache.get(normalizedColor);
  }

  const image = new Image();
  image.decoding = 'async';
  image.src = '/media/logo.svg';

  await new Promise((resolve, reject) =>
  {
    if (image.complete && image.naturalWidth > 0)
    {
      resolve();
      return;
    }

    image.addEventListener('load', resolve, { once: true });
    image.addEventListener('error', () => reject(new Error('Padel Push logo could not be loaded')), { once: true });
  });

  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const context = canvas.getContext('2d');
  if (!context)
  {
    throw new Error('Could not create logo canvas');
  }

  context.drawImage(image, 0, 0, size, size);

  if (normalizedColor !== 'source')
  {
    context.globalCompositeOperation = 'source-in';
    context.fillStyle = normalizedColor;
    context.fillRect(0, 0, size, size);
    context.globalCompositeOperation = 'source-over';
  }

  const dataUrl = canvas.toDataURL('image/png');
  shareLogoDataUrlCache.set(normalizedColor, dataUrl);
  return dataUrl;
}

// The captured card is only ever consumed// The captured card is only ever consumed as payload.files in getSharePayload,
// and that path is itself gated on navigator.canShare. Where the browser cannot
// share files there is nothing to spend the capture on, so probe once with an
// empty dummy file and reuse the answer.
let canShareFilesResult = null;

export function canShareFiles()
{
  if (canShareFilesResult === null)
  {
    try
    {
      const probeFile = new File([], 'share-image.png', { type: 'image/png' });
      canShareFilesResult = Boolean(
        navigator.canShare && navigator.canShare({ files: [probeFile] })
      );
    }
    catch (err)
    {
      // Older browsers can throw on either the File constructor or canShare.
      canShareFilesResult = false;
    }
  }

  return canShareFilesResult;
}

// let shareableScoreCardImageUrl = null;
//
// function dismissShareableScoreCard()
// {
//   const modal = document.getElementById("shareImageModal");
//   if (!modal) return;

//   modal.classList.add("hidden");
//   document.getElementById("shareImagePreview")?.removeAttribute("src");

//   if (shareableScoreCardImageUrl)
//   {
//     URL.revokeObjectURL(shareableScoreCardImageUrl);
//     shareableScoreCardImageUrl = null;
//   }
// }

export function drawPixelAlignedQr(outputContext, qrGenerator, x, y, size)
{
  const qrModel = qrGenerator?._oQRCode;
  if (!qrModel || typeof qrModel.getModuleCount !== 'function' || typeof qrModel.isDark !== 'function')
  {
    throw new Error('QR generator did not expose its generated module matrix');
  }

  const moduleCount = qrModel.getModuleCount();
  if (!Number.isInteger(moduleCount) || moduleCount <= 0 || size <= 0)
  {
    throw new Error('Invalid QR module geometry');
  }

  // Use one integer number of final-image pixels for EVERY QR module.
  // Choose the next integer module size rather than flooring down. This keeps
  // every dark/light cell pixel-aligned while avoiding the systematic shrink
  // caused by fitting the QR strictly inside the requested square.
  const modulePixels = Math.ceil(size / moduleCount);
  if (modulePixels < 1)
  {
    throw new Error(`QR area too small for ${moduleCount} modules`);
  }

  const actualSize = moduleCount * modulePixels;
  const drawX = Math.round(x + (size - actualSize) / 2);
  const drawY = Math.round(y + (size - actualSize) / 2);

  outputContext.save();
  outputContext.imageSmoothingEnabled = false;
  outputContext.fillStyle = '#ffffff';
  outputContext.fillRect(Math.round(x), Math.round(y), Math.round(size), Math.round(size));

  outputContext.fillStyle = '#000000';
  for (let row = 0; row < moduleCount; row++)
  {
    for (let column = 0; column < moduleCount; column++)
    {
      if (qrModel.isDark(row, column))
      {
        outputContext.fillRect(
          drawX + column * modulePixels,
          drawY + row * modulePixels,
          modulePixels,
          modulePixels
        );
      }
    }
  }

  outputContext.restore();
}
