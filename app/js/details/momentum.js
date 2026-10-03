// Match momentum graph (#dmMomentumWrap): fetching /momentum/{courtId} and drawing
// the animated canvas graph.
import { syncDetailsPanelAvailability } from "./matchDetails.js";
import { session } from "../state/sessionState.js";
import { elements } from "../ui/dom.js";

let momentumPulseAnimationFrame = null;

export function hideMomentumPanel()
{
  if (elements.dmMomentumWrap)
  {
    elements.dmMomentumWrap.classList.add("hidden");
  }

  syncDetailsPanelAvailability();
}

// /m/{courtId} is the only source of momentum data; the detailed score
// payload deliberately no longer carries the point-by-point streams.
async function fetchMomentumPayload(courtId)
{
  const url = "/momentum/" + encodeURIComponent(courtId);

  // if (location.hostname === "localhost" || location.hostname === "127.0.0.1") 
  // {
  //   let mockResponse = '{"success":true,"courtId":"bnrm","pointHistory":["A","B","B","A","A","B","B","A","B","A","B","A","B","B","B","B","A","A","A","B","A","B","A","B","B","B","A","A","A","A","A","A","A","A","B","B","A","B","B","B","A","A","A","B","A","B","B","B","B","A","A","B","A","A","B","B","B","A","A","B","B","B","B","B","B","B","B","A","A","A","A","B","A","B","B","B","B","B","B","B","B","A"],"momentumTimeline":[13.2,10.576421052631579,2.6529469005847943,3.6937700865497067,9.472143881356725,5.0371485818086565,-1.5589578841202714,2.134579588926944,-12.615717408630895,-10.440592545931223,-12.977793356811711,-10.344580300857555,-12.451178210078828,-18.413198426565007,-39.062951975516555,-49.482811220621926,-49.02293345647551,-44.77246653999607,-36.65884582032356,-38.71386052564961,-20.827392530474263,-20.995930796827626,-16.136174949017967,-16.14982263389507,-19.544469639497727,-38.817256006582404,-37.251857009823816,-32.39856377105256,-24.154649944789405,0.27644723371614255,15.2871331269659,34.44263241207522,53.75789264916889,85.62332818112783,86.48592849026015,82.60586368993543,83.43133005035749,78.31635933824512,56.853741414314044,44.96069874763701,41.06305682277879,40.78109159523025,44.1978624631528,37.72780889718181,51.4641403633509,47.39447375973166,40.187168970511394,30.1668479231898,4.5022915932529575,2.5957904612941443,4.185497579071041,-0.10199591203685787,0.8859420245035352,18.032785503033324,15.969000191033142,11.083587452298428,3.245844932433248,5.996548781941798,11.964028582298017,-3.444722223548954,-8.91076616286329,-17.29430201127331,-29.02028025423327,-76.45179071170654,-100,-100,-100,-100,-100,-99.72798181818182,-94.33675927272728,-100,-86.50025329090909,-88.7313751461818,-93.43560689395636,-100,-100,-100,-100,-100,-100,-100],"setPointMarkers":[64],"gameMarkers":[9,15,21,26,30,34,39,45,49,54,60,64,73,77,81],"totalPoints":82,"scoringMode":"standard","matchComplete":false,"fetchedAt":"2026-09-12T12:21:11.071Z"}';
  //   let data = JSON.parse(mockResponse);
  //   return data;
  // }

  const response = await fetch(url, { cache: "no-store" });

  let data = null;

  try
  {
    data = await response.json();
  }
  catch (_parseErr) { /* non-JSON body */ }

  if (!data)
  {
    // /momentum/ is a Firebase Hosting path that redirects to the Johannesburg function. Until it is deployed the request
    // falls through to index.html, so a "successful" HTML response here
    // means the endpoint is missing rather than the court being empty.
    throw new Error("No JSON from " + url + " (HTTP " + response.status +
      ") - the momentum endpoint is probably not deployed.");
  }

  if (!response.ok || data.success !== true)
  {
    throw new Error(data.error || "Could not load match momentum from " + url + ".");
  }

  return data;
}

