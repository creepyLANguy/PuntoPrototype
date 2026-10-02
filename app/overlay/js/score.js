      // Player names must never be truncated, so the name column is sized to
      // the widest row's natural content instead of a fixed width. Both team
      // rows and the header share one pinned value so the score columns stay
      // aligned. The original 10.5em acts as a floor so short names don't
      // shrink the panel below its usual size.
      function syncNameColumn() {
        const overlay = document.getElementById("overlayBox");

        // Let each row size to its own content, measure, then pin the widest.
        overlay.style.setProperty("--ov-name-col", "max-content");

        let widest = parseFloat(getComputedStyle(overlay).fontSize) * 10.5 || 0;
        document.querySelectorAll(".team-row .team-id").forEach((el) => {
          widest = Math.max(widest, el.getBoundingClientRect().width);
        });

        overlay.style.setProperty("--ov-name-col", Math.ceil(widest) + "px");
      }

      function applyLogo(id, url) {
        const img = document.getElementById(id);
        let safeUrl = "";

        if (url) {
          try {
            const parsed = new URL(url, window.location.origin);
            if (parsed.protocol === "https:" || parsed.protocol === "http:") {
              safeUrl = parsed.href;
            }
          }
          catch (_err) { /* invalid URL */ }
        }

        if (safeUrl) {
          img.src = safeUrl;
          img.classList.add("visible");
        }
        else {
          img.removeAttribute("src");
          img.classList.remove("visible");
        }
      }

      function setCells(containerId, cells) {
        const container = document.getElementById("containerId" === containerId ? "" : containerId);
        if (!container) return;
        const previous = lastCellValues[containerId] || null;
        container.textContent = "";

        cells.forEach((cell, index) => {
          const isNew = !previous || index >= previous.length;
          const changed = !isNew && previous[index] !== String(cell.value);

          const div = document.createElement("div");
          div.className = "cell" +
            (cell.highlight ? " points" : "") +
            (cell.won ? " won" : "") +
            (cell.lost ? " lost" : "") +
            (isNew ? " new" : changed ? " changed" : "");
          div.textContent = cell.value;
          container.appendChild(div);
        });

        lastCellValues[containerId] = cells.map((cell) => String(cell.value));
      }

      function setHeadCells(columns) {
        const container = document.getElementById("cellsHead");
        container.textContent = "";

        columns.forEach((column, index) => {
          const div = document.createElement("div");
          div.className = "cell" +
            (column.highlight ? " points" : "") +
            (lastHeadLabels && index >= lastHeadLabels.length ? " new" : "");
          div.textContent = column.label;
          container.appendChild(div);
        });

        lastHeadLabels = columns.map((column) => column.label);
      }

      function getPlayerName(slot, data) {
        return settings["player" + slot] || data.playerNames[slot] || "";
      }

      // Columns are identical for both teams, so a single build keeps them aligned.
      function buildColumns(data) {
        const columns = [];
        const mode = data.scoringMode || "standard";

        if (mode === "standard") {
          (data.completedSets || []).forEach((set, index) => {
            const a = Number(set.A) || 0;
            const b = Number(set.B) || 0;
            columns.push({
              label: "S" + (index + 1),
              A: { value: a, won: a > b, lost: b > a },
              B: { value: b, won: b > a, lost: a > b }
            });
          });

          const currentIndex = (data.completedSets || []).length + 1;
          if (!data.matchComplete) {
            columns.push({
              label: "S" + currentIndex,
              A: { value: data.teams.A.games },
              B: { value: data.teams.B.games }
            });
          }
        }

        if (mode !== "standard" || !data.matchComplete) {
          const label = mode === "standard" && data.inTiebreak ? "TB" : "PTS";
          columns.push({
            label,
            highlight: true,
            A: { value: data.teams.A.pointsDisplay, highlight: true },
            B: { value: data.teams.B.pointsDisplay, highlight: true }
          });
        }

        return columns;
      }

      // Fallback for backends that don't send deuceCycles yet: silver/star
      // points follow cancelled advantages, so count Ad -> deuce transitions
      // observed within the current game (silver decides after 1, star after 2).
      let sawAdGameKey = null;
      let adWasActive = false;
      let cancelledAdsInGame = 0;

      function trackAdvantage(data) {
        const gameKey = [
          (data.completedSets || []).length,
          data.teams.A.games,
          data.teams.B.games
        ].join("|");

        if (gameKey !== sawAdGameKey) {
          sawAdGameKey = gameKey;
          adWasActive = false;
          cancelledAdsInGame = 0;
        }

        const hasAd = String(data.teams.A.pointsDisplay) === "Ad" || String(data.teams.B.pointsDisplay) === "Ad";
        if (hasAd) {
          adWasActive = true;
        }
        else if (adWasActive) {
          adWasActive = false;
          cancelledAdsInGame++;
        }
      }

      // Derives set / golden / silver point purely from the score payload.
      // No match-point badge: the sets required to win aren't knowable here.
      function computeBadge(data) {
        if ((data.scoringMode || "standard") !== "standard" || data.matchComplete) return null;

        const pts = {
          A: String(data.teams.A.pointsDisplay ?? ""),
          B: String(data.teams.B.pointsDisplay ?? "")
        };
        const games = {
          A: Number(data.teams.A.games) || 0,
          B: Number(data.teams.B.games) || 0
        };

        function gamePoint(team) {
          const other = team === "A" ? "B" : "A";
          if (data.inTiebreak) {
            const p = Number(pts[team]) || 0;
            const po = Number(pts[other]) || 0;
            return p >= 6 && p > po;
          }
          if (pts[team] === "Ad") return true;
          return pts[team] === "40" && pts[other] !== "40" && pts[other] !== "Ad";
        }

        function setPoint(team) {
          if (!gamePoint(team)) return false;
          if (data.inTiebreak) return true;
          const other = team === "A" ? "B" : "A";
          return games[team] >= 5 && games[team] - games[other] >= 1;
        }

        for (const team of ["A", "B"]) {
          if (setPoint(team)) return { text: "Set point", cls: "team-" + team };
        }

        const deuceMode = (data.scoringOptions && data.scoringOptions.deuceMode) || "standard";
        const atDeuce = !data.inTiebreak && pts.A === "40" && pts.B === "40";
        if (atDeuce && deuceMode === "golden") {
          return { text: "Golden point", cls: "gold" };
        }
        // Silver decides after one deuce cycle, star after two. Prefer the
        // backend's deuceCycles; infer from observed cancelled advantages
        // when the field isn't in the payload yet.
        if (atDeuce && (deuceMode === "silver" || deuceMode === "star")) {
          const cyclesKnown = data.deuceCycles !== undefined && data.deuceCycles !== null;
          const cycles = cyclesKnown ? (Number(data.deuceCycles) || 0) : cancelledAdsInGame;
          if (deuceMode === "silver" && cycles >= 1) return { text: "Silver point", cls: "silver" };
          if (deuceMode === "star" && cycles >= 2) return { text: "Star point", cls: "star" };
        }

        return null;
      }

