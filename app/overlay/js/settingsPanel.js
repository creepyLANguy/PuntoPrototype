      // ---------- Settings UI wiring ----------
      const fieldMap = {
        setPanel: "panel",
        setPanel2: "panel2",
        setText: "text",
        setTeamA: "teamA",
        setTeamB: "teamB",
        setNameA: "nameA",
        setNameB: "nameB",
        setPlayerA1: "playerA1",
        setPlayerA2: "playerA2",
        setPlayerB1: "playerB1",
        setPlayerB2: "playerB2",
        setLogoA: "logoA",
        setLogoB: "logoB",
        setBrandText: "brandText",
        setBrandLogo: "brandLogo",
        setSponsorHtml: "sponsorHtml",
        setQrUrl: "qrUrl",
        setQrLabel: "qrLabel"
      };

      const URL_KEYS = ["logoA", "logoB", "brandLogo", "qrUrl"];

      const checkboxMap = {
        setShowServer: "showServer",
        setShowBrand: "showBrand",
        setShowHeaders: "showHeaders",
        setShowTeamNames: "showTeamNames",
        setShowPlayerNames: "showPlayerNames",
        setShowTimer: "showTimer",
        setShowSponsor: "showSponsor",
        setShowWinMoments: "showWinMoments",
        setAutoStatCards: "autoStatCards",
        setAutoMomentumCards: "autoMomentumCards",
        setSlateOnSet: "sponsorSlateOnSet",
        setShowQr: "showQr"
      };

      const selectMap = {
        setPosition: "position",
        setLayout: "layout",
        setQrCorner: "qrCorner"
      };

      // Options are built from THEME_PRESETS so new presets only need a
      // single entry in that map.
      function buildThemeSelect() {
        const select = document.getElementById("setThemePreset");
        select.textContent = "";
        Object.entries(THEME_PRESETS).forEach(([value, preset]) => {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = preset.label;
          select.appendChild(option);
        });
      }

      function renderSponsorEditor() {
        const wrap = document.getElementById("sponsorList");
        wrap.textContent = "";

        (settings.sponsors || []).forEach((item, index) => {
          const row = document.createElement("div");
          row.className = "sponsor-edit-row";

          const text = document.createElement("input");
          text.type = "text";
          text.placeholder = "Text / HTML";
          text.value = item.text || "";
          text.addEventListener("input", () => {
            item.text = text.value;
            saveSettings();
            restartSponsorRotation();
          });

          const img = document.createElement("input");
          img.type = "url";
          img.placeholder = "Image URL";
          img.value = item.img || "";
          img.addEventListener("input", () => {
            item.img = img.value.trim();
            saveSettings();
            restartSponsorRotation();
          });

          const secs = document.createElement("input");
          secs.type = "text";
          secs.className = "secs";
          secs.title = "Seconds on screen";
          secs.value = item.seconds || 8;
          secs.addEventListener("input", () => {
            item.seconds = clampNumber(secs.value, 3, 600, 8);
            saveSettings();
          });

          const remove = document.createElement("button");
          remove.type = "button";
          remove.className = "rm";
          remove.title = "Remove sponsor";
          remove.textContent = "\u00d7";
          remove.addEventListener("click", () => {
            settings.sponsors.splice(index, 1);
            saveSettings();
            renderSponsorEditor();
            restartSponsorRotation();
          });

          row.append(text, img, secs, remove);
          wrap.appendChild(row);
        });
      }

      function syncInputsFromSettings() {
        Object.entries(fieldMap).forEach(([inputId, key]) => {
          document.getElementById(inputId).value = settings[key];
        });

        Object.entries(checkboxMap).forEach(([inputId, key]) => {
          document.getElementById(inputId).checked = settings[key] !== false;
        });

        Object.entries(selectMap).forEach(([inputId, key]) => {
          document.getElementById(inputId).value = settings[key];
        });

        document.getElementById("setThemePreset").value = settings.themePreset;
        document.getElementById("setTimerValue").value = settings.timerText || "";

        const angle = Number(settings.gradientAngle) || 0;
        document.getElementById("setGradAngle").value = angle;
        document.getElementById("gradAngleValue").textContent = angle + "\u00b0";

        const scale = clampNumber(settings.scale, 0.5, 2, 1);
        document.getElementById("setScale").value = scale;
        document.getElementById("scaleValue").textContent = Math.round(scale * 100) + "%";

        const slateScale = clampNumber(settings.slateScale, 0.5, 2, 1);
        document.getElementById("setSlateScale").value = slateScale;
        document.getElementById("slateScaleValue").textContent = Math.round(slateScale * 100) + "%";

        const statsScale = clampNumber(settings.statsScale, 0.5, 2, 1);
        document.getElementById("setStatsScale").value = statsScale;
        document.getElementById("statsScaleValue").textContent = Math.round(statsScale * 100) + "%";

        const statsWidth = clampNumber(settings.statsWidth, 0.5, 2, 1);
        document.getElementById("setStatsWidth").value = statsWidth;
        document.getElementById("statsWidthValue").textContent = Math.round(statsWidth * 100) + "%";

        const qbOpacity = clampNumber(settings.quickBarOpacity, 0.1, 1, 0.4);
        document.getElementById("setQuickBarOpacity").value = qbOpacity;
        document.getElementById("quickBarOpacityValue").textContent = Math.round(qbOpacity * 100) + "%";

        const qbScale = clampNumber(settings.quickBarScale, 0.5, 2, 1);
        document.getElementById("setQuickBarScale").value = qbScale;
        document.getElementById("quickBarScaleValue").textContent = Math.round(qbScale * 100) + "%";

        const qrSize = Math.round(clampNumber(settings.qrSize, 64, 200, 96));
        document.getElementById("setQrSize").value = qrSize;
        document.getElementById("qrSizeValue").textContent = qrSize + "px";

        renderSponsorEditor();
      }

      Object.entries(fieldMap).forEach(([inputId, key]) => {
        document.getElementById(inputId).addEventListener("input", (event) => {
          settings[key] = URL_KEYS.includes(key) ? event.target.value.trim() : event.target.value;
          if (THEME_COLOR_KEYS.includes(key)) {
            settings.themePreset = "custom";
            document.getElementById("setThemePreset").value = "custom";
          }
          saveSettings();
          applySettings();
        });
      });

      Object.entries(selectMap).forEach(([inputId, key]) => {
        document.getElementById(inputId).addEventListener("change", (event) => {
          settings[key] = event.target.value;
          saveSettings();
          applySettings();
        });
      });

      buildThemeSelect();
      document.getElementById("setThemePreset").addEventListener("change", (event) => {
        if (event.target.value !== "custom") {
          applyThemePreset(event.target.value);
        }
        else {
          settings.themePreset = "custom";
        }
        saveSettings();
        syncInputsFromSettings();
        applySettings();
      });

      document.getElementById("setScale").addEventListener("input", (event) => {
        settings.scale = clampNumber(event.target.value, 0.5, 2, 1);
        document.getElementById("scaleValue").textContent = Math.round(settings.scale * 100) + "%";
        saveSettings();
        applySettings();
      });

      document.getElementById("setSlateScale").addEventListener("input", (event) => {
        settings.slateScale = clampNumber(event.target.value, 0.5, 2, 1);
        document.getElementById("slateScaleValue").textContent = Math.round(settings.slateScale * 100) + "%";
        saveSettings();
        applySettings();
      });

      document.getElementById("setStatsScale").addEventListener("input", (event) => {
        settings.statsScale = clampNumber(event.target.value, 0.5, 2, 1);
        document.getElementById("statsScaleValue").textContent = Math.round(settings.statsScale * 100) + "%";
        saveSettings();
        applySettings();
      });

      document.getElementById("setStatsWidth").addEventListener("input", (event) => {
        settings.statsWidth = clampNumber(event.target.value, 0.5, 2, 1);
        document.getElementById("statsWidthValue").textContent = Math.round(settings.statsWidth * 100) + "%";
        saveSettings();
        applySettings();
      });

      document.getElementById("setQuickBarOpacity").addEventListener("input", (event) => {
        settings.quickBarOpacity = clampNumber(event.target.value, 0.1, 1, 0.4);
        document.getElementById("quickBarOpacityValue").textContent = Math.round(settings.quickBarOpacity * 100) + "%";
        saveSettings();
        applySettings();
      });

      document.getElementById("setQuickBarScale").addEventListener("input", (event) => {
        settings.quickBarScale = clampNumber(event.target.value, 0.5, 2, 1);
        document.getElementById("quickBarScaleValue").textContent = Math.round(settings.quickBarScale * 100) + "%";
        saveSettings();
        applySettings();
      });

      document.getElementById("setQrSize").addEventListener("input", (event) => {
        settings.qrSize = clampNumber(event.target.value, 64, 200, 96);
        document.getElementById("qrSizeValue").textContent = Math.round(settings.qrSize) + "px";
        saveSettings();
        renderQrBug();
      });

      document.getElementById("addSponsorBtn").addEventListener("click", () => {
        if (!Array.isArray(settings.sponsors)) settings.sponsors = [];
        settings.sponsors.push({ text: "", img: "", seconds: 8 });
        saveSettings();
        renderSponsorEditor();
      });

      document.getElementById("copyObsUrl").addEventListener("click", async (event) => {
        const url = buildShareUrl();
        const field = document.getElementById("shareUrlField");
        field.value = url;

        let copied = false;
        try {
          await navigator.clipboard.writeText(url);
          copied = true;
        }
        catch (_err) {
          // Clipboard API is unavailable in some embedded browsers (OBS);
          // fall back to selecting the visible field for a manual copy.
          field.focus();
          field.select();
          try { copied = document.execCommand("copy"); }
          catch (_execErr) { /* manual copy it is */ }
        }

        const button = event.srcElement;
        button.textContent = copied ? "Copied \u2713" : "Copy from the field below";
        setTimeout(() => { button.textContent = "Copy OBS URL"; }, 2000);
      });

      document.getElementById("statBtn").addEventListener("click", () => {
        if (statCardPinned) {
          hideStatCard();
        }
        else {
          void showStatCard({ pin: true });
        }
      });

      document.getElementById("momentumBtn").addEventListener("click", () => {
        if (momentumCardPinned) {
          hideMomentumCard();
        }
        else {
          void showMomentumCard({ pin: true });
        }
      });

      document.getElementById("slateBtn").addEventListener("click", () => {
        showSponsorSlate(8000);
      });

      Object.entries(checkboxMap).forEach(([inputId, key]) => {
        document.getElementById(inputId).addEventListener("change", (event) => {
          settings[key] = event.target.checked;
          saveSettings();
          applySettings();
        });
      });

      document.getElementById("setGradAngle").addEventListener("input", (event) => {
        settings.gradientAngle = Number(event.target.value) || 0;
        document.getElementById("gradAngleValue").textContent = settings.gradientAngle + "\u00b0";
        saveSettings();
        applySettings();
      });

      document.getElementById("setTimerValue").addEventListener("change", (event) => {
        settings.timerText = event.target.value.trim();
        settings.timerOffset = parseTimerInput(settings.timerText);
        settings.timerAnchor = Date.now();
        saveSettings();
        tickTimer();
      });

      const gearBtn = document.getElementById("gearBtn");
      const settingsPanel = document.getElementById("settingsPanel");

      gearBtn.addEventListener("click", () => {
        settingsPanel.classList.toggle("open");
      });

      ["closeSettings", "closeSettingsX"].forEach((id) => {
        document.getElementById(id).addEventListener("click", () => {
          settingsPanel.classList.remove("open");
        });
      });

      document.getElementById("resetSettings").addEventListener("click", () => {
        // Drop the stored blob entirely so stale keys from older versions
        // cannot survive a reset, then restart the timer from zero.
        try {
          localStorage.removeItem(storageKey);
        }
        catch (_err) { /* storage unavailable */ }

        settings = { ...DEFAULT_SETTINGS, timerAnchor: Date.now() };
        normalizeSettings();
        saveSettings();
        hideStatCard();
        hideMomentumCard();
        document.getElementById("shareUrlField").value = "";
        syncInputsFromSettings();
        applySettings();
      });