// Runs alongside the match-details request rather than after it, so the set
// tables and stats paint without waiting on the momentum replay.
//
// The panel reveals itself only once a payload with actual points is in hand
// (renderMomentumGraph re-hides it for an empty timeline). Nothing is shown
// in the meantime: a "Match Momentum" heading over an empty box, or one that
// appears and then withdraws when the graph turns out to be empty, reads
// worse than the section simply not being there yet. A graph already on
// screen stays up untouched while a live refresh is in flight.
export async function loadMomentumGraph(courtId)
{
  if (!courtId || !elements.dmMomentumWrap)
  {
    return;
  }

  const token = ++session.momentumRequestToken;
  const cached = session.momentumCacheCourtId === courtId ? session.momentumCache : null;

  let payload = cached;

  if (!payload)
  {
    try
    {
      payload = await fetchMomentumPayload(courtId);
    }
    catch (err)
    {
      console.error("Match momentum could not be loaded:", err);

      if (token === session.momentumRequestToken)
      {
        hideMomentumPanel();
      }

      return;
    }

    session.momentumCache = payload;
    session.momentumCacheCourtId = courtId;
  }

  if (token !== session.momentumRequestToken)
  {
    return;
  }

  const colourA = getComputedStyle(document.body).getPropertyValue("--teamAcolour").trim();
  const colourB = getComputedStyle(document.body).getPropertyValue("--teamBcolour").trim();

  renderMomentumGraph(
    payload.pointHistory,
    colourA,
    colourB,
    payload.setPointMarkers || [],
    payload.momentumTimeline || null,
    payload.gameMarkers || []
  );
}

