// The "Club" select on the create and edit court forms: lists the existing
// clubs and moves a court into (or out of) one through the club callables,
// which keep court and club membership consistent.
import { loadClubIndex } from "../clubs/clubLoader.js";
import { updateClub } from "../firebase/callables.js";
import { getClub } from "../firebase/clubRepository.js";
import { getAllCourts } from "../firebase/courtRepository.js";

const NO_CLUB = "";

function makeOption(select, value, label) {
  const option = select.ownerDocument.createElement("option");
  option.value = value;
  option.textContent = label;
  return option;
}

// Fills `select` with "No club" and every club, selecting the club that lists
// `courtId` (none for a new court). Resolves to the selected club id. The
// select is disabled while loading; if clubs fail to load it only offers "No
// club", which equals the resolved club id, so saving never changes membership.
export async function fillCourtClubSelect(select, courtId = null) {
  if (!select) return NO_CLUB;
  select.disabled = true;
  select.replaceChildren(makeOption(select, NO_CLUB, "No club"));

  const index = await loadClubIndex();
  for (const club of index.clubs) {
    select.append(
      makeOption(select, club.id, `${club.name} (${club.id.toUpperCase()})`),
    );
  }
  const current = courtId
    ? index.clubByCourtId.get(courtId)?.id || NO_CLUB
    : NO_CLUB;
  select.value = current;
  select.disabled = false;
  return current;
}

async function saveClubCourts(clubId, change) {
  const [clubSnap, courtSnap] = await Promise.all([
    getClub(clubId),
    getAllCourts(),
  ]);
  if (!clubSnap.exists()) throw new Error("The club no longer exists.");

  const club = clubSnap.data();
  const existingCourtIds = new Set(courtSnap.docs.map((court) => court.id));
  const courtIds = change(
    Array.isArray(club.courtIds) ? club.courtIds : [],
  ).filter((id) => existingCourtIds.has(id));

  await updateClub({
    clubId,
    name: club.name,
    courtIds,
    deviceIds: Array.isArray(club.deviceIds) ? club.deviceIds : [],
  });
}

// Puts the court in `clubId` (moving it out of any other club) or, for no
// club, removes it from `previousClubId`. Does nothing when nothing changed.
export async function assignCourtToClub(
  courtId,
  clubId,
  previousClubId = NO_CLUB,
) {
  const next = clubId || NO_CLUB;
  if (next === (previousClubId || NO_CLUB)) return;

  if (next) {
    await saveClubCourts(next, (ids) => [...new Set([...ids, courtId])]);
  } else {
    await saveClubCourts(previousClubId, (ids) =>
      ids.filter((id) => id !== courtId),
    );
  }
}
