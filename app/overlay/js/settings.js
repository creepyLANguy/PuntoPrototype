      //AL.
      const isDebugCourt = location.hostname === "localhost" || location.hostname === "127.0.0.1";
      const debugCourt_revisionUrl = "https://qa.padelpush.co.za/revision/bnrm";
      const debugCourt_fullScoreUrl = "https://qa.padelpush.co.za/score/bnrm";
      const debugCourt_statsUrl = "https://qa.padelpush.co.za/stats/bnrm";
      const debugCourt_momentumUrl = "https://qa.padelpush.co.za/momentum/bnrm";
      const debugCourt_id = "bnrm";
      //

      const POLL_INTERVAL_MS = 2 * 1000;

      const DEFAULT_SETTINGS = {
        showServer: true,
        showBrand: true,
        showHeaders: true,
        showTeamNames: true,
        showPlayerNames: true,
        showTimer: true,
        showSponsor: true,
        showWinMoments: true,
        autoStatCards: true,
        autoMomentumCards: false,
        sponsorSlateOnSet: false,
        showQr: false,
        position: "tl",
        layout: "panel",
        scale: 1,
        slateScale: 1,
        statsScale: 1,
        statsWidth: 1,
        quickBarOpacity: 0.4,
        quickBarScale: 1,
        dragOverlay: null,
        dragSlate: null,
        dragQr: null,
        dragQuickBar: null,
        dragSettings: null,
        dragMomentum: null,
        themePreset: "padelpush",
        panel: "#000000",
        panel2: "#00002d",
        gradientAngle: 90,
        text: "#ffffff",
        teamA: "#b7f000",
        teamB: "#27d9ff",
        nameA: "",
        nameB: "",
        playerA1: "",
        playerA2: "",
        playerB1: "",
        playerB2: "",
        logoA: "",
        logoB: "",
        brandText: "",
        brandLogo: "",
        sponsorHtml: "",
        sponsors: [],
        qrUrl: "",
        qrLabel: "Scan for live scores",
        qrCorner: "br",
        qrSize: 96,
        timerText: "",
        timerOffset: 0,
        timerAnchor: 0
      };

      // Colour keys a theme preset controls; touching any of them by hand
      // flips the preset selector to "custom".
      const THEME_COLOR_KEYS = ["panel", "panel2", "gradientAngle", "text", "teamA", "teamB"];

      const THEME_PRESETS = {
        padelpush: { label: "Padel Push™", panel: "#000000", panel2: "#00002d", gradientAngle: 90, text: "#ffffff", teamA: "#b7f000", teamB: "#27d9ff" },
        broadcast: { label: "Broadcast Navy", panel: "#0a1a3c", panel2: "#050b18", gradientAngle: 135, text: "#ffffff", teamA: "#ffd75e", teamB: "#6ecbff" },
        carbon: { label: "Carbon", panel: "#101010", panel2: "#1d1d1d", gradientAngle: 180, text: "#f5f5f5", teamA: "#ff5c39", teamB: "#3ddc97" },
        clay: { label: "Clay Court", panel: "#3d1f14", panel2: "#20100a", gradientAngle: 120, text: "#ffe9dd", teamA: "#ffb26b", teamB: "#7fd8ff" },
        club: { label: "Club Green", panel: "#0b2e1f", panel2: "#06170f", gradientAngle: 120, text: "#eafff3", teamA: "#c6ff4d", teamB: "#ffdf6b" },
        custom: { label: "Custom" }
      };

      const POSITIONS = ["tl", "tr", "bl", "br"];
      const LAYOUTS = ["panel", "compact", "ticker"];

      // Settings that have been renamed. Old stored configs and old share URLs
      // keep working: the legacy name is read once and folded into the new key.
      const LEGACY_SETTING_ALIASES = {
        momentumScale: "statsScale"
      };

      function adoptLegacySettingKeys(source) {
        Object.entries(LEGACY_SETTING_ALIASES).forEach(([legacyKey, currentKey]) => {
          if (source[legacyKey] !== undefined && source[currentKey] === undefined) {
            source[currentKey] = source[legacyKey];
          }
          delete source[legacyKey];
        });
        return source;
      }

      function clampNumber(value, min, max, fallback) {
        const num = Number(value);
        if (!Number.isFinite(num)) return fallback;
        return Math.min(max, Math.max(min, num));
      }

      const DEFAULT_SPONSOR_HTML =
        'Live scores brought to you by <img src="/media/logo.svg" alt="Padel Push™" /> ' +
        '<strong>Padel Push™</strong>. Visit <strong>padelpush.co.za</strong> and join us on this court: ' +
        '<strong>{courtId}</strong>';

      // Hosting rewrites that all serve this overlay; a bare one carries no courtId.
      const OVERLAY_ROUTE_PREFIXES = new Set(["overlay", "broadcast"]);

      function getCourtIdFromPath() {
        const segments = window.location.pathname.split("/").filter(Boolean);
        const last = segments.length ? segments[segments.length - 1] : "";

        if (!last || OVERLAY_ROUTE_PREFIXES.has(last)) {
          return null;
        }
        else if(last === "overlay.html") {
          return debugCourt_id; //AL.
        }

        try {
          return decodeURIComponent(last);
        }
        catch (_err) {
          return last;
        }
      }

      const courtId = getCourtIdFromPath();
      const storageKey = "padelPushOverlaySettings:" + (courtId || "default");

      let settings = { ...DEFAULT_SETTINGS };
      let latestScore = null;
      let renderedRevision = null;
      let isPolling = false;
      let lastSponsorHtml = null;
      let lastHeadLabels = null;
      const lastCellValues = {};

      function loadSettings() {
        try {
          const raw = localStorage.getItem(storageKey);
          if (raw) {
            settings = { ...DEFAULT_SETTINGS, ...adoptLegacySettingKeys(JSON.parse(raw)) };
          }
        }
        catch (_err) { /* keep defaults */ }
      }

      function saveSettings() {
        try {
          localStorage.setItem(storageKey, JSON.stringify(settings));
        }
        catch (_err) { /* storage unavailable */ }
      }

      function normalizeSettings() {
        settings.position = POSITIONS.includes(settings.position) ? settings.position : DEFAULT_SETTINGS.position;
        settings.layout = LAYOUTS.includes(settings.layout) ? settings.layout : DEFAULT_SETTINGS.layout;
        settings.scale = clampNumber(settings.scale, 0.5, 2, 1);
        settings.slateScale = clampNumber(settings.slateScale, 0.5, 2, 1);
        settings.statsScale = clampNumber(settings.statsScale, 0.5, 2, 1);
        settings.statsWidth = clampNumber(settings.statsWidth, 0.5, 2, 1);
        settings.autoMomentumCards = Boolean(settings.autoMomentumCards);
        settings.quickBarOpacity = clampNumber(settings.quickBarOpacity, 0.1, 1, 0.4);
        settings.quickBarScale = clampNumber(settings.quickBarScale, 0.5, 2, 1);
        settings.qrSize = clampNumber(settings.qrSize, 64, 200, DEFAULT_SETTINGS.qrSize);
        settings.qrCorner = POSITIONS.includes(settings.qrCorner) ? settings.qrCorner : DEFAULT_SETTINGS.qrCorner;
        settings.themePreset = THEME_PRESETS[settings.themePreset] ? settings.themePreset : "custom";
        ["dragOverlay", "dragSlate", "dragQr", "dragQuickBar", "dragSettings", "dragMomentum"].forEach((key) => {
          const val = settings[key];
          if (!val || typeof val !== "object" || !Number.isFinite(Number(val.x)) || !Number.isFinite(Number(val.y))) {
            settings[key] = null;
          }
          else {
            settings[key] = { x: Math.round(Number(val.x)), y: Math.round(Number(val.y)) };
          }
        });
        settings.sponsors = (Array.isArray(settings.sponsors) ? settings.sponsors : [])
          .map((item) => ({
            text: typeof item?.text === "string" ? item.text : "",
            img: typeof item?.img === "string" ? item.img : "",
            seconds: clampNumber(item?.seconds, 3, 600, 8)
          }))
          .filter((item) => item.text.trim() || item.img.trim());
      }

      function applyThemePreset(name) {
        const preset = THEME_PRESETS[name];
        if (!preset || name === "custom") return;

        THEME_COLOR_KEYS.forEach((key) => {
          if (preset[key] !== undefined) {
            settings[key] = preset[key];
          }
        });
        settings.themePreset = name;
      }

      // ---------- Shareable config via URL parameters ----------
      // Every persisted setting (except transient timer state) can be supplied
      // as a query parameter, so a fully-styled overlay can be pasted into an
      // OBS browser source as a single URL that survives cache clears and
      // machine changes. URL values override stored ones on load; edits made
      // afterwards in the settings panel still apply and persist locally.
      const URL_SKIP_KEYS = new Set(["timerText", "timerOffset", "timerAnchor"]);
      const HEX_COLOR_KEYS = new Set(["panel", "panel2", "text", "teamA", "teamB"]);

      function applyUrlOverrides() {
        let params;
        try {
          params = new URLSearchParams(window.location.search);
        }
        catch (_err) {
          return;
        }

        Object.entries(LEGACY_SETTING_ALIASES).forEach(([legacyKey, currentKey]) => {
          if (params.has(legacyKey) && !params.has(currentKey)) {
            params.set(currentKey, params.get(legacyKey));
          }
        });

        // "theme" is applied first so explicit colour params can refine it.
        const theme = params.get("theme") || params.get("themePreset");
        if (theme && THEME_PRESETS[theme]) {
          applyThemePreset(theme);
        }

        Object.keys(DEFAULT_SETTINGS).forEach((key) => {
          if (URL_SKIP_KEYS.has(key) || !params.has(key)) return;

          const raw = params.get(key);
          const fallback = DEFAULT_SETTINGS[key];

          if (typeof fallback === "boolean") {
            settings[key] = !/^(0|false|no|off)$/i.test(raw.trim());
          }
          else if (typeof fallback === "number") {
            const num = Number(raw);
            if (Number.isFinite(num)) settings[key] = num;
          }
          else if (Array.isArray(fallback)) {
            try {
              const parsed = JSON.parse(raw);
              if (Array.isArray(parsed)) settings[key] = parsed;
            }
            catch (_err) { /* malformed JSON param */ }
          }
          else if (fallback === null || typeof fallback === "object") {
            try {
              const parsed = JSON.parse(raw);
              if (parsed && typeof parsed === "object") settings[key] = parsed;
            }
            catch (_err) { /* malformed JSON param */ }
          }
          else {
            // Allow bare hex colours ("b7f000") so the URL reads cleanly.
            settings[key] = HEX_COLOR_KEYS.has(key) && /^[0-9a-f]{6}$/i.test(raw)
              ? "#" + raw
              : raw;
          }
        });
      }

      function buildShareUrl() {
        const params = new URLSearchParams();

        Object.keys(DEFAULT_SETTINGS).forEach((key) => {
          if (URL_SKIP_KEYS.has(key)) return;

          const value = settings[key];
          if (JSON.stringify(value) === JSON.stringify(DEFAULT_SETTINGS[key])) return;

          params.set(key, (typeof value === "object" && value !== null) || Array.isArray(value) ? JSON.stringify(value) : String(value));
        });

        const base = window.location.origin + "/overlay/" + encodeURIComponent(courtId || "");
        const query = params.toString();
        return query ? base + "?" + query : base;
      }

      function hexToPanelRgba(hex) {
        const value = /^#([0-9a-f]{6})$/i.exec(hex || "");
        if (!value) return "rgba(0, 0, 0, 0.82)";
        const int = parseInt(value[1], 16);
        const r = (int >> 16) & 255;
        const g = (int >> 8) & 255;
        const b = int & 255;
        return "rgba(" + r + ", " + g + ", " + b + ", 0.82)";
      }