function renderMomentumGraph(pointHistory, colourA, colourB, setPointMarkers = [], momentumTimeline = null, gameMarkers = [])
{
  const wrap = elements.dmMomentumWrap;
  const canvas = elements.dmMomentumCanvas;

  // Need at least one scored point to draw a meaningful momentum line
  if (!pointHistory || pointHistory.length < 1)
  {
    wrap.classList.add("hidden");
    syncDetailsPanelAvailability();
    return;
  }

  wrap.classList.remove("hidden");
  syncDetailsPanelAvailability();

  const CANVAS_FALLBACK_WIDTH = 320;
  const FILL_OPACITY = "55"; // ~34% opacity for the area fill

  if (momentumPulseAnimationFrame)
  {
    cancelAnimationFrame(momentumPulseAnimationFrame);
    momentumPulseAnimationFrame = null;
  }

  // Defer drawing so the canvas has a settled layout width
  const drawGraphFrame = (timestamp) =>
  {
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.offsetWidth || canvas.parentElement.offsetWidth || CANVAS_FALLBACK_WIDTH;
    const cssH = 120;
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    canvas.style.height = cssH + "px";

    const ctx = canvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const W = cssW;
    const H = cssH;
    const padX = 8;
    const padY = 10;
    const midY = H / 2;
    const MOMENTUM_CLAMP_MIN = -100;
    const MOMENTUM_CLAMP_MAX = 100;

    //const axisColour = document.body.classList.contains("light-mode") ? "rgba(0,0,0,0.5)" : "rgba(255,255,255,0.5)";
    const axisColour = document.body.classList.contains("light-mode") ? "rgba(185,185,185,1)" : "rgba(125,125,125,1)";

    // Map index → x, value → y
    const toX = i => padX + (i / (values.length - 1)) * (W - padX * 2);
    const toY = v => midY - (v / maxVal) * (midY - padY);

    const hasLiveMomentum = Array.isArray(momentumTimeline) &&
      momentumTimeline.length > 0 &&
      momentumTimeline.length === pointHistory.length;
    const values = hasLiveMomentum
      ? [0, ...momentumTimeline.map((value) =>
      {
        const numeric = Number(value);
        const safeNumeric = Number.isFinite(numeric) ? numeric : 0;
        // Defensive clamp in case older clients/servers exchange out-of-range values.
        return Math.max(MOMENTUM_CLAMP_MIN, Math.min(MOMENTUM_CLAMP_MAX, safeNumeric));
      })]
      : (() =>
      {
        const cumulative = [0];
        for (const p of pointHistory)
          cumulative.push(cumulative[cumulative.length - 1] + (p === "A" ? 1 : -1));
        return cumulative;
      })();

    // --- Centre balanced line ---
    const drawCentreLine = false;
    if (drawCentreLine)
    {
      ctx.beginPath();
      ctx.moveTo(padX, midY);
      ctx.lineTo(W - padX, midY);
      ctx.strokeStyle = axisColour;
      ctx.lineWidth = 1;
      //ctx.setLineDash([4, 4]);
      ctx.stroke();
      //ctx.setLineDash([]);
    }

    // --- Set point markers ---
    const markerIndices = Array.isArray(setPointMarkers)
      ? [...new Set(setPointMarkers
        .filter((index) => Number.isInteger(index) && index > 0 && index < values.length))]
      : [];

    markerIndices.forEach((index) =>
    {
      const x = toX(index);
      ctx.beginPath();
      ctx.moveTo(x, padY - 4);
      ctx.lineTo(x, H - padY + 4);
      ctx.strokeStyle = axisColour;
      ctx.lineWidth = 1;
      ctx.stroke();
    });

    // --- Game point markers ---
    const completedGameMarkers = Array.isArray(gameMarkers)
      ? [...new Set(gameMarkers
        .filter((index) => Number.isInteger(index) && index > 0 && index < values.length))]
        .filter((index) => !markerIndices.includes(index))
      : [];

    completedGameMarkers.forEach((index) =>
    {
      const x = toX(index);
      const radius = 1;
      const shouldClipGameMarkers = false; // Set to false to show full circle for game markers;
      const momentum = values[index];

      ctx.save();

      if (shouldClipGameMarkers) 
      {
        if (momentum === 0) 
        {
          return;
        }

        ctx.beginPath();
        momentum > 0 ? 
        ctx.rect(x - radius - 1, midY, radius * 2 + 2, radius + 2) : 
        ctx.rect(x - radius - 1, midY - radius - 2, radius * 2 + 2, radius + 2);
        ctx.clip();
      }

      ctx.beginPath();
      ctx.arc(x, midY, radius, 0, Math.PI * 2);
      ctx.fillStyle = axisColour;
      ctx.strokeStyle = axisColour;
      ctx.lineWidth = 1;
      ctx.fill();
      ctx.stroke();

      ctx.restore();
    });

    // Smooth sharp directional changes so peaks/troughs render less jagged.
    const smoothedValues = values.map((v, i, arr) =>
    {
      if (i === 0 || i === arr.length - 1) return v;
      return (arr[i - 1] + arr[i] * 2 + arr[i + 1]) / 4;
    });

    const maxVal = hasLiveMomentum ? MOMENTUM_CLAMP_MAX : Math.max(...values.map(Math.abs), 1);

    const points = smoothedValues.map((v, i) => ({ x: toX(i), y: toY(v) }));

    const traceQuadraticPath = (target, pts, moveToStart = true) =>
    {
      if (!pts || pts.length === 0) return;

      if (moveToStart)
        target.moveTo(pts[0].x, pts[0].y);

      if (pts.length === 1) return;

      if (pts.length === 2)
      {
        target.lineTo(pts[1].x, pts[1].y);
        return;
      }

      for (let i = 1; i < pts.length - 1; i++)
      {
        const midX = (pts[i].x + pts[i + 1].x) / 2;
        const midY = (pts[i].y + pts[i + 1].y) / 2;
        target.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
      }

      const last = pts.length - 1;
      target.quadraticCurveTo(pts[last - 1].x, pts[last - 1].y, pts[last].x, pts[last].y);
    };

    // --- Background fill above midline (team A) ---
    const fillAbove = new Path2D();
    fillAbove.moveTo(points[0].x, midY);
    fillAbove.lineTo(points[0].x, points[0].y);
    traceQuadraticPath(fillAbove, points, false);
    fillAbove.lineTo(points[points.length - 1].x, midY);
    fillAbove.closePath();

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, midY);
    ctx.clip();
    ctx.fillStyle = colourA + FILL_OPACITY;
    ctx.fill(fillAbove);
    ctx.restore();

    // --- Background fill below midline (team B) ---
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, midY, W, H - midY);
    ctx.clip();
    ctx.fillStyle = colourB + FILL_OPACITY;
    ctx.fill(fillAbove);
    ctx.restore();

    ctx.lineWidth = 2; 

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, midY);
    ctx.clip();

    ctx.beginPath();
    traceQuadraticPath(ctx, points);
    ctx.strokeStyle = colourA;
    ctx.stroke();

    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, midY, W, H - midY);
    ctx.clip();

    ctx.beginPath();
    traceQuadraticPath(ctx, points);
    ctx.strokeStyle = colourB;
    ctx.stroke();

    ctx.restore();

    // --- End dot ---
    const finalMomentum = values[values.length - 1];
    const finalMomentumColour =
      finalMomentum > 0 ? colourA :
        finalMomentum < 0 ? colourB :
          "#ffffff"; 

    const lastX = points[points.length - 1].x;
    const lastY = points[points.length - 1].y;
    const pulseWave = (Math.sin((timestamp || performance.now()) / 320) + 1) / 2;
    const pulseRadius = 4.5 + pulseWave * 3.2;
    const pulseAlpha = 0.18 + pulseWave * 0.22;

    ctx.save();
    ctx.beginPath();
    ctx.arc(lastX, lastY, pulseRadius, 0, Math.PI * 2);
    ctx.strokeStyle = finalMomentumColour;
    ctx.lineWidth = 1.2;
    ctx.globalAlpha = pulseAlpha;
    ctx.stroke();
    ctx.restore();

    ctx.beginPath();
    ctx.arc(lastX, lastY, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = finalMomentumColour;
    ctx.fill();
    ctx.shadowBlur = 0;

    if (canvas.isConnected && !wrap.classList.contains("hidden"))
    {
      momentumPulseAnimationFrame = requestAnimationFrame(drawGraphFrame);
    }
  };

  momentumPulseAnimationFrame = requestAnimationFrame(drawGraphFrame);
}
