      function render(data) {
        latestScore = data;
        trackAdvantage(data);
        handleTransitions(data);

        document.getElementById("loadingLine").classList.add("hidden");
        document.getElementById("scoreBody").classList.remove("hidden");
        const displayCourtId = data.courtId || courtId || "";
        document.getElementById("courtLabel").textContent =
          displayCourtId ? "Join: " + displayCourtId.toUpperCase() : "";

        const server = settings.showServer ? (data.server || "") : "";
        const showTeamNames = settings.showTeamNames !== false;
        const showPlayerNames = settings.showPlayerNames !== false && !isSlimLayout();

        ["A", "B"].forEach((team) => {
          const teamName = settings["name" + team] || data.teamNames[team] || ("Team " + team);
          const nameEl = document.getElementById("name" + team);
          nameEl.textContent = teamName;
          nameEl.style.display = showTeamNames ? "" : "none";

          let hasAnyPlayer = false;

          [1, 2].forEach((index) => {
            const slot = team + index;
            const playerName = showPlayerNames ? getPlayerName(slot, data) : "";
            const line = document.getElementById("line" + slot);

            line.classList.toggle("hidden", !playerName);
            document.getElementById("player" + slot).textContent = playerName;
            document.getElementById("dot" + slot).classList.toggle("serving", server === slot);

            if (playerName) hasAnyPlayer = true;
          });

          nameEl.classList.toggle("primary", !hasAnyPlayer);
        });

        const columns = buildColumns(data);
        setHeadCells(columns);
        ["A", "B"].forEach((team) => setCells("cells" + team, columns.map((column) => column[team])));

        const badge = computeBadge(data);
        const badgeLine = document.getElementById("badgeLine");
        if (badge) {
          // Text/colour are left untouched when hiding so the ribbon keeps
          // its label while it slides back behind the panel.
          const badgeText = document.getElementById("badgeText");
          badgeText.textContent = badge.text;
          badgeText.className = "badge " + badge.cls;
        }
        badgeLine.classList.toggle("visible", Boolean(badge));

        const statusLine = document.getElementById("statusLine");
        if (data.matchComplete) {
          statusLine.textContent = "Match complete";
          statusLine.classList.add("visible");
        }
        else {
          statusLine.textContent = "";
          statusLine.classList.remove("visible");
        }

        // Names have just changed - re-measure before the sponsor strip, whose
        // scroll test depends on the final panel width.
        syncNameColumn();

        // The court id may only be known once data arrives; refresh the strip.
        updateSponsor();
      }

