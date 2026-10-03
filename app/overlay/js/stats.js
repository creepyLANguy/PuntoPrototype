      // ---------- Stat cards ----------

      let statsCache = null;
      let statsCacheAt = 0;
      let momentumCache = null;
      let momentumCacheAt = 0;
      let statCardPinned = false;
      let statCardTimer = null;
      let statRefreshTimer = null;
      let momentumPulseAnimationFrame = null;

      async function fetchStats(force) {
        if (!isDebugCourt && !courtId) {
          throw new Error("No court specified.");
        }

        if (!force && statsCache && Date.now() - statsCacheAt < 8000) {
          return statsCache;
        }

        const url = isDebugCourt ? debugCourt_statsUrl : "/stats/" + encodeURIComponent(courtId);
        const data = await fetchJson(url);
        statsCache = data;
        statsCacheAt = Date.now();
        return data;
      }

      // The point-by-point momentum streams come from /momentum/{courtId} and nowhere
      // else, so this is the momentum card's only data source.
      async function fetchMomentum(force) {
        if (!isDebugCourt && !courtId) {
          throw new Error("No court specified.");
        }

        if (!force && momentumCache && Date.now() - momentumCacheAt < 8000) {
          return momentumCache;
        }

        const url = isDebugCourt ? debugCourt_momentumUrl : "/momentum/" + encodeURIComponent(courtId);
        const data = await fetchJson(url);
        momentumCache = data;
        momentumCacheAt = Date.now();
        return data;
      }

      function teamDisplayName(team) {
        return settings["name" + team] ||
          (latestScore && latestScore.teamNames && latestScore.teamNames[team]) ||
          ("Team " + team);
      }

      function statRowHtml(label, valueA, valueB, weightA, weightB) {
        const total = (Number(weightA) || 0) + (Number(weightB) || 0);
        const pctA = total > 0 ? Math.round((weightA / total) * 98) : 49;
        const pctB = total > 0 ? 98 - pctA : 49;
        return '<div class="stat-row">' +
          '<div class="stat-vals"><span class="va">' + valueA + '</span>' +
          '<span class="stat-label">' + label + '</span>' +
          '<span class="vb">' + valueB + '</span></div>' +
          '<div class="stat-bar"><i class="ba" style="width:' + pctA + '%"></i>' +
          '<i class="bb" style="width:' + pctB + '%"></i></div>' +
          '</div>';
      }

      function renderMomentumGraph(data) {
        const canvas = document.getElementById("momentumCanvas");
        if (!canvas) return;

        if (momentumPulseAnimationFrame) {
          cancelAnimationFrame(momentumPulseAnimationFrame);
          momentumPulseAnimationFrame = null;
        }

        const subEl = document.getElementById("momentumSub");
        if (subEl) {
          subEl.textContent = teamDisplayName("A") + " vs " + teamDisplayName("B");
        }

        const colourA = settings.teamA || "#b7f000";
        const colourB = settings.teamB || "#27d9ff";
        const setPointMarkers = data?.setPointMarkers || [];
        const momentumTimeline = data?.momentumTimeline || null;
        const gameMarkers = data?.gameMarkers || [];
        const pointHistory = data?.pointHistory || [];

        const CANVAS_FALLBACK_WIDTH = 300;
        const CANVAS_FALLBACK_HEIGHT = 90;
        const FILL_OPACITY = "55";

        const MOMENTUM_CLAMP_MIN = -100;
        const MOMENTUM_CLAMP_MAX = 100;

        const hasLiveMomentum = Array.isArray(momentumTimeline) &&
          momentumTimeline.length > 0 &&
          momentumTimeline.length === pointHistory.length;

        const values = (pointHistory && pointHistory.length > 0)
          ? (hasLiveMomentum
            ? [0, ...momentumTimeline.map((value) => {
              const numeric = Number(value);
              const safeNumeric = Number.isFinite(numeric) ? numeric : 0;
              return Math.max(MOMENTUM_CLAMP_MIN, Math.min(MOMENTUM_CLAMP_MAX, safeNumeric));
            })]
            : (() => {
              const cumulative = [0];
              for (const p of pointHistory)
                cumulative.push(cumulative[cumulative.length - 1] + (p === "A" ? 1 : -1));
              return cumulative;
            })())
          : [0, 0];

        const smoothedValues = values.map((v, i, arr) => {
          if (i === 0 || i === arr.length - 1) return v;
          return (arr[i - 1] + arr[i] * 2 + arr[i + 1]) / 4;
        });

        const maxVal = hasLiveMomentum ? MOMENTUM_CLAMP_MAX : Math.max(...values.map(Math.abs), 1);

        const drawGraphFrame = (timestamp) => {
          if (!canvas.isConnected || canvas.classList.contains("hidden") || canvas.parentElement?.classList.contains("hidden")) return;

          const dpr = window.devicePixelRatio || 1;
          const cssW = canvas.offsetWidth || canvas.parentElement?.offsetWidth || CANVAS_FALLBACK_WIDTH;
          const cssH = canvas.offsetHeight || CANVAS_FALLBACK_HEIGHT;
          canvas.width = cssW * dpr;
          // Only the backing store is set here - the CSS height is in em so it
          // tracks the scale slider, and an inline px height would freeze it.
          canvas.height = cssH * dpr;

          const ctx = canvas.getContext("2d");
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

          const W = cssW;
          const H = cssH;
          const padX = 8;
          const padY = 8;
          const midY = H / 2;
          const axisColour = "rgba(255, 255, 255, 0.25)";

          // Baseline
          ctx.beginPath();
          ctx.moveTo(padX, midY);
          ctx.lineTo(W - padX, midY);
          ctx.strokeStyle = axisColour;
          ctx.lineWidth = 1;
          ctx.stroke();

          const toX = (i) => padX + (i / Math.max(values.length - 1, 1)) * (W - padX * 2);
          const toY = (v) => midY - (v / maxVal) * (midY - padY);

          // Set point markers
          const markerIndices = Array.isArray(setPointMarkers)
            ? [...new Set(setPointMarkers.filter((idx) => Number.isInteger(idx) && idx > 0 && idx < values.length))]
            : [];

          markerIndices.forEach((index) => {
            const x = toX(index);
            ctx.beginPath();
            ctx.moveTo(x, padY - 2);
            ctx.lineTo(x, H - padY + 2);
            ctx.strokeStyle = axisColour;
            ctx.lineWidth = 1;
            ctx.stroke();
          });

          // Game markers
          const completedGameMarkers = Array.isArray(gameMarkers)
            ? [...new Set(gameMarkers.filter((idx) => Number.isInteger(idx) && idx > 0 && idx < values.length))]
              .filter((idx) => !markerIndices.includes(idx))
            : [];

          completedGameMarkers.forEach((index) => {
            const x = toX(index);
            const radius = 1.5;
            ctx.beginPath();
            ctx.arc(x, midY, radius, 0, Math.PI * 2);
            ctx.fillStyle = axisColour;
            ctx.fill();
          });

          const points = smoothedValues.map((v, i) => ({ x: toX(i), y: toY(v) }));

          const traceQuadraticPath = (target, pts, moveToStart = true) => {
            if (!pts || pts.length === 0) return;
            if (moveToStart) target.moveTo(pts[0].x, pts[0].y);
            if (pts.length === 1) return;
            if (pts.length === 2) {
              target.lineTo(pts[1].x, pts[1].y);
              return;
            }
            for (let i = 1; i < pts.length - 1; i++) {
              const mx = (pts[i].x + pts[i + 1].x) / 2;
              const my = (pts[i].y + pts[i + 1].y) / 2;
              target.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
            }
            const last = pts.length - 1;
            target.quadraticCurveTo(pts[last - 1].x, pts[last - 1].y, pts[last].x, pts[last].y);
          };

          if (pointHistory.length > 0) {
            // Fill above (Team A)
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

            // Fill below (Team B)
            ctx.save();
            ctx.beginPath();
            ctx.rect(0, midY, W, H - midY);
            ctx.clip();
            ctx.fillStyle = colourB + FILL_OPACITY;
            ctx.fill(fillAbove);
            ctx.restore();

            // Stroke Team A
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

            // Stroke Team B
            ctx.save();
            ctx.beginPath();
            ctx.rect(0, midY, W, H - midY);
            ctx.clip();
            ctx.beginPath();
            traceQuadraticPath(ctx, points);
            ctx.strokeStyle = colourB;
            ctx.stroke();
            ctx.restore();

            // Pulsing end dot
            const finalMomentum = values[values.length - 1];
            const finalColour = finalMomentum > 0 ? colourA : (finalMomentum < 0 ? colourB : "#ffffff");
            const lastPt = points[points.length - 1];
            const pulseWave = (Math.sin((timestamp || performance.now()) / 320) + 1) / 2;
            const pulseRadius = 3.5 + pulseWave * 2.5;
            const pulseAlpha = 0.18 + pulseWave * 0.22;

            ctx.save();
            ctx.beginPath();
            ctx.arc(lastPt.x, lastPt.y, pulseRadius, 0, Math.PI * 2);
            ctx.strokeStyle = finalColour;
            ctx.lineWidth = 1.2;
            ctx.globalAlpha = pulseAlpha;
            ctx.stroke();
            ctx.restore();

            ctx.beginPath();
            ctx.arc(lastPt.x, lastPt.y, 2.8, 0, Math.PI * 2);
            ctx.fillStyle = finalColour;
            ctx.fill();
          }
          else {
            ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
            ctx.font = "600 11px system-ui, sans-serif";
            ctx.textAlign = "center";
            ctx.fillText("No point history recorded yet", W / 2, midY - 8);
          }

          if (canvas.isConnected && !canvas.parentElement?.classList.contains("hidden")) {
            momentumPulseAnimationFrame = requestAnimationFrame(drawGraphFrame);
          }
        };

        momentumPulseAnimationFrame = requestAnimationFrame(drawGraphFrame);
      }

      // Only fixed labels and numbers derived from the payload go through
      // innerHTML here; anything user-editable (team names) uses textContent.
      function renderStatCard(data) {
        const stats = (data && data.advancedStats) || {};
        const teams = stats.teamStats || { A: {}, B: {} };
        const serve = stats.servePlayerStats || {};
        const match = stats.matchStats || {};
        const rowsEl = document.getElementById("statRows");
        const subEl = document.getElementById("statSub");

        subEl.textContent = teamDisplayName("A") + " vs " + teamDisplayName("B");

        if (!match.totalPoints) {
          rowsEl.innerHTML = '<div class="stat-empty">No points played yet.</div>';
          return;
        }

        const rows = [];
        const pointsA = Number(teams.A.pointsWon) || 0;
        const pointsB = Number(teams.B.pointsWon) || 0;
        rows.push(statRowHtml("Points won", pointsA, pointsB, pointsA, pointsB));

        const servedA = (Number(serve.A1?.pointsServed) || 0) + (Number(serve.A2?.pointsServed) || 0);
        const servedB = (Number(serve.B1?.pointsServed) || 0) + (Number(serve.B2?.pointsServed) || 0);
        const serveWonA = (Number(serve.A1?.pointsWonOnServe) || 0) + (Number(serve.A2?.pointsWonOnServe) || 0);
        const serveWonB = (Number(serve.B1?.pointsWonOnServe) || 0) + (Number(serve.B2?.pointsWonOnServe) || 0);
        if (servedA || servedB) {
          const pctA = servedA ? Math.round((serveWonA / servedA) * 100) + "%" : "–";
          const pctB = servedB ? Math.round((serveWonB / servedB) * 100) + "%" : "–";
          rows.push(statRowHtml("Won on serve", pctA, pctB,
            servedA ? serveWonA / servedA : 0, servedB ? serveWonB / servedB : 0));
        }

        const bpOppA = Number(teams.A.breakPointConversionOpportunities) || 0;
        const bpOppB = Number(teams.B.breakPointConversionOpportunities) || 0;
        if (bpOppA || bpOppB) {
          const bpWonA = Number(teams.A.breakPointConversions) || 0;
          const bpWonB = Number(teams.B.breakPointConversions) || 0;
          rows.push(statRowHtml("Break points", bpWonA + "/" + bpOppA, bpWonB + "/" + bpOppB, bpWonA, bpWonB));
        }

        const streakA = Number(teams.A.longestScoringStreak) || 0;
        const streakB = Number(teams.B.longestScoringStreak) || 0;
        if (streakA > 1 || streakB > 1) {
          rows.push(statRowHtml("Longest streak", streakA, streakB, streakA, streakB));
        }

        if (Number(match.goldenPointsPlayed) > 0) {
          const goldA = Number(teams.A.goldenPointsWon) || 0;
          const goldB = Number(teams.B.goldenPointsWon) || 0;
          rows.push(statRowHtml("Golden points", goldA, goldB, goldA, goldB));
        }

        if (Number(match.deuceGames) > 0) {
          const deuceA = Number(teams.A.gamesWonAfterDeuce) || 0;
          const deuceB = Number(teams.B.gamesWonAfterDeuce) || 0;
          rows.push(statRowHtml("Deuce games won", deuceA, deuceB, deuceA, deuceB));
        }

        rowsEl.innerHTML = rows.join("");
      }

      async function showStatCard(options) {
        const { durationMs = null, pin = false } = options || {};
        const card = document.getElementById("statCard");
        card.classList.remove("hidden");

        if (!statsCache) {
          document.getElementById("statRows").innerHTML = '<div class="stat-empty">Loading stats…</div>';
        }

        try {
          renderStatCard(await fetchStats(true));
        }
        catch (_err) {
          if (statsCache) {
            renderStatCard(statsCache);
          }
          else {
            document.getElementById("statRows").innerHTML = '<div class="stat-empty">Stats unavailable.</div>';
          }
        }

        clearTimeout(statCardTimer);
        if (pin) {
          statCardPinned = true;
          document.getElementById("statBtn").classList.add("active");
          clearInterval(statRefreshTimer);
          statRefreshTimer = setInterval(async () => {
            try { renderStatCard(await fetchStats(true)); }
            catch (_err) { /* keep the last rendered stats */ }
          }, 15000);
        }
        else if (durationMs) {
          statCardTimer = setTimeout(() => {
            if (!statCardPinned) hideStatCard();
          }, durationMs);
        }
      }

      function hideStatCard() {
        document.getElementById("statCard").classList.add("hidden");
        document.getElementById("statBtn").classList.remove("active");
        statCardPinned = false;
        clearTimeout(statCardTimer);
        clearInterval(statRefreshTimer);
        statRefreshTimer = null;
      }

      // ---------- Momentum card ----------

      let momentumCardTimer = null;
      let momentumRefreshTimer = null;
      let momentumCardPinned = false;

      // Three mutually exclusive states for the card body: the loader, a short
      // message, or the graph. A card that silently empties itself is
      // indistinguishable from a broken feed, so a failure always says so.
      function setMomentumState(state, message) {
        document.getElementById("momentumLoading").classList.toggle("hidden", state !== "loading");
        document.getElementById("momentumCanvas").classList.toggle("hidden", state !== "graph");

        const messageEl = document.getElementById("momentumMessage");
        messageEl.classList.toggle("hidden", state !== "message");
        messageEl.textContent = state === "message" ? (message || "") : "";
      }

      async function showMomentumCard(options) {
        const { durationMs = null, pin = false } = options || {};
        const card = document.getElementById("momentumCard");
        const subEl = document.getElementById("momentumSub");
        if (subEl) subEl.textContent = teamDisplayName("A") + " vs " + teamDisplayName("B");

        // Put the card on screen before the request goes out: replaying the
        // event stream is the slowest call the overlay makes, and a card that
        // only appears seconds after its trigger reads as a broken source. A
        // graph that is already drawn stays up while the refresh lands.
        card.classList.remove("hidden");
        if (momentumCache === null) {
          setMomentumState("loading");
        }

        let momentum = null;
        try {
          momentum = await fetchMomentum(true);
        }
        catch (err) {
          console.error("Momentum could not be loaded:", err);
          momentum = momentumCache;
        }

        if (momentum) {
          setMomentumState("graph");
          renderMomentumGraph(momentum);
        }
        else {
          setMomentumState("message", "Momentum unavailable.");
        }

        // The pin and auto-hide timers are set either way: an auto-shown card
        // that failed to load still has to take itself off screen.
        clearTimeout(momentumCardTimer);
        if (pin) {
          momentumCardPinned = true;
          document.getElementById("momentumBtn").classList.add("active");
          clearInterval(momentumRefreshTimer);
          momentumRefreshTimer = setInterval(async () => {
            try { renderMomentumGraph(await fetchMomentum(true)); }
            catch (_err) { /* keep last rendered */ }
          }, 15000);
        }
        else if (durationMs) {
          momentumCardTimer = setTimeout(() => {
            if (!momentumCardPinned) hideMomentumCard();
          }, durationMs);
        }
      }

      function hideMomentumCard() {
        document.getElementById("momentumCard").classList.add("hidden");
        document.getElementById("momentumBtn").classList.remove("active");
        momentumCardPinned = false;
        clearTimeout(momentumCardTimer);
        clearInterval(momentumRefreshTimer);
        momentumRefreshTimer = null;
        if (momentumPulseAnimationFrame) {
          cancelAnimationFrame(momentumPulseAnimationFrame);
          momentumPulseAnimationFrame = null;
        }
      }

