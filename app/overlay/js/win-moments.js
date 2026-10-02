      // ---------- Set / match win moments ----------

      let winTimer = null;
      let prevSetCount = null;
      let prevMatchComplete = null;

      function showWinMoment(eyebrow, title, scoreText, teamCls, durationMs) {
        if (settings.showWinMoments === false) return;

        const el = document.getElementById("winMoment");
        document.getElementById("winEyebrow").textContent = eyebrow;
        document.getElementById("winTitle").textContent = title;
        document.getElementById("winScore").textContent = scoreText;

        // Restart the pop animation even if a moment is already showing.
        el.className = "win-moment";
        void el.offsetWidth;
        el.className = "win-moment show" + (teamCls ? " " + teamCls : "");

        clearTimeout(winTimer);
        winTimer = setTimeout(() => el.classList.remove("show"), durationMs);
      }

      // After the celebration clears, the follow-ups play: an auto stat card
      // and (optionally) a sponsor slate.
      function queuePostMoment(delayMs, statCardMs, slateMs, momentumMs) {
        setTimeout(() => {
          if (settings.autoStatCards !== false && !statCardPinned) {
            void showStatCard({ durationMs: statCardMs });
          }
          if (settings.autoMomentumCards === true && !momentumCardPinned) {
            void showMomentumCard({ durationMs: momentumMs || statCardMs });
          }
          if (settings.sponsorSlateOnSet === true) {
            showSponsorSlate(slateMs);
          }
        }, delayMs);
      }

      function fireSetMoment(data) {
        const sets = data.completedSets || [];
        const lastSet = sets[sets.length - 1] || {};
        const a = Number(lastSet.A) || 0;
        const b = Number(lastSet.B) || 0;
        const team = a > b ? "A" : "B";

        showWinMoment("Set " + sets.length, teamDisplayName(team), a + "–" + b, "team-" + team, 7000);
        queuePostMoment(7300, 12000, 8000, 12000);
      }

      function fireMatchMoment(data) {
        const sets = data.completedSets || [];
        let team;
        let scoreText;

        if ((data.scoringMode || "standard") === "standard" && sets.length) {
          let wonA = 0;
          let wonB = 0;
          sets.forEach((set) => ((Number(set.A) || 0) > (Number(set.B) || 0) ? wonA++ : wonB++));
          team = wonA >= wonB ? "A" : "B";
          scoreText = sets.map((set) => (Number(set.A) || 0) + "–" + (Number(set.B) || 0)).join("  ");
        }
        else {
          const pointsA = Number(data.teams.A.points) || 0;
          const pointsB = Number(data.teams.B.points) || 0;
          team = pointsA >= pointsB ? "A" : "B";
          scoreText = data.teams.A.pointsDisplay + "–" + data.teams.B.pointsDisplay;
        }

        showWinMoment("Match winner", teamDisplayName(team), scoreText, "team-" + team, 12000);
        queuePostMoment(12300, 20000, 10000, 20000);
      }

      // Fires celebrations only on observed transitions — joining a stream
      // mid-match (or an OBS source refresh) must not replay old moments.
      function handleTransitions(data) {
        const setCount = (data.completedSets || []).length;
        const matchComplete = Boolean(data.matchComplete);
        const firstRender = prevSetCount === null;
        const setIncreased = !firstRender && setCount > prevSetCount;
        const matchJustEnded = prevMatchComplete === false && matchComplete;

        prevSetCount = setCount;
        prevMatchComplete = matchComplete;

        if (firstRender) return;

        if (matchJustEnded) {
          fireMatchMoment(data);
        }
        else if (setIncreased && (data.scoringMode || "standard") === "standard") {
          fireSetMoment(data);
        }
      }

