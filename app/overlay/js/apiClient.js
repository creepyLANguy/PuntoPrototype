      function showError(message) {
        document.getElementById("loadingLine").classList.add("hidden");
        const statusLine = document.getElementById("statusLine");
        statusLine.textContent = message;
        statusLine.classList.add("visible");
      }

      async function fetchJson(path) {
        const response = await fetch(path, { cache: "no-store" });
        let data = null;

        try {
          data = await response.json();
        }
        catch (_parseErr) { /* non-JSON body */ }

        if (!data) {
          // These endpoints are hosting rewrites: until one is deployed the
          // request falls through to index.html and arrives here as a
          // perfectly successful lump of HTML.
          throw new Error("No JSON from " + path + " (HTTP " + response.status +
            ") - the endpoint is probably not deployed.");
        }

        if (!response.ok || !data.success) {
          throw new Error(data.error || "Could not load " + path + ".");
        }

        return data;
      }

      async function loadFullScore() {
        const url = isDebugCourt ? debugCourt_fullScoreUrl : "/score/" + encodeURIComponent(courtId);
        const data = await fetchJson(url);
        render(data);
        // Trust the revision that shipped with this payload rather than the one
        // that triggered the fetch, so a change landing mid-request is not
        // mistaken for already-rendered state on the next poll.
        renderedRevision = data.revision || null;
      }

      async function poll() {
        if (!courtId) {
          showError("No court specified. Use /overlay/{courtId}.");
          return;
        }

        if (isPolling) return;
        isPolling = true;

        try {
          const revisionUrl = isDebugCourt ? debugCourt_revisionUrl : "/revision/" + encodeURIComponent(courtId);
          const revisionData = await fetchJson(revisionUrl);

          if (revisionData.revision && revisionData.revision === renderedRevision) {
            if (latestScore) render(latestScore);
            return;
          }

          await loadFullScore();
        }
        catch (err) {
          showError(err.message === "Failed to fetch" ? "Connection lost. Retrying…" : err.message);
        }
        finally {
          isPolling = false;
        }
      }

