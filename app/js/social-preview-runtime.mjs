const WIDTH = 1200;
const HEIGHT = 630;
const FONT = 'system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Arial, sans-serif';
const FALLBACKS = {
  bg: '#111827',
  fg: '#ffffff',
  muted: '#a7b0c0',
  a: '#ad7535',
  b: '#0a91ac'
};

let cachedKey = '';
let cachedFile = null;

export function escapeXml(value = '')
{
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function getCourtIdFromPath(pathname)
{
  const match = String(pathname || '').match(/^\/(?:app\/)?(?:court|c)\/([^/]+)\/?$/i);
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

export function buildCourtUrl(courtId, origin)
{
  const base = String(origin || '').replace(/\/$/, '');
  return courtId ? `${base}/c/${encodeURIComponent(courtId)}` : `${base}/app/`;
}

export function buildShareText({ context, courtName, courtId, teamA, teamB, score, url })
{
  return [
    'Padel Push',
    teamA && teamB ? `${teamA} vs ${teamB}` : '',
    score || '',
    courtName || courtId ? `${courtName || 'Court'}${courtId ? ` (${courtId.toUpperCase()})` : ''}` : '',
    context === 'details' ? 'View full match details:' : 'View live scoreboard:',
    url
  ].filter(Boolean).join('\n');
}

export function buildCourtModel({ courtName, courtId, teamA, teamB, pointsA, pointsB, gamesA, gamesB, setsA, setsB, mode })
{
  return {
    type: 'court',
    courtName: String(courtName || 'Court'),
    courtId: String(courtId || '').toUpperCase(),
    teamA: String(teamA || 'Team A'),
    teamB: String(teamB || 'Team B'),
    pointsA: String(pointsA ?? 0),
    pointsB: String(pointsB ?? 0),
    gamesA: String(gamesA ?? 0),
    gamesB: String(gamesB ?? 0),
    setsA: String(setsA ?? 0),
    setsB: String(setsB ?? 0),
    mode: String(mode || '')
  };
}

export function buildDetailsModel({ courtName, courtId, teamA, teamB, overallA, overallB, headers = [], rowA = [], rowB = [], mode })
{
  return {
    type: 'details',
    courtName: String(courtName || 'Match Details'),
    courtId: String(courtId || '').toUpperCase(),
    teamA: String(teamA || 'Team A'),
    teamB: String(teamB || 'Team B'),
    overallA: String(overallA ?? 0),
    overallB: String(overallB ?? 0),
    headers: headers.map(value => String(value || '')),
    rowA: rowA.map(value => String(value || '')),
    rowB: rowB.map(value => String(value || '')),
    mode: String(mode || '')
  };
}

function truncate(value, max)
{
  const text = String(value || '');
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function text(value, max = 34)
{
  return escapeXml(truncate(value, max));
}

function colours()
{
  const css = getComputedStyle(document.body);
  const get = (name, fallback) =>
  {
    const value = css.getPropertyValue(name).trim();
    return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
  };

  return {
    bg: get('--background', get('--bg', FALLBACKS.bg)),
    fg: get('--text', FALLBACKS.fg),
    muted: get('--muted', FALLBACKS.muted),
    a: get('--teamAcolour', FALLBACKS.a),
    b: get('--teamBcolour', FALLBACKS.b)
  };
}

function getText(root, selector, fallback = '')
{
  return root?.querySelector(selector)?.textContent?.trim() || fallback;
}

function readCourtModel()
{
  const courtId = getCourtIdFromPath(window.location.pathname);
  return buildCourtModel({
    courtId,
    courtName: getText(document, '#courtTitle', courtId ? `Court ${courtId.toUpperCase()}` : 'Padel Court'),
    teamA: getText(document, '#teamA .name-text', 'Team A'),
    teamB: getText(document, '#teamB .name-text', 'Team B'),
    pointsA: getText(document, '#pointsA', '0'),
    pointsB: getText(document, '#pointsB', '0'),
    gamesA: getText(document, '#gamesA', '0'),
    gamesB: getText(document, '#gamesB', '0'),
    setsA: getText(document, '#setsA', '0'),
    setsB: getText(document, '#setsB', '0'),
    mode: getText(document, '#scoreFormatBadge', '')
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

  const swapped = box.querySelector('.dm-overall')?.classList.contains('swapped') || false;
  return buildDetailsModel({
    courtId: getCourtIdFromPath(window.location.pathname),
    courtName: getText(box, '#matchDetailsCourtName', 'Match Details'),
    teamA: getText(box, '#detailsTeamAName', 'Team A'),
    teamB: getText(box, '#detailsTeamBName', 'Team B'),
    overallA: getText(box, '#detailsSetsA', '0'),
    overallB: getText(box, '#detailsSetsB', '0'),
    headers,
    rowA: rows[swapped ? 1 : 0] || [],
    rowB: rows[swapped ? 0 : 1] || [],
    mode: getText(document, '#scoreFormatBadge', '')
  });
}

function frame()
{
  return new Promise(resolve => requestAnimationFrame(resolve));
}

async function qrDataUrl(url)
{
  if (!window.QRCode) throw new Error('QR renderer unavailable');

  const mount = document.createElement('div');
  Object.assign(mount.style, {
    position: 'fixed', left: '-100000px', top: '0', width: '150px', height: '150px'
  });
  mount.setAttribute('aria-hidden', 'true');
  document.body.appendChild(mount);

  try
  {
    new window.QRCode(mount, {
      text: url,
      width: 132,
      height: 132,
      colorDark: '#000000',
      colorLight: '#ffffff',
      correctLevel: window.QRCode.CorrectLevel.H
    });
    await frame();

    const canvas = mount.querySelector('canvas');
    if (canvas) return canvas.toDataURL('image/png');

    const image = mount.querySelector('img');
    if (image)
    {
      try { await image.decode(); } catch { /* currentSrc may still be usable */ }
      if (image.currentSrc || image.src) return image.currentSrc || image.src;
    }

    throw new Error('QR renderer produced no image');
  }
  finally
  {
    mount.remove();
  }
}

function svgText(x, y, value, { size = 24, weight = 500, fill = '#ffffff', anchor = 'start', spacing = 0 } = {})
{
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}px" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" letter-spacing="${spacing}px">${value}</text>`;
}

function svgShell(c, body)
{
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    <rect width="1200" height="630" fill="${c.bg}"/>
    <circle cx="1110" cy="25" r="220" fill="${c.a}" opacity="0.07"/>
    <circle cx="85" cy="625" r="250" fill="${c.b}" opacity="0.08"/>
    ${body}
  </svg>`;
}

function header(model, c, subtitle)
{
  const court = model.courtId ? `${text(model.courtName, 42)} · ${text(model.courtId, 10)}` : text(model.courtName, 42);
  return [
    svgText(60, 66, 'PADEL PUSH', { size: 24, weight: 900, spacing: 2.2 }),
    svgText(60, 100, text(subtitle, 42), { size: 16, weight: 600, fill: c.muted }),
    svgText(1140, 70, court, { size: 17, weight: 750, anchor: 'end' })
  ].join('');
}

function teamRow(y, name, score, secondary, colour, c)
{
  return `<rect x="60" y="${y - 42}" width="800" height="112" rx="20" fill="#000000" opacity="0.20"/>
    <rect x="60" y="${y - 42}" width="8" height="112" rx="4" fill="${colour}"/>
    ${svgText(88, y - 2, text(name), { size: 30, weight: 800 })}
    ${secondary ? svgText(88, y + 30, text(secondary, 42), { size: 15, weight: 600, fill: '#c5cedc' }) : ''}
    ${svgText(836, y + 8, text(score, 8), { size: 56, weight: 900, fill: colour, anchor: 'end' })}`;
}

function qrBlock(qr, c)
{
  if (!qr) return '';
  return `<rect x="920" y="414" width="220" height="164" rx="20" fill="#ffffff"/>
    <image href="${qr}" x="936" y="430" width="132" height="132" preserveAspectRatio="none"/>
    ${svgText(1080, 458, 'SCAN', { size: 13, weight: 900, fill: '#111827', anchor: 'middle', spacing: 1.2 })}
    ${svgText(1080, 485, 'TO VIEW', { size: 13, weight: 900, fill: '#111827', anchor: 'middle', spacing: 1.2 })}
    ${svgText(1080, 525, 'LIVE MATCH', { size: 11, weight: 700, fill: '#5b6473', anchor: 'middle' })}
    ${svgText(1080, 546, 'DETAILS', { size: 11, weight: 700, fill: '#5b6473', anchor: 'middle' })}`;
}

function courtSvg(model, qr, c)
{
  const aSecondary = model.setsA !== '0' || model.gamesA !== '0' ? `Sets ${model.setsA} · Games ${model.gamesA}` : '';
  const bSecondary = model.setsB !== '0' || model.gamesB !== '0' ? `Sets ${model.setsB} · Games ${model.gamesB}` : '';
  return svgShell(c, [
    header(model, c, model.mode || 'Live scoreboard'),
    svgText(60, 170, 'CURRENT SCORE', { size: 14, weight: 900, fill: c.muted, spacing: 1.5 }),
    teamRow(232, model.teamA, model.pointsA, aSecondary, c.a, c),
    teamRow(368, model.teamB, model.pointsB, bSecondary, c.b, c),
    svgText(60, 548, 'Open the court to follow the live scoreboard.', { size: 18, weight: 600, fill: c.muted }),
    qrBlock(qr, c),
    svgText(1028, 600, 'PADEL PUSH', { size: 11, weight: 800, fill: c.muted, anchor: 'middle', spacing: 1.5 })
  ].join(''));
}

function setStrip(model, c)
{
  const count = Math.max(model.headers.length, model.rowA.length, model.rowB.length);
  if (!count) return '';

  const startX = 60;
  const cellW = Math.min(132, Math.floor(800 / count));
  const topY = 308;
  const parts = [svgText(startX, topY - 24, 'SET BREAKDOWN', { size: 14, weight: 900, fill: c.muted, spacing: 1.5 })];

  for (let i = 0; i < count; i += 1)
  {
    const x = startX + i * cellW;
    const width = cellW - 8;
    parts.push(`<rect x="${x}" y="${topY}" width="${width}" height="108" rx="14" fill="#000000" opacity="0.18"/>`);
    parts.push(svgText(x + width / 2, topY + 25, text(model.headers[i] || `S${i + 1}`, 8), { size: 14, weight: 800, fill: c.muted, anchor: 'middle' }));
    parts.push(svgText(x + width / 2, topY + 64, text(model.rowA[i] || '0', 6), { size: 30, weight: 900, fill: c.a, anchor: 'middle' }));
    parts.push(svgText(x + width / 2, topY + 95, text(model.rowB[i] || '0', 6), { size: 30, weight: 900, fill: c.b, anchor: 'middle' }));
  }

  return parts.join('');
}

function detailsSvg(model, qr, c)
{
  return svgShell(c, [
    header(model, c, model.mode || 'Match details'),
    svgText(60, 176, text(model.teamA, 30), { size: 30, weight: 850, fill: c.a }),
    svgText(60, 211, 'vs', { size: 16, weight: 800, fill: c.muted }),
    svgText(60, 246, text(model.teamB, 30), { size: 30, weight: 850, fill: c.b }),
    svgText(590, 224, `${text(model.overallA, 8)} — ${text(model.overallB, 8)}`, { size: 52, weight: 900, anchor: 'middle' }),
    setStrip(model, c),
    svgText(60, 548, 'Shared from the Padel Push match scoreboard.', { size: 18, weight: 600, fill: c.muted }),
    qrBlock(qr, c),
    svgText(1028, 600, 'PADEL PUSH', { size: 11, weight: 800, fill: c.muted, anchor: 'middle', spacing: 1.5 })
  ].join(''));
}

async function svgToPng(svg)
{
  const started = performance.now();
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const objectUrl = URL.createObjectURL(blob);
  const image = new Image();

  try
  {
    await new Promise((resolve, reject) =>
    {
      image.onload = resolve;
      image.onerror = () => reject(new Error('Preview SVG rasterisation failed'));
      image.src = objectUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable');
    ctx.drawImage(image, 0, 0, WIDTH, HEIGHT);

    const result = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!result) throw new Error('Preview PNG encoding failed');

    console.debug(`[social-preview] rasterise ${Math.round(performance.now() - started)}ms, ${result.size} bytes`);
    return result;
  }
  finally
  {
    URL.revokeObjectURL(objectUrl);
  }
}

async function previewFile(context)
{
  const started = performance.now();
  const c = colours();
  const model = context === 'details' ? readDetailsModel() : readCourtModel();
  const url = buildCourtUrl(model.courtId.toLowerCase(), window.location.origin);
  const key = JSON.stringify({ context, model, c });

  if (cachedFile && key === cachedKey) return cachedFile;

  const qrStarted = performance.now();
  const qr = await qrDataUrl(url);
  console.debug(`[social-preview] QR ${Math.round(performance.now() - qrStarted)}ms`);

  const svg = context === 'details' ? detailsSvg(model, qr, c) : courtSvg(model, qr, c);
  const blob = await svgToPng(svg);
  const fileName = context === 'details' ? 'padel-push-match-details.png' : 'padel-push-court.png';
  const file = new File([blob], fileName, { type: 'image/png' });
  cachedKey = key;
  cachedFile = file;
  console.debug(`[social-preview] ${context} total ${Math.round(performance.now() - started)}ms`);
  return file;
}

function showMessage(message)
{
  const container = document.getElementById('toastContainer');
  if (!container)
  {
    console.info(`[social-preview] ${message}`);
    return;
  }

  const toast = document.createElement('div');
  toast.className = 'toast success';
  toast.textContent = message;
  container.appendChild(toast);
  window.setTimeout(() => toast.remove(), 3000);
}

async function share(context)
{
  const model = context === 'details' ? readDetailsModel() : readCourtModel();
  const url = buildCourtUrl(model.courtId.toLowerCase(), window.location.origin);
  const score = context === 'details'
    ? `${model.overallA}-${model.overallB}`
    : `Score: ${model.pointsA}-${model.pointsB}`;
  const shareText = buildShareText({
    context,
    courtName: model.courtName,
    courtId: model.courtId,
    teamA: model.teamA,
    teamB: model.teamB,
    score,
    url
  });

  let file = null;
  try
  {
    file = await previewFile(context);
  }
  catch (error)
  {
    console.warn('[social-preview] Image generation failed; continuing with text share.', error);
  }

  if (navigator.share)
  {
    if (file && navigator.canShare?.({ files: [file] }))
    {
      try
      {
        await navigator.share({
          title: `Padel Push — ${model.courtName}`,
          text: shareText,
          files: [file]
        });
        return;
      }
      catch (error)
      {
        if (error?.name === 'AbortError') return;
        console.warn('[social-preview] Image share failed:', error);
      }
    }

    try
    {
      await navigator.share({ title: `Padel Push — ${model.courtName}`, text: shareText });
      return;
    }
    catch (error)
    {
      if (error?.name === 'AbortError') return;
      console.warn('[social-preview] Text share failed:', error);
    }
  }

  if (navigator.clipboard?.writeText)
  {
    try
    {
      await navigator.clipboard.writeText(shareText);
      showMessage('Share text copied.');
      return;
    }
    catch (error)
    {
      console.warn('[social-preview] Clipboard fallback failed:', error);
    }
  }

  window.prompt('Copy this share text:', shareText);
}

function suppressLegacyProbe()
{
  if (!navigator.canShare) return;

  const native = navigator.canShare.bind(navigator);
  const wrapped = function(data)
  {
    const files = Array.isArray(data?.files) ? data.files : [];
    const legacyProbe = files.length === 1 && files[0] instanceof File && files[0].name === 'share-image.png' && files[0].size === 0;
    return legacyProbe ? false : native(data);
  };

  try
  {
    Object.defineProperty(navigator, 'canShare', { configurable: true, writable: true, value: wrapped });
  }
  catch
  {
    try { navigator.canShare = wrapped; } catch { /* best effort */ }
  }
}

function bind()
{
  suppressLegacyProbe();

  for (const [id, context] of [['shareCourtBtn', 'court'], ['shareDetailsBtn', 'details']])
  {
    const button = document.getElementById(id);
    if (!button || button.dataset.socialPreviewBound === 'true') continue;

    button.dataset.socialPreviewBound = 'true';
    button.addEventListener('click', event =>
    {
      event.preventDefault();
      event.stopImmediatePropagation();
      void share(context);
    }, { capture: true });
  }
}

if (document.readyState === 'loading')
{
  document.addEventListener('DOMContentLoaded', bind, { once: true });
}
else
{
  bind();
}
