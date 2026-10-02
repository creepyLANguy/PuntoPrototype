      // ---------- Boot ----------
      loadSettings();
      applyUrlOverrides();
      normalizeSettings();

      // Anchor the timer on first ever load so it survives OBS source refreshes.
      if (!settings.timerAnchor) {
        settings.timerAnchor = Date.now();
        saveSettings();
      }

      makeDraggable("overlayAnchor", "dragOverlay");
      makeDraggable("sponsorSlate", "dragSlate");
      makeDraggable("qrBug", "dragQr");
      makeDraggable("quickBar", "dragQuickBar", null, true);
      makeDraggable("settingsPanel", "dragSettings", ".settings-head");
      makeDraggable("momentumCard", "dragMomentum", null, true);

      syncInputsFromSettings();
      applySettings();
      setInterval(tickTimer, 1000);
      window.addEventListener("resize", () => {
        syncNameColumn();
        measureSponsor();
      });
      void poll();
      setInterval(poll, POLL_INTERVAL_MS);
