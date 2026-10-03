      // Compact and ticker layouts trade the header/player detail for a slim
      // footprint regardless of the individual display toggles.
      function isSlimLayout() {
        return settings.layout === "compact" || settings.layout === "ticker";
      }

      function applyDragPosition(el, pos) {
        if (!el) return;
        if (pos && typeof pos.x === "number" && typeof pos.y === "number") {
          el.style.left = pos.x + "px";
          el.style.top = pos.y + "px";
          el.style.right = "auto";
          el.style.bottom = "auto";
          el.style.transform = "none";
        }
        else {
          el.style.left = "";
          el.style.top = "";
          el.style.right = "";
          el.style.bottom = "";
          el.style.transform = "";
        }
      }

      function applySettings() {
        const root = document.documentElement.style;
        root.setProperty("--ov-panel", hexToPanelRgba(settings.panel));
        root.setProperty("--ov-panel-2", hexToPanelRgba(settings.panel2));
        root.setProperty("--ov-grad-angle", (Number(settings.gradientAngle) || 0) + "deg");
        root.setProperty("--ov-text", settings.text);
        root.setProperty("--ov-teamA", settings.teamA);
        root.setProperty("--ov-teamB", settings.teamB);
        root.setProperty("--ov-scale", String(clampNumber(settings.scale, 0.5, 2, 1)));
        root.setProperty("--ov-slate-scale", String(clampNumber(settings.slateScale, 0.5, 2, 1)));
        root.setProperty("--ov-stats-scale", String(clampNumber(settings.statsScale, 0.5, 2, 1)));
        root.setProperty("--ov-stats-width", String(clampNumber(settings.statsWidth, 0.5, 2, 1)));
        root.setProperty("--ov-quickbar-opacity", String(clampNumber(settings.quickBarOpacity, 0.1, 1, 0.4)));
        root.setProperty("--ov-quickbar-scale", String(clampNumber(settings.quickBarScale, 0.5, 2, 1)));

        const anchor = document.getElementById("overlayAnchor");
        anchor.className = "overlay-anchor pos-" + settings.position +
          (settings.layout !== "panel" ? " layout-" + settings.layout : "");

        applyDragPosition(document.getElementById("overlayAnchor"), settings.dragOverlay);
        applyDragPosition(document.getElementById("sponsorSlate"), settings.dragSlate);
        applyDragPosition(document.getElementById("qrBug"), settings.dragQr);
        applyDragPosition(document.getElementById("quickBar"), settings.dragQuickBar);
        applyDragPosition(document.getElementById("settingsPanel"), settings.dragSettings);
        applyDragPosition(document.getElementById("momentumCard"), settings.dragMomentum);

        applyLogo("logoA", settings.logoA);
        applyLogo("logoB", settings.logoB);
        applyBrand();

        const overlayBox = document.getElementById("overlayBox");
        overlayBox.classList.toggle("no-brand", settings.showBrand === false || isSlimLayout());
        overlayBox.classList.toggle("no-headers", settings.showHeaders === false || isSlimLayout());

        tickTimer();
        updateSponsor();
        renderQrBug();

        if (latestScore) {
          render(latestScore);
        }
        else {
          syncNameColumn();
        }
      }

      function safeHttpUrl(url) {
        if (!url) return "";
        try {
          const parsed = new URL(url, window.location.origin);
          if (parsed.protocol === "https:" || parsed.protocol === "http:") {
            return parsed.href;
          }
        }
        catch (_err) { /* invalid URL */ }
        return "";
      }

      function applyBrand() {
        document.getElementById("brandName").textContent = settings.brandText || "Padel Push™";
        document.getElementById("brandLogo").src = safeHttpUrl(settings.brandLogo) || "/media/logo.svg";
      }

      // ---------- Match timer ----------

      function formatTimer(totalSeconds) {
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        const mm = String(minutes).padStart(2, "0");
        const ss = String(seconds).padStart(2, "0");
        return hours > 0 ? hours + ":" + mm + ":" + ss : mm + ":" + ss;
      }

      // Accepts "h:mm:ss", "mm:ss" or a plain number of minutes; returns seconds.
      function parseTimerInput(raw) {
        const value = (raw || "").trim();
        if (!value) return 0;
        if (/^\d+$/.test(value)) return parseInt(value, 10) * 60;

        const parts = value.split(":").map((part) => part.trim());
        if (parts.length < 2 || parts.length > 3 || parts.some((part) => !/^\d+$/.test(part))) {
          return 0;
        }

        return parts.reduce((total, part) => total * 60 + parseInt(part, 10), 0);
      }

      function tickTimer() {
        const el = document.getElementById("matchTimer");
        if (settings.showTimer === false) {
          el.style.display = "none";
          return;
        }

        el.style.display = "";
        const anchor = settings.timerAnchor || Date.now();
        const offset = Number(settings.timerOffset) || 0;
        const elapsed = Math.max(0, Math.floor((Date.now() - anchor) / 1000) + offset);
        el.textContent = formatTimer(elapsed);
      }

      // ---------- Sponsor strip & rotation ----------

      let sponsorRotationTimer = null;
      let sponsorIndex = 0;

      function activeSponsors() {
        return (Array.isArray(settings.sponsors) ? settings.sponsors : [])
          .filter((item) => item && ((item.text && item.text.trim()) || safeHttpUrl(item.img)));
      }

      function sponsorItemHtml(item) {
        const imgUrl = safeHttpUrl(item.img);
        const img = imgUrl ? '<img src="' + imgUrl.replace(/"/g, "&quot;") + '" alt="" /> ' : "";
        return img + (item.text || "");
      }

      function defaultSponsorHtml() {
        const displayCourtId = ((latestScore && latestScore.courtId) || courtId || "").toUpperCase();
        return (settings.sponsorHtml || DEFAULT_SPONSOR_HTML).split("{courtId}").join(displayCourtId);
      }

      function currentSponsorHtml() {
        const list = activeSponsors();
        if (!list.length) {
          return defaultSponsorHtml();
        }

        sponsorIndex = sponsorIndex % list.length;
        return sponsorItemHtml(list[sponsorIndex]);
      }

      function updateSponsor() {
        const strip = document.getElementById("sponsorStrip");
        const show = settings.showSponsor !== false;
        strip.classList.toggle("hidden", !show);
        if (!show) {
          clearTimeout(sponsorRotationTimer);
          sponsorRotationTimer = null;
          return;
        }

        const html = currentSponsorHtml();

        if (html !== lastSponsorHtml) {
          lastSponsorHtml = html;
          document.getElementById("sponsorItemA").innerHTML = html;
          document.getElementById("sponsorItemB").innerHTML = html;

          // Images load async and change the strip's width — re-measure as they arrive.
          document.querySelectorAll("#sponsorItemA img").forEach((img) => {
            img.addEventListener("load", measureSponsor, { once: true });
          });
        }

        measureSponsor();
        scheduleSponsorRotation();
      }

      function scheduleSponsorRotation() {
        const list = activeSponsors();
        if (settings.showSponsor === false || list.length < 2) {
          clearTimeout(sponsorRotationTimer);
          sponsorRotationTimer = null;
          return;
        }

        if (sponsorRotationTimer) return;

        const dwellMs = clampNumber(list[sponsorIndex % list.length].seconds, 3, 600, 8) * 1000;
        sponsorRotationTimer = setTimeout(() => {
          const track = document.getElementById("sponsorTrack");
          track.classList.add("fading");

          setTimeout(() => {
            sponsorIndex = (sponsorIndex + 1) % Math.max(activeSponsors().length, 1);
            sponsorRotationTimer = null;
            updateSponsor();
            track.classList.remove("fading");
          }, 300);
        }, dwellMs);
      }

      // Settings edits can change the list or dwell times mid-cycle; drop the
      // pending timer so the next updateSponsor() reschedules from scratch.
      function restartSponsorRotation() {
        clearTimeout(sponsorRotationTimer);
        sponsorRotationTimer = null;
        updateSponsor();
      }

      // ---------- Sponsor slate (lower-third interstitial) ----------

      let slateTimer = null;
      let slateIndex = 0;

      function showSponsorSlate(durationMs) {
        const slate = document.getElementById("sponsorSlate");
        const body = document.getElementById("slateBody");
        const list = activeSponsors();

        if (list.length) {
          slateIndex = slateIndex % list.length;
          body.innerHTML = sponsorItemHtml(list[slateIndex]);
          slateIndex++;
        }
        else {
          body.innerHTML = defaultSponsorHtml();
        }

        slate.classList.add("show");
        clearTimeout(slateTimer);
        slateTimer = setTimeout(() => slate.classList.remove("show"), durationMs || 8000);
      }

      // ---------- QR corner bug ----------

      let lastQrKey = null;

      function renderQrBug() {
        const bug = document.getElementById("qrBug");
        const show = settings.showQr === true && Boolean(window.QRCode);
        const corner = POSITIONS.includes(settings.qrCorner) ? settings.qrCorner : "br";
        bug.className = "qr-bug qr-" + corner + (show ? "" : " hidden");
        if (!show) return;

        document.getElementById("qrBugLabel").textContent = settings.qrLabel || "";

        const text = safeHttpUrl(settings.qrUrl) ||
          window.location.origin + "/c/" + encodeURIComponent(courtId || "");
        const size = Math.round(clampNumber(settings.qrSize, 64, 200, 96));
        const key = text + "|" + size;
        if (key === lastQrKey) return;
        lastQrKey = key;

        const mount = document.getElementById("qrBugCode");
        mount.innerHTML = "";
        new window.QRCode(mount, {
          text,
          width: size,
          height: size,
          colorDark: "#000000",
          colorLight: "#ffffff",
          correctLevel: window.QRCode.CorrectLevel.H
        });
      }

      function measureSponsor() {
        const strip = document.getElementById("sponsorStrip");
        if (strip.classList.contains("hidden")) return;

        const track = document.getElementById("sponsorTrack");
        const itemA = document.getElementById("sponsorItemA");
        const itemB = document.getElementById("sponsorItemB");
        const overflows = itemA.scrollWidth > strip.clientWidth + 1;

        // The second (duplicate) item only exists to make the loop seamless.
        itemB.style.display = overflows ? "" : "none";
        track.classList.toggle("scrolling", overflows);
        track.style.setProperty("--sponsor-duration", Math.max(8, Math.round(itemA.scrollWidth / 30)) + "s");
      }

