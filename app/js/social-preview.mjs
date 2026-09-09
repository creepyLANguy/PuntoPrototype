const PREVIEW_WIDTH = 1200;
const PREVIEW_HEIGHT = 630;
const FONT_STACK = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';
const DEFAULT_COLOUR_A = '#ad7535';
const DEFAULT_COLOUR_B = '#0a91ac';
const DEFAULT_BG = '#111827';
const CACHE = new Map();

export function escapeXml(value = '')
{
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function normaliseColour(value, fallback)
{
  return /^#[0-9a-f]{6}$/i.test(String(value || '').trim())
    ? String(value).trim()
    : fallback;
}

export function getCourtIdFromLocation(location = window.location)
{
  const match = location.pathname.match(/^\/(?:app\/)?(?:court|c)\/([^/]+)\/?$/i);
  if (!match) return '';

  try
  {
    return decodeURIComponent(match[1]).trim().toLowerCase();
  }
  catch
  {
    return match[1].trim().toLowerCase();
  }
}

export function buildCourtUrl(courtId, origin = window.location.origin)
{
  const cleanOrigin = String(origin || '').replace(/\/$/, '');
  return courtId
    ? `${cleanOrigin}/c/${encodeURIComponent(courtId)}`
    : `${cleanOrigin}/app/`;
}

export function buildShareText({ context, courtName, courtId, teamA, teamB, scoreSummary, url })
{
  const lines = ['Padel Push'];

  if (teamA && teamB)
  {
    lines.push(`${teamA} vs ${teamB}`);
  }

  if (scoreSummary)
  {
    lines.push(scoreSummary);
  }

  if (courtName || courtId)
  {
    lines.push(`${courtName || 'Court'}${courtId ? ` (${courtId.toUpperCase()})` : ''}`);
  }

  lines.push(context === 'details' ? 'View full match details:' : 'View live scoreboard:');
  lines.push(url);

  return lines.join('\n');
}

export function buildCourtPreviewModel({ courtName, courtId, teamA, teamB, pointsA, pointsB, gamesA, gamesB, setsA, setsB, mode })
{
  return {
    type: 'court',
    courtName: String(courtName || 'Court'),
    courtId: String(courtId || '').toUpperCase(),
    teamA: String(teamA || 'Team A'),
    teamB: String(teamB || 'Team B'),
    pointsA: String(pointsA ?? '0'),
    pointsB: String(pointsB ?? '0'),
    gamesA: String(gamesA ?? '0'),
    gamesB: String(gamesB ?? '0'),
    setsA: String(setsA ?? '0'),
    setsB: String(setsB ?? '0'),
    mode: String(mode || '')
  };
}

export function buildDetailsPreviewModel({ courtName, courtId, teamA, teamB, overallA, overallB, headers = [], rowA = [], rowB = [], mode })
{
  return {
    type: 'details',
    courtName: String(courtName || 'Match Details'),
    courtId: String(courtId || '').toUpperCase(),
    teamA: String(teamA || 'Team A'),
    teamB: String(teamB || 'Team B'),
    overallA: String(overallA ?? '0'),
    overallB: String(overallB ?? '0'),
    headers: headers.map(value => String(value || '')),
    rowA: rowA.map(value => String(value || '')),
    rowB: rowB.map(value => String(value || '')),
    mode: String(mode || '')
  };
}

function truncate(value, maxLength)
{
  const text = String(value || '');
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function safeText(value, maxLength = 34)
{
  return escapeXml(truncate(value, maxLength));
}

function getColours()
{
  const styles = getComputedStyle(document.body);
  return {
    background: normaliseColour(styles.getPropertyValue('--background').trim(),
      normaliseColour(styles.getPropertyValue('--bg').trim(), DEFAULT_BG)),
    foreground: normaliseColour(styles.getPropertyValue('--text').trim(), '#ffffff'),
    muted: normaliseColour(styles.getPropertyValue('--muted').trim(), '#a7b0c0'),
    teamA: normaliseColour(styles.getPropertyValue('--teamAcolour').trim(), DEFAULT_COLOUR_A),
    teamB: normaliseColour(styles.getPropertyValue('--teamBcolour').trim(), DEFAULT_COLOUR_B)
  };
}

function getText(root, selector, fallback = '')
{
  const element = root?.querySelector(selector);
  return element?.textContent?.trim() || fallback;
}

function readScoreboardModel()
{
  const root = document;
  const courtId = getCourtIdFromLocation();
  const courtName = getText(root, '#courtTitle', courtId ? `Court ${courtId.toUpperCase()}` : 'Padel Court');
  const teamA = getText(root, '#teamA .name-text', 'Team A');
  const teamB = getText(root, '#teamB .name-text', 'Team B');

  return buildCourtPreviewModel({
    courtName,
    courtId,
    teamA,
    teamB,
    pointsA: getText(root, '#pointsA', '0'),
    pointsB: getText(root, '#pointsB', '0'),
    gamesA: getText(root, '#gamesA', '0'),
    gamesB: getText(root, '#gamesB', '0'),
    setsA: getText(root, '#setsA', '0'),
    setsB: getText(root, '#setsB', '0'),
    mode: getText(root, '#scoreFormatBadge', '')
  });
}

function readDetailsModel()
{
  const box = document.getElementById('dmBox');
  if (!box) throw new Error('Match details panel is not available');

  const headers = [...box.querySelectorAll('#dmHead th')]
    .map(cell => cell.textContent.trim())
    .filter(Boolean);

  const rows = [...box.querySelectorAll('#dmBody tr')].map(row =>
    [...row.querySelectorAll('td')]
      .filter(cell => !cell.classList.contains('dm-marker-cell'))
      .map(cell => cell.textContent.trim())
  );

  const colours = getColours();
  const nameA = getText(box, '#detailsTeamAName', 'Team A');
  const nameB = getText(box, '#detailsTeamBName', 'Team B');

  const isSwapped = box.querySelector('.dm-overall')?.classList.contains('swapped') || false;
  const rawScoreA = getText(box, '#detailsSetsA', '0');
  const rawScoreB = getText(box, '#detailsSetsB', '0');

  return {
    model: buildDetailsPreviewModel({
      courtName: getText(box, '#matchDetailsCourtName', 'Match Details'),
      courtId: getCourtIdFromLocation(),
      teamA: nameA,
      teamB: nameB,
      overallA: rawScoreA,
      overallB: rawScoreB,
      headers,
      rowA: rows[isSwapped ? 1 : 0] || [],
      rowB: rows[isSwapped ? 0 : 1] || [],
      mode: getText(document, '#scoreFormatBadge', '')
    }),
    colours
  };
}

function nextFrame()
{
  return new Promise(resolve => requestAnimationFrame(resolve));
}

async function getQrDataUrl(url)
{
  if (!window.QRCode)
  {
    throw new Error('QR code renderer is unavailable');
  }

  const mount = document.createElement('div');
  mount.style.position = 'fixed';
  mount.style.left = '-100000px';
  mount.style.top = '0';
  mount.style.width = '160px';
  mount.style.height = '160px';
  mount.style.background = '#ffffff';
  mount.setAttribute('aria-hidden', 'true');
  document.body.appendChild(mount);

  try
  {
    new window.QRCode(mount, {
      text: url,
      width: 136,
      height: 136,
      colorDark: '#000000',
      colorLight: '#ffffff',
      correctLevel: window.QRCode.CorrectLevel.H
    });

    await nextFrame();

    const canvas = mount.querySelector('canvas');
    if (canvas)
    {
      return canvas.toDataURL('image/png');
    }

    const image = mount.querySelector('img');
    if (image)
    {
      try
      {
        await image.decode();
      }
      catch
      {
        // src may already be usable even when decode is unsupported.
      }
      return image.currentSrc || image.src;
    }

    throw new Error('QR code renderer returned no image');
  }
  finally
  {
    mount.remove();
  }
}

function svgText(x, y, text, options = {})
{
  const {
    size = 24,
    weight = 500,
    fill = '#ffffff',
    anchor = 'start',
    letterSpacing = 0,
    opacity = 1
  } = options;

  return `<text x="${x}" y="${y}" font-family="${FONT_STACK}" font-size="${size}px" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" letter-spacing="${letterSpacing}px" opacity="${opacity}">${text}</text>`;
}

function baseSvg(colours, content)
{
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${PREVIEW_WIDTH}" height="${PREVIEW_HEIGHT}" viewBox="0 0 ${PREVIEW_WIDTH} ${PREVIEW_HEIGHT}">
  <rect width="100%" height="100%" fill="${colours.background}"/>
  <circle cx="1110" cy="30" r="210" fill="${colours.teamA}" opacity="0.07"/>
  <circle cx="80" cy="620" r="240" fill="${colours.teamB}" opacity="0.08"/>
  ${content}
</svg>`;
}

function renderHeader(model, colours, subtitle = 'Live Padel Scoring')
{
  const courtLine = model.courtId
    ? `${safeText(model.courtName, 44)}  ·  ${safeText(model.courtId, 10)}`
    : safeText(model.courtName, 44);

  return [
    svgText(60, 68, 'PADEL PUSH', { size: 24, weight: 900, letterSpacing: 2.2 }),
    svgText(60, 102, safeText(subtitle, 48), { size: 16, weight: 600, fill: colours.muted }),
    svgText(1140, 74, courtLine, { size: 17, weight: 700, fill: colours.foreground, anchor: 'end' })
  ].join('');
}

function renderTeamRow(x, y, width, name, score, colour, secondary = '')
{
  return `<rect x="${x}" y="${y - 42}" width="${width}" height="112" rx="20" fill="#000000" opacity="0.20"/>
  <rect x="${x}" y="${y - 42}" width="8" height="112" rx="4" fill="${colour}"/>
  ${svgText(x + 28, y - 2, safeText(name, 34), { size: 30, weight: 800 })}
  ${secondary ? svgText(x + 28, y + 30, safeText(secondary, 34), { size: 15, weight: 600, fill: '#c5cedc' }) : ''}
  ${svgText(x + width - 24, y + 8, safeText(score, 8), { size: 56, weight: 900, anchor: 'end', fill: colour })}`;
}

function renderQrBlock(qrDataUrl, colours)
{
  return `<rect x="920" y="414" width="220" height="164" rx="20" fill="#ffffff"/>
  <image href="${qrDataUrl}" x="936" y="430" width="132" height="132" preserveAspectRatio="none"/>
  ${svgText(1080, 458, 'SCAN', { size: 13, weight: 900, fill: '#111827', anchor: 'middle', letterSpacing: 1.2 })}
  ${svgText(1080, 485, 'TO VIEW', { size: 13, weight: 900, fill: '#111827', anchor: 'middle', letterSpacing: 1.2 })}
  ${svgText(1080, 525, 'LIVE MATCH', { size: 11, weight: 700, fill: '#5b6473', anchor: 'middle' })}
  ${svgText(1080, 546, 'DETAILS', { size: 11, weight: 700, fill: '#5b6473', anchor: 'middle' })}`;
}

function courtSvg(model, qrDataUrl, colours)
{
  const secondaryA = model.setsA !== '0' || model.gamesA !== '0'
    ? `Sets ${model.setsA}   ·   Games ${model.gamesA}`
    : '';
  const secondaryB = model.setsB !== '0' || model.gamesB !== '0'
    ? `Sets ${model.setsB}   ·   Games ${model.gamesB}`
    : '';
  const mode = model.mode ? truncate(model.mode, 42) : 'Live scoreboard';

  return baseSvg(colours, `${renderHeader(model, colours, mode)}
    ${svgText(60, 172, 'CURRENT SCORE', { size: 14, weight: 900, fill: colours.muted, letterSpacing: 1.5 })}
    ${renderTeamRow(60, 232, 800, model.teamA, model.pointsA, colours.teamA, secondaryA)}
    ${renderTeamRow(60, 368, 800, model.teamB, model.pointsB, colours.teamB, secondaryB)}
    ${svgText(60, 548, 'Open the court to follow the live scoreboard.', { size: 18, weight: 600, fill: colours.muted })}
    ${qrDataUrl ? renderQrBlock(qrDataUrl, colours) : ''}
    ${svgText(1028, 600, 'PADEL PUSH', { size: 11, weight: 800, fill: colours.muted, anchor: 'middle', letterSpacing: 1.5 })}`);
}

function renderSetStrip(model, colours)
{
  const headers = model.headers.length ? model.headers : [];
  const valuesA = model.rowA.length ? model.rowA : [];
  const valuesB = model.rowB.length ? model.rowB : [];
  const count = Math.max(headers.length, valuesA.length, valuesB.length);
  if (!count) return '';

  const startX = 80;
  const cellW = Math.min(132, Math.floor(790 / count));
  const topY = 292;
  const pieces = [];

  for (let index = 0; index < count; index += 1)
  {
    const x = startX + index * cellW;
    const header = safeText(headers[index] || `S${index + 1}`, 8);
    const valueA = safeText(valuesA[index] || '0', 6);
    const valueB = safeText(valuesB[index] || '0', 6);
    pieces.push(`<rect x="${x}" y="${topY}" width="${cellW - 8}" height="108" rx="14" fill="#000000" opacity="0.18"/>`);
    pieces.push(svgText(x + (cellW - 8) / 2, topY + 25, header, { size: 14, weight: 800, fill: colours.muted, anchor: 'middle' }));
    pieces.push(svgText(x + (cellW - 8) / 2, topY + 64, valueA, { size: 30, weight: 900, fill: colours.teamA, anchor: 'middle' }));
    pieces.push(svgText(x + (cellW - 8) / 2, topY + 95, valueB, { size: 30, weight: 900, fill: colours.teamB, anchor: 'middle' }));
  }

  pieces.push(svgText(startX, topY - 22, 'SET BREAKDOWN', { size: 14, weight: 900, fill: colours.muted, letterSpacing: 1.5 }));
  pieces.push(svgText(60, 472, `${safeText(model.teamA, 32)}  vs  ${safeText(model.teamB, 32)}`, { size: 18, weight: 700, fill: colours.foreground }));

  return pieces.join('');
}

function detailsSvg(model, qrDataUrl, colours)
{
  const heading = model.mode || 'Match details';
  const score = `${safeText(model.overallA, 8)} — ${safeText(model.overallB, 8)}`;

  return baseSvg(colours, `${renderHeader(model, colours, heading)}
    ${svgText(60, 174, safeText(model.teamA, 28), { size: 30, weight: 850, fill: colours.teamA })}
    ${svgText(60, 210, 'vs', { size: 16, weight: 800, fill: colours.muted })}
    ${svgText(60, 246, safeText(model.teamB, 28), { size: 30, weight: 850, fill: colours.teamB })}
    ${svgText(560, 224, score, { size: 52, weight: 900, anchor: 'middle' })}
    ${renderSetStrip(model, colours)}
    ${svgText(60, 548, 'Shared from the Padel Push match scoreboard.', { size: 18, weight: 600, fill: colours.muted })}
    ${qrDataUrl ? renderQrBlock(qrDataUrl, colours) : ''}
    ${svgText(1028, 600, 'PADEL PUSH', { size: 11, weight: 800, fill: colours.muted, anchor: 'middle', letterSpacing: 1.5 })}`);
}

async function svgToPng(svg)
{
  const startedAt = performance.now();
  const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const objectUrl = URL.createObjectURL(svgBlob);
  const image = new Image();

  try
  {
    await new Promise((resolve, reject) =>
    {
      image.onload = resolve;
      image.onerror = () => reject(new Error('Preview SVG could not be rasterised'));
      image.src = objectUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = PREVIEW_WIDTH;
    canvas.height = PREVIEW_HEIGHT;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is unavailable');
    context.drawImage(image, 0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);

    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Preview PNG could not be encoded');

    const elapsed = Math.round(performance.now() - startedAt);
    console.debug(`[social-preview] SVG→PNG ${elapsed}ms (${blob.size} bytes)`);
    return blob;
  }
  finally
  {
    URL.revokeObjectURL(objectUrl);
  }
}

async function buildPreviewFile(context)
{
  const buildStartedAt = performance.now();
  const colours = getColours();

  if (context === 'details')
  {
    const { model } = readDetailsModel();
    const url = buildCourtUrl(model.courtId);
    const key = JSON.stringify({ context, model, colours: [colours.background, colours.foreground, colours.teamA, colours.teamB] });

    if (CACHE.has(key)) return CACHE.get(key);

    const qrStartedAt = performance.now();
    const qrDataUrl = await getQrDataUrl(url);
    console.debug(`[social-preview] QR ${Math.round(performance.now() - qrStartedAt)}ms`);

    const svg = detailsSvg(model, qrDataUrl, colours);
    const blob = await svgToPng(svg);
    const file = new File([blob], 'padel-push-match-details.png', { type: 'image/png' });
    CACHE.clear();
    CACHE.set(key, file);
    console.debug(`[social-preview] details total ${Math.round(performance.now() - buildStartedAt)}ms`);
    return file;
  }

  const model = readScoreboardModel();
  const url = buildCourtUrl(model.courtId);
  const key = JSON.stringify({ context, model, colours: [colours.background, colours.foreground, colours.teamA, colours.teamB] });

  if (CACHE.has(key)) return CACHE.get(key);

  const qrStartedAt = performance.now();
  const qrDataUrl = await getQrDataUrl(url);
  console.debug(`[social-preview] QR ${Math.round(performance.now() - qrStartedAt)}ms`);

  const svg = courtSvg(model, qrDataUrl, colours);
  const blob = await svgToPng(svg);
  const file = new File([blob], 'padel-push-court.png', { type: 'image/png' });
  CACHE.clear();
  CACHE.set(key, file);
  console.debug(`[social-preview] court total ${Math.round(performance.now() - buildStartedAt)}ms`);
  return file;
}

async function shareContext(context)
{
  const model = context === 'details' ? readDetailsModel().model : readScoreboardModel();
  const url = buildCourtUrl(model.courtId);
  const text = buildShareText({
    context,
    courtName: model.courtName,
    courtId: model.courtId,
    teamA: model.teamA,
    teamB: model.teamB,
    scoreSummary: context === 'details'
      ? `${model.overallA}-${model.overallB}`
      : `Score: ${model.pointsA}-${model.pointsB}`,
    url
  });

  let file = null;
  try
  {
    file = await buildPreviewFile(context);
  }
  catch (error)
  {
    console.warn('[social-preview] Image generation failed; falling back to text share.', error);
  }

  if (navigator.share)
  {
    if (file && navigator.canShare?.({ files: [file] }))
    {
      try
      {
        await navigator.share({
          title: `Padel Push — ${model.courtName}`,
          text,
          files: [file]
        });
        return;
      }
      catch (error)
      {
        if (error?.name === 'AbortError') return;
        console.warn('[social-preview] Native image share failed:', error);
      }
    }

    try
    {
      await navigator.share({
        title: `Padel Push — ${model.courtName}`,
        text
      });
      return;
    }
    catch (error)
    {
      if (error?.name === 'AbortError') return;
      console.warn('[social-preview] Native text share failed:', error);
    }
  }

  if (navigator.clipboard?.writeText)
  {
    try
    {
      await navigator.clipboard.writeText(text);
      window.alert('Share text copied to the clipboard.');
      return;
    }
    catch (error)
    {
      console.warn('[social-preview] Clipboard fallback failed:', error);
    }
  }

  window.prompt('Copy this share text:', text);
}

function suppressLegacyDomImageProbe()
{
  if (!navigator.canShare) return;

  const nativeCanShare = navigator.canShare.bind(navigator);
  const wrappedCanShare = function(data)
  {
    const files = Array.isArray(data?.files) ? data.files : [];
    const isLegacyProbe = files.length === 1 &&
      files[0] instanceof File &&
      files[0].name === 'share-image.png' &&
      files[0].size === 0;

    if (isLegacyProbe)
    {
      return false;
    }

    return nativeCanShare(data);
  };

  try
  {
    Object.defineProperty(navigator, 'canShare', {
      configurable: true,
      writable: true,
      value: wrappedCanShare
    });
  }
  catch
  {
    try
    {
      navigator.canShare = wrappedCanShare;
    }
    catch
    {
      // Best-effort only. The new capture-phase listeners still own the share action.
    }
  }
}

function bindShareButtons()
{
  const bindings = [
    ['shareCourtBtn', 'court'],
    ['shareDetailsBtn', 'details']
  ];

  for (const [id, context] of bindings)
  {
    const button = document.getElementById(id);
    if (!button || button.dataset.socialPreviewBound === 'true') continue;

    button.dataset.socialPreviewBound = 'true';
    button.addEventListener('click', event =>
    {
      event.preventDefault();
      event.stopImmediatePropagation();
      void shareContext(context);
    }, { capture: true });
  }
}

function initialise()
{
  suppressLegacyDomImageProbe();
  bindShareButtons();
}

if (document.readyState === 'loading')
{
  document.addEventListener('DOMContentLoaded', initialise, { once: true });
}
else
{
  initialise();
}
