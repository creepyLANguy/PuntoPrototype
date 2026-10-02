// Shareable score card capture: clones the rendered Match Details card, lays it
// out at 1080x1350, renders it with html-to-image and composites a pixel-aligned
// QR code. The resulting file is consumed by sharing/sharePayload.js.
import { toBlob } from "https://esm.sh/html-to-image@1.11.13";
import { shareCardState } from "./shareCardState.js";
import { drawPixelAlignedQr, getShareLogoDataUrl } from "./shareCardAssets.js";

export async function cacheShareableScoreCard(generation = shareCardState.shareableScoreCardGeneration)
{
  const element = document.getElementById('dmBox');

  if (!element)
  {
    throw new Error('Share element not found');
  }

  const courtLabelElement = document.getElementById('courtQrLabel');
  const rawCourtId = typeof courtLabelElement?.textContent === 'string'
    ? courtLabelElement.textContent.trim()
    : '';
  const fallbackMatch = window.location.pathname.match(/^\/(?:app\/)?(?:court|c)\/([^/]+)\/?$/i);
  const fallbackCourtId = fallbackMatch ? decodeURIComponent(fallbackMatch[1]).trim() : '';
  const courtId = (rawCourtId || fallbackCourtId || '').toLowerCase();
  const courtIdDisplay = courtId ? courtId.toUpperCase() : 'UNKNOWN';
  const appOrigin = window.location.origin.replace(/\/$/, '');
  const qrUrl = courtId ? `${appOrigin}/c/${encodeURIComponent(courtId)}` : `${appOrigin}/app/`;

  // Capture the modal's own background instead of the document body. The
  // details modal deliberately has a different light-theme surface than body.
  const cardBackground = getComputedStyle(element).backgroundColor || '#111111';
  const isLightTheme = document.body.classList.contains('light-mode');
  const watermarkColor = isLightTheme ? '#111111' : '#ffffff';
  const watermarkLogoDataUrl = await getShareLogoDataUrl(watermarkColor);

  // Share images are designed directly at their final 4:5 dimensions. The clone
  // uses the same CSS pixel dimensions as the final PNG, so typography, wrapping,
  // spacing, and QR sizing are all authored against the real export canvas.
  // Keeping these values here makes the sizing explicitly local to image sharing.
  const SHARE_IMAGE_WIDTH = 1080;
  const SHARE_IMAGE_HEIGHT = 1350;
  const SHARE_IMAGE_CONTENT_WIDTH = 840;
  const SHARE_IMAGE_SCORE_PANEL_WIDTH = 720;
  const SHARE_IMAGE_QR_PANEL_WIDTH = 720;
  const SHARE_IMAGE_QR_LEFT_OFFSET = 104;
  const SHARE_IMAGE_SCALE = 2;
  const footerHeight = 96 * SHARE_IMAGE_SCALE;

  const clone = element.cloneNode(true);

  // Preserve the visual density of the previous 2x-rendered share image while
  // keeping the design itself authored at the final 1080x1350 CSS dimensions.
  clone.style.padding = `40px 56px 16px`;
  clone.style.borderRadius = `48px`;

  const shareLogo = clone.querySelector('.dm-logo');
  const shareHeader = clone.querySelector('.dm-header');
  const shareTitle = clone.querySelector('.dm-title');
  const shareCourtName = clone.querySelector('#matchDetailsCourtName');
  const shareTeams = clone.querySelector('.dm-teams');
  const shareNames = clone.querySelectorAll('.dm-name');
  const shareVs = clone.querySelector('.dm-vs');
  const shareOverall = clone.querySelector('.dm-overall');
  const shareSets = clone.querySelectorAll('.dm-sets');
  const shareDash = clone.querySelector('.dm-dash');
  const shareMidSection = clone.querySelector('.dm-mid-section');
  const shareTableWrap = clone.querySelector('.dm-table-wrap');
  const shareTable = clone.querySelector('.dm-table');

  if (shareLogo)
  {
    shareLogo.style.width = `144px`;
    shareLogo.style.height = `144px`;
  }

  if (shareHeader)
  {
    shareHeader.style.gap = `16px`;
    shareHeader.style.marginBottom = `36px`;
  }

  if (shareTitle)
  {
    shareTitle.style.fontSize = `4rem`;
  }

  if (shareCourtName)
  {
    shareCourtName.style.fontSize = `2.2rem`;
    shareCourtName.style.lineHeight = '1.2';
    shareCourtName.style.margin = '8px 0 0';
    shareCourtName.style.textAlign = 'center';
  }

  shareNames.forEach(node =>
  {
    node.style.fontSize = `2.8rem`;
    node.style.maxWidth = '100%';
  });

  if (shareVs)
  {
    shareVs.style.fontSize = `1.5rem`;
    shareVs.style.lineHeight = '1.8';
  }

  if (shareTeams)
  {
    shareTeams.style.marginBottom = `42px`;
  }

  if (shareOverall)
  {
    shareOverall.style.gap = `28px`;
    shareOverall.style.marginBottom = `44px`;
  }

  shareSets.forEach(node =>
  {
    node.style.fontSize = `6.5rem`;
  });

  if (shareDash)
  {
    shareDash.style.fontSize = `4rem`;
  }

  // Interactive controls and the details dropdown are part of the live modal,
  // but must never be included in the shareable image. Remove them before
  // html-to-image serializes the clone.
  clone
    .querySelectorAll('.dm-close, .dm-share-btn, .dm-details-panel, .dm-empty-state, .dm-error-state')
    .forEach(node => node.remove());

  // The modal intentionally ellipsizes long team names for the compact on-screen
  // layout. The share image has enough vertical space to wrap them instead.
  clone.querySelectorAll('.dm-name').forEach(node =>
  {
    node.style.whiteSpace = 'normal';
    node.style.overflow = 'visible';
    node.style.textOverflow = 'clip';
    node.style.overflowWrap = 'anywhere';
    node.style.wordBreak = 'break-word';
    node.style.maxWidth = '100%';
    node.style.width = '100%';
    node.style.textAlign = 'center';
    node.style.lineHeight = '1.15';
  });

  // The share image uses an 840px main content column. The score table and QR/footer
  // use the same narrower panel width so their horizontal density stays compact,
  // while the live details modal keeps its normal responsive width.
  [shareHeader, shareMidSection].forEach(node =>
  {
    if (!node) return;
    node.style.width = `${SHARE_IMAGE_CONTENT_WIDTH}px`;
    node.style.maxWidth = '100%';
    node.style.boxSizing = 'border-box';
  });

  if (shareOverall)
  {
    shareOverall.style.width = '100%';
    shareOverall.style.justifyContent = 'center';
  }

  if (shareTeams)
  {
    shareTeams.style.width = '100%';
    shareTeams.style.maxWidth = '100%';
  }

  if (shareTableWrap)
  {
    shareTableWrap.style.width = `${SHARE_IMAGE_SCORE_PANEL_WIDTH}px`;
    shareTableWrap.style.maxWidth = '100%';
    shareTableWrap.style.boxSizing = 'border-box';
  }

  if (shareTableWrap && shareTable)
  {
    shareTableWrap.style.padding = '16px 24px';
    shareTableWrap.style.overflow = 'visible';
    shareTableWrap.style.boxSizing = 'border-box';
    shareTableWrap.style.borderRadius = '32px';
    shareTable.style.width = '100%';
    shareTable.style.minWidth = '0';
    shareTable.style.margin = '0';

    shareTable.querySelectorAll('thead th').forEach(node =>
    {
      node.style.padding = '6px 16px 12px';
      node.style.fontSize = '1.9rem';
    });

    shareTable.querySelectorAll('tbody td').forEach(node =>
    {
      node.style.padding = '14px 16px';
      node.style.minWidth = '84px';
      node.style.fontSize = '3.5rem';
    });

    shareTable.querySelectorAll('.dm-marker-cell').forEach(node =>
    {
      node.style.width = '12px';
      node.style.paddingRight = '20px';
    });

    shareTable.querySelectorAll('.dm-marker-cell span').forEach(node =>
    {
      node.style.width = '8px';
      node.style.minHeight = '72px';
      node.style.borderRadius = '4px';
    });

    shareTable.querySelectorAll('.dm-row-separator td').forEach(node =>
    {
      node.style.height = '2px';
    });
  }

  // Make the watermark deterministic for html-to-image. The light-theme version
  // previously depended on CSS filter inversion of the white SVG, which can be
  // omitted by the serializer and leave the watermark invisible on white.
  const watermark = clone.querySelector('.dm-watermark');
  const watermarkImage = watermark?.querySelector('img');

  if (watermark)
  {
    watermark.style.zIndex = '0';
    watermark.style.opacity = '0.5';
    watermark.style.width = '100%';
    watermark.style.height = '100%';
    watermark.style.borderRadius = '48px';
  }

  if (watermarkImage)
  {
    watermarkImage.src = watermarkLogoDataUrl;
    watermarkImage.removeAttribute('srcset');
    watermarkImage.style.filter = 'none';
    watermarkImage.style.opacity = '0.06';
    watermarkImage.style.width = '88%';
    watermarkImage.style.maxWidth = 'none';
  }

  // A dedicated element appended to the card, rather than the details panel
  // reused in place. The QR block is centred and sized to its content so the
  // code and its caption stay together instead of being pushed to opposite
  // edges with a gap down the middle.
  const footerPanel = document.createElement('div');
  clone.appendChild(footerPanel);
  footerPanel.style.position = 'static';
  footerPanel.style.width = `${SHARE_IMAGE_QR_PANEL_WIDTH}px`;
  footerPanel.style.maxWidth = '100%';
  footerPanel.style.marginTop = '0';
  footerPanel.style.display = 'flex';
  footerPanel.style.alignItems = 'center';
  footerPanel.style.justifyContent = 'flex-start';
  footerPanel.style.gap = `28px`;
  footerPanel.style.padding = `24px 32px`;
  footerPanel.style.minHeight = `${footerHeight + 24}px`;
  footerPanel.style.boxSizing = 'border-box';
  footerPanel.style.paddingLeft = `${SHARE_IMAGE_QR_LEFT_OFFSET}px`;

  const qrWrap = document.createElement('div');
  qrWrap.style.display = 'inline-flex';
  qrWrap.style.alignItems = 'center';
  qrWrap.style.justifyContent = 'center';
  qrWrap.style.padding = `16px`;
  qrWrap.style.background = '#ffffff';
  qrWrap.style.borderRadius = '20px';
  qrWrap.style.flex = '0 0 auto';

  const qrMount = document.createElement('div');
  qrWrap.appendChild(qrMount);

  const footerText = document.createElement('div');
  footerText.style.display = 'flex';
  footerText.style.flexDirection = 'column';
  footerText.style.gap = '8px';
  footerText.style.flex = '0 1 auto';
  footerText.style.minWidth = '0';

  const footerTitle = document.createElement('div');
  footerTitle.textContent = 'Scan for match details';
  footerTitle.style.fontSize = `30px`;
  footerTitle.style.fontWeight = '700';
  footerTitle.style.letterSpacing = '0.02em';

  const footerCourtId = document.createElement('div');
  footerCourtId.textContent = `Court ID: ${courtIdDisplay}`;
  footerCourtId.style.fontSize = `34px`;
  footerCourtId.style.fontWeight = '800';
  footerCourtId.style.letterSpacing = '0.06em';

  const footerUrl = document.createElement('div');
  footerUrl.textContent = qrUrl.replace(/^https?:\/\//i, '');
  footerUrl.style.fontSize = `24px`;
  footerUrl.style.opacity = '0.85';
  footerUrl.style.overflow = 'hidden';
  footerUrl.style.textOverflow = 'ellipsis';
  footerUrl.style.whiteSpace = 'nowrap';

  footerText.appendChild(footerTitle);
  footerText.appendChild(footerCourtId);
  footerText.appendChild(footerUrl);

  footerPanel.appendChild(qrWrap);
  footerPanel.appendChild(footerText);

  let qrGenerator = null;
  let qrSize = 0;

  if (window.QRCode)
  {
    qrSize = Math.max(168, Math.min(240, footerHeight - 48));

    // Generate the QR only to obtain its canonical module matrix. The generated
    // canvas/image is deliberately never attached to the export DOM, so it
    // cannot be resampled by html-to-image or by the later 2x -> 1x downsample.
    qrGenerator = new window.QRCode(document.createElement('div'), {
      text: qrUrl,
      width: qrSize,
      height: qrSize,
      colorDark: '#000000',
      colorLight: '#ffffff',
      correctLevel: window.QRCode.CorrectLevel.H
    });

    // Reserve the next pixel-aligned QR resolution in the layout as well. This
    // keeps the enlarged QR inside its own white/padded block instead of letting
    // the extra pixels spill into the footer text.
    const qrModel = qrGenerator?._oQRCode;
    const qrModuleCount = qrModel?.getModuleCount?.();
    if (!Number.isInteger(qrModuleCount) || qrModuleCount <= 0)
    {
      throw new Error('QR generator did not expose its generated module matrix');
    }

    const qrModulePixels = Math.ceil(qrSize / qrModuleCount);
    const qrRenderSize = qrModuleCount * qrModulePixels;

    qrMount.style.width = qrRenderSize + 'px';
    qrMount.style.height = qrRenderSize + 'px';
    qrMount.style.flex = '0 0 auto';
  }

  const inclusions = (node) =>
  {
    const excludedClasses = [
      'dm-close',
      'dm-share-btn',
      'dm-details-panel',
      'dm-empty-state',
      'dm-error-state',
      'hidden',
      'invisible',
      'sr-only',
      'no-print'
    ];

    if (node.nodeType === Node.ELEMENT_NODE)
    {
      const el = node;
      if (excludedClasses.some(cls => el.classList.contains(cls)))
      {
        return false;
      }

      // An <img> with no source makes html-to-image fetch the empty URL, which
      // resolves to this page, and then reject when the HTML fails to decode as
      // an image. Drop those before they reach the serializer.
      if (el.tagName === 'IMG' && !el.getAttribute('src'))
      {
        return false;
      }
    }
    return true;
  };

  clone.style.width = `${SHARE_IMAGE_WIDTH}px`;
  clone.style.height = `${SHARE_IMAGE_HEIGHT}px`;
  clone.style.minWidth = `${SHARE_IMAGE_WIDTH}px`;
  clone.style.maxWidth = `${SHARE_IMAGE_WIDTH}px`;
  clone.style.minHeight = `${SHARE_IMAGE_HEIGHT}px`;
  clone.style.maxHeight = `${SHARE_IMAGE_HEIGHT}px`;
  clone.style.boxSizing = 'border-box';
  clone.style.overflow = 'visible';
  clone.style.overflowY = 'visible';
  clone.style.background = cardBackground;

  const staging = document.createElement('div');
  staging.style.position = 'fixed';
  staging.style.left = '-10000px';
  staging.style.top = '0';
  staging.style.pointerEvents = 'none';
  staging.style.zIndex = '-1';
  staging.style.width = `${SHARE_IMAGE_WIDTH}px`;
  staging.appendChild(clone);
  document.body.appendChild(staging);

  // The clone now has its final export dimensions and is attached to the DOM,
  // so its geometry reflects the actual 1080x1350 share image.
  await new Promise(resolve => requestAnimationFrame(() => resolve()));

  const cloneRect = clone.getBoundingClientRect();
  const scoreDetailsRect = shareTableWrap?.getBoundingClientRect();

  if (scoreDetailsRect && cloneRect.height > 0)
  {
    const scoreBottom = scoreDetailsRect.bottom - cloneRect.top;
    const footerRect = footerPanel.getBoundingClientRect();
    const footerTop = footerRect.top - cloneRect.top;
    const verticalGap = Math.max(
      0,
      (cloneRect.height - scoreBottom - footerRect.height) / 2
    );
    const desiredFooterTop = scoreBottom + verticalGap;
    const additionalMargin = desiredFooterTop - footerTop;

    footerPanel.style.marginTop = `${Math.max(0, additionalMargin)}px`;
  }

  clone.querySelectorAll('*').forEach(node =>
  {
    const overflowY = getComputedStyle(node).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll')
    {
      node.style.maxHeight = 'none';
      node.style.overflow = 'visible';
      node.style.overflowY = 'visible';
    }
  });

  await new Promise(resolve => requestAnimationFrame(() => resolve()));

  let blob = null;
  try
  {
    // Render at 2x internally so text and vector-like edges are rasterized
    // with more samples, then downsample to the original 1080x1350 output.
    const highResolutionBlob = await toBlob(clone, {
      width: SHARE_IMAGE_WIDTH,
      height: SHARE_IMAGE_HEIGHT,
      canvasWidth: SHARE_IMAGE_WIDTH,
      canvasHeight: SHARE_IMAGE_HEIGHT,
      pixelRatio: 2,
      backgroundColor: cardBackground,
      filter: (node) => inclusions(node),
    });

    if (!highResolutionBlob)
    {
      throw new Error('Failed to generate high-resolution image');
    }

    const highResolutionImage = new Image();
    const highResolutionUrl = URL.createObjectURL(highResolutionBlob);

    try
    {
      highResolutionImage.src = highResolutionUrl;
      await highResolutionImage.decode();

      const outputCanvas = document.createElement('canvas');
      outputCanvas.width = SHARE_IMAGE_WIDTH;
      outputCanvas.height = SHARE_IMAGE_HEIGHT;

      const outputContext = outputCanvas.getContext('2d');
      if (!outputContext)
      {
        throw new Error('Failed to create output canvas');
      }

      outputContext.imageSmoothingEnabled = true;
      outputContext.imageSmoothingQuality = 'high';
      outputContext.drawImage(
        highResolutionImage,
        0,
        0,
        highResolutionImage.naturalWidth,
        highResolutionImage.naturalHeight,
        0,
        0,
        SHARE_IMAGE_WIDTH,
        SHARE_IMAGE_HEIGHT
      );

      // QR is intentionally rendered last. The rest of the card can benefit
      // from the high-quality smoothed downsample, while the QR is placed
      // directly into the final 1080x1350 raster with integer-aligned module
      // boundaries and no intermediate image resampling.
      if (qrGenerator)
      {
        const cloneRect = clone.getBoundingClientRect();
        const qrRect = qrMount.getBoundingClientRect();
        const qrX = Math.round(qrRect.left - cloneRect.left);
        const qrY = Math.round(qrRect.top - cloneRect.top);
        const qrFinalSize = Math.round(Math.min(qrRect.width, qrRect.height));

        drawPixelAlignedQr(outputContext, qrGenerator, qrX, qrY, qrFinalSize);
      }

      blob = await new Promise((resolve, reject) =>
      {
        outputCanvas.toBlob(
          generatedBlob => generatedBlob ? resolve(generatedBlob) : reject(new Error('Failed to encode output image')),
          'image/png'
        );
      });
    }
    finally
    {
      URL.revokeObjectURL(highResolutionUrl);
    }
  }
  finally
  {
    staging.remove();
  }

  if (!blob)
  {
    throw new Error('Failed to generate image');
  }

  const file = new File(
    [blob],
    'share-image.png',
    { type: 'image/png' }
  );

  if (generation !== shareCardState.shareableScoreCardGeneration)
  {
    return;
  }

  shareCardState.shareableScoreCardImage = file;
}


  // const modal = document.getElementById("shareImageModal");
  // const preview = document.getElementById("shareImagePreview");
  // const closeButton = document.getElementById("closeShareImageBtn");
  // if (!modal || !preview || !closeButton) return;

  // if (shareableScoreCardImageUrl)
  // {
  //   URL.revokeObjectURL(shareableScoreCardImageUrl);
  // }

  // shareableScoreCardImageUrl = URL.createObjectURL(shareableScoreCardImage);
  // preview.src = shareableScoreCardImageUrl;
  // modal.classList.remove("hidden");

  // if (closeButton.dataset.bound !== "true")
  // {
  //   closeButton.dataset.bound = "true";
  //   closeButton.addEventListener("click", dismissShareableScoreCard);
  //   modal.addEventListener("click", (event) =>
  //   {
  //     if (event.target === modal) dismissShareableScoreCard();
  //   });
  //   document.addEventListener("keydown", (event) =>
  //   {
  //     if (event.key === "Escape" && !modal.classList.contains("hidden"))
  //     {
  //       dismissShareableScoreCard();
  //     }
  //   });
  // }
