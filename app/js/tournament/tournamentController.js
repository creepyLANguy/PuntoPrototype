// Tournament page controller (/t/{tournamentId}): keeps the read model and
// the live match scores subscribed, decides between the spectator dashboard
// and the host control room, and runs host operations.
import { getAllCourts } from "../firebase/courtRepository.js";
import { listenToTournamentLiveMatches } from "../firebase/matchRepository.js";
import { listenToTournamentView } from "../firebase/tournamentRepository.js";
import { loadClubIndex } from "../clubs/clubLoader.js";
import {
  getAccessCode,
  getAdminKey,
  getHostKey,
} from "../state/credentialsState.js";
import { h, replaceContent } from "./elements.js";
import { fixtureCard } from "./fixtureCard.js";
import { fixtureActions, renderHostDashboard } from "./hostView.js";
import { renderPublicDashboard } from "./publicView.js";
import {
  friendlyError,
  publicTournamentOperation,
  tournamentOperation,
} from "./tournamentApi.js";

const PRIVATE_REFRESH_MS = 15000;

export function createTournamentController(
  container,
  tournamentId,
  { accessCode = null } = {},
) {
  const ctx = {
    tournamentId,
    view: null,
    liveMatches: new Map(),
    isHost: false,
    hostKey: getHostKey(tournamentId),
    accessCode: accessCode || getAccessCode(tournamentId),
    courtOptions: [],
    clubs: [],
    statusArea: h("div", {
      className: "ev-status",
      role: "status",
      "aria-live": "polite",
    }),
    run: null,
    confirmRun: null,
    finishTournament: null,
    cancelTournament: null,
  };
  let renderPending = false;
  let privateTimer = null;
  let unsubscribers = [];

  const setStatus = (message, tone = "info") => {
    ctx.statusArea.textContent = message || "";
    ctx.statusArea.dataset.tone = tone;
  };

  // Host forms stay intact while someone is typing; the update is applied
  // when focus leaves the form.
  const isEditing = () => {
    const active = document.activeElement;
    return (
      ctx.isHost &&
      active &&
      container.contains(active) &&
      ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName)
    );
  };

  const openDetailsKeys = () =>
    [...container.querySelectorAll("details[open]")].map(
      (details) =>
        `${details.closest("[data-fixture-id]")?.dataset.fixtureId || details.closest("[data-round-id]")?.dataset.roundId || ""}|${details.querySelector("summary")?.textContent || ""}`,
    );

  const render = () => {
    if (!ctx.view) return;
    if (isEditing()) {
      renderPending = true;
      return;
    }
    renderPending = false;
    const openKeys = new Set(openDetailsKeys());
    const scrollY = window.scrollY;
    replaceContent(
      container,
      ctx.isHost
        ? renderHostDashboard(ctx)
        : renderPublicDashboard(ctx.view, ctx.liveMatches),
    );
    container.querySelectorAll("details").forEach((details) => {
      const key = `${details.closest("[data-fixture-id]")?.dataset.fixtureId || details.closest("[data-round-id]")?.dataset.roundId || ""}|${details.querySelector("summary")?.textContent || ""}`;
      if (openKeys.has(key)) details.open = true;
    });
    window.scrollTo(0, scrollY);
    document.title = `${ctx.view.name} | Padel Push™`;
  };

  // Live points only refresh the score text of the affected cards.
  const patchLiveScores = () => {
    if (!ctx.view) return;
    ctx.view.fixtures.forEach((fixture) => {
      if (!fixture.matchId || !ctx.liveMatches.has(fixture.matchId)) return;
      container
        .querySelectorAll(`.fx-card[data-fixture-id="${fixture.fixtureId}"]`)
        .forEach((card) => {
          const fresh = fixtureCard(
            { ...fixture, displayStatus: "LIVE" },
            { liveMatches: ctx.liveMatches },
          );
          const freshScores = fresh.querySelectorAll(".fx-side-score");
          card.querySelectorAll(".fx-side-score").forEach((span, index) => {
            span.textContent = freshScores[index]?.textContent || "";
          });
          const detail = card.querySelector(".fx-detail");
          const freshDetail = fresh.querySelector(".fx-detail");
          if (detail && freshDetail)
            detail.textContent = freshDetail.textContent;
        });
    });
  };

  container.addEventListener("focusout", () => {
    setTimeout(() => {
      if (renderPending && !isEditing()) render();
    }, 0);
  });

  ctx.run = async (operation, data = {}, successMessage = "Done.") => {
    setStatus("Working...", "info");
    try {
      const result = await tournamentOperation(operation, tournamentId, data);
      setStatus(successMessage, "success");
      if (ctx.view?.visibility === "private") await refreshPrivateView();
      return result;
    } catch (error) {
      setStatus(friendlyError(error), "error");
      return null;
    }
  };

  ctx.confirmRun = (question, operation, data, successMessage) => {
    if (!window.confirm(question)) return Promise.resolve(null);
    return ctx.run(operation, data, successMessage);
  };

  ctx.finishTournament = () => {
    const open = ctx.view.fixtures.filter((fixture) =>
      ["LIVE", "READY", "SCHEDULED", "DELAYED", "TBD"].includes(
        fixture.displayStatus,
      ),
    ).length;
    const finiteFormat = ["roundRobin", "swiss", "groupKnockout"].includes(
      ctx.view.format?.id,
    );
    const readiness = ctx.view.completionReadiness;
    const requiresEarlyFinish =
      finiteFormat &&
      (readiness ? !readiness.allowed : Boolean(ctx.view.nextRound?.allowed));

    if (!open && !requiresEarlyFinish) {
      return ctx.confirmRun(
        "Complete the tournament?",
        "completeTournament",
        {},
        "Tournament completed.",
      );
    }

    const warnings = [];
    if (open) warnings.push(`${open} match(es) are not finished`);
    if (requiresEarlyFinish) {
      if (readiness?.reason === "required-progress") {
        warnings.push(
          ctx.view.format.id === "groupKnockout"
            ? "the knockout stage has not been generated"
            : "required tournament rounds remain to be generated",
        );
      } else {
        warnings.push(
          readiness?.message ||
            "required tournament fixtures remain unresolved; resolve them or finish early with a reason",
        );
      }
    }
    const reason = window.prompt(
      `${warnings.join("; ")}. Finish early anyway? Give a reason:`,
    );
    if (!reason || !reason.trim()) return null;
    return ctx.run(
      "completeTournament",
      { early: true, reason: reason.trim() },
      "Tournament finished early.",
    );
  };

  ctx.cancelTournament = () => {
    const reason = window.prompt(
      "Cancel this tournament? It stays visible as cancelled. Give a reason:",
    );
    if (!reason) return null;
    return ctx.run("cancelTournament", { reason }, "Tournament cancelled.");
  };

  ctx.fixtureActions = (fixture) => fixtureActions(ctx, fixture);

  async function refreshPrivateView() {
    try {
      const result = await publicTournamentOperation(
        "getTournamentView",
        { tournamentId, accessCode: ctx.accessCode },
        {
          hostKey: ctx.hostKey,
          adminKey: getAdminKey(),
        },
      );
      ctx.view = result.view;
      ctx.liveMatches = new Map(
        (result.liveMatches || []).map((match) => [match.matchId, match]),
      );
      render();
    } catch (error) {
      renderAccessPrompt(friendlyError(error));
    }
  }

  function renderAccessPrompt(message) {
    const input = h("input", {
      className: "ev-input",
      placeholder: "Access code",
      autocomplete: "off",
    });
    const form = h(
      "form",
      { className: "access-form" },
      h("h1", { className: "ev-title" }, "Private tournament"),
      h("p", { className: "ev-hint" }, message),
      input,
      h(
        "button",
        { className: "ev-btn ev-btn-primary", type: "submit" },
        "View",
      ),
    );
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      ctx.accessCode = input.value.trim();
      void refreshPrivateView();
    });
    replaceContent(container, h("div", { className: "ev-dashboard" }, form));
  }

  async function loadHostContext() {
    if (!ctx.hostKey && !getAdminKey()) return;
    try {
      await tournamentOperation("verifyHost", tournamentId);
      ctx.isHost = true;
      const [courtsSnap, clubIndex] = await Promise.all([
        getAllCourts(),
        loadClubIndex(),
      ]);
      ctx.courtOptions = courtsSnap.docs.map((courtDoc) => ({
        courtId: courtDoc.id,
        name: courtDoc.data().name || courtDoc.id,
        status: courtDoc.data().status || "open",
        clubId: courtDoc.data().clubId || null,
      }));
      ctx.clubs = clubIndex.clubs.map((club) => ({
        id: club.id,
        name: club.name,
      }));
      render();
    } catch (error) {
      console.warn("Host access was not confirmed:", error);
      ctx.isHost = false;
    }
  }

  function start() {
    replaceContent(
      container,
      h("p", { className: "ev-hint ev-loading" }, "Loading tournament..."),
    );
    unsubscribers.push(
      listenToTournamentView(
        tournamentId,
        (snap) => {
          if (!snap.exists()) {
            replaceContent(
              container,
              h(
                "div",
                { className: "ev-dashboard not-found" },
                h("h1", { className: "ev-title" }, "Tournament not found"),
                h(
                  "p",
                  { className: "ev-hint" },
                  "Check the link or ask the host for a new one.",
                ),
                h("a", { className: "ev-btn", href: "/t" }, "All tournaments"),
              ),
            );
            return;
          }
          const data = snap.data();
          if (data.visibility === "private" && !data.fixtures) {
            if (!privateTimer) {
              void refreshPrivateView();
              privateTimer = setInterval(
                () => void refreshPrivateView(),
                PRIVATE_REFRESH_MS,
              );
            }
            return;
          }
          ctx.view = data;
          render();
        },
        (error) => {
          console.error("Tournament listener error:", error);
          setStatus("Connection lost. Retrying...", "error");
        },
      ),
    );

    unsubscribers.push(
      listenToTournamentLiveMatches(
        tournamentId,
        (snapshot) => {
          ctx.liveMatches = new Map(
            snapshot.docs.map((matchDoc) => [matchDoc.id, matchDoc.data()]),
          );
          patchLiveScores();
        },
        (error) => console.warn("Live match listener error:", error),
      ),
    );

    void loadHostContext();
  }

  function stop() {
    unsubscribers.forEach((unsubscribe) => unsubscribe());
    unsubscribers = [];
    if (privateTimer) clearInterval(privateTimer);
  }

  return { start, stop, ctx };
}
