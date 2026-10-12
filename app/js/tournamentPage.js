// Composition root of the tournament page (app/tournament.html):
//   /t                 tournaments landing
//   /t/new             setup wizard
//   /t/{tournamentId}  public dashboard, or the host control room on a device
//                      holding the host key (?host=KEY stores it) or with
//                      the admin session key; ?code=CODE opens a private one.
import { getAllCourts } from "./firebase/courtRepository.js";
import { loadClubIndex } from "./clubs/clubLoader.js";
import {
  getAdminKey,
  listHostedTournamentIds,
  rememberAccessCode,
  rememberHostKey,
} from "./state/credentialsState.js";
import { h, replaceContent } from "./tournament/elements.js";
import { renderLanding } from "./tournament/landing.js";
import { createTournamentController } from "./tournament/tournamentController.js";
import { renderWizard } from "./tournament/wizard.js";
import { getTournamentIdFromPathname } from "./routing/routeParsers.js";

function parseRoute(pathname) {
  const match = pathname
    .replace(/\/+$/, "")
    .match(/^\/(?:app\/)?t(?:\/([^/]+))?$/i);
  if (!match || !match[1]) return { page: "landing" };
  let segment;
  try {
    segment = decodeURIComponent(match[1]).trim().toLowerCase();
  } catch {
    return { page: "notFound" };
  }
  if (segment === "new") return { page: "new" };
  const tournamentId = getTournamentIdFromPathname(pathname);
  return tournamentId
    ? { page: "tournament", tournamentId }
    : { page: "notFound" };
}

// Keys in the URL are stored on the device and removed from the address bar
// so they are not shared by accident.
function consumeUrlKeys(tournamentId) {
  const url = new URL(window.location.href);
  const hostKey = url.searchParams.get("host");
  const accessCode = url.searchParams.get("code");
  if (tournamentId && hostKey) rememberHostKey(tournamentId, hostKey);
  if (tournamentId && accessCode) rememberAccessCode(tournamentId, accessCode);
  if (hostKey || accessCode) {
    url.searchParams.delete("host");
    url.searchParams.delete("code");
    window.history.replaceState(
      null,
      "",
      url.pathname + (url.search ? url.search : "") + url.hash,
    );
  }
  return { accessCode };
}

async function startWizard(container) {
  replaceContent(
    container,
    h("p", { className: "ev-hint ev-loading" }, "Loading courts..."),
  );
  const [courtsSnap, clubIndex] = await Promise.all([
    getAllCourts().catch(() => null),
    loadClubIndex(),
  ]);
  const courts = (courtsSnap?.docs || []).map((courtDoc) => ({
    courtId: courtDoc.id,
    name: courtDoc.data().name || courtDoc.id,
    status: courtDoc.data().status || "open",
    clubId: courtDoc.data().clubId || null,
  }));
  renderWizard(container, {
    courts,
    clubs: clubIndex.clubs.map((club) => ({ id: club.id, name: club.name })),
    adminCredentials: { adminKey: getAdminKey() },
    onCreated: ({ tournamentId, hostKey, accessCode }) => {
      rememberHostKey(tournamentId, hostKey);
      rememberAccessCode(tournamentId, accessCode);
    },
  });
}

function start() {
  const container = document.getElementById("tournamentApp");
  const route = parseRoute(window.location.pathname);

  if (route.page === "notFound") {
    document.title = "Tournament not found | Padel Push™";
    replaceContent(
      container,
      h("p", { className: "ev-hint" }, "Tournament not found."),
    );
    return;
  }

  if (route.page === "new") {
    document.title = "New tournament | Padel Push™";
    void startWizard(container);
    return;
  }
  if (route.page === "landing") {
    document.title = "Tournaments | Padel Push™";
    void renderLanding(container, { hostedIds: listHostedTournamentIds() });
    return;
  }

  const { accessCode } = consumeUrlKeys(route.tournamentId);
  createTournamentController(container, route.tournamentId, {
    accessCode,
  }).start();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start);
} else {
  start();
}
