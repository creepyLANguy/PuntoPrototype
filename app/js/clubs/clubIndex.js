// Club lookups and search matching: which club a court or device belongs to,
// and whether a court / device matches a search term through its club. Pure
// functions over plain club records { id, name, courtIds, deviceIds }.

export function clubFromData(id, data = {})
{
  const ids = (value) => Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
  return {
    id,
    name: typeof data.name === "string" && data.name.trim() ? data.name.trim() : id,
    state: Object.values(CLUB_STATES).includes(data.state)
      ? data.state
      : CLUB_STATES.MAINTENANCE,
    courtIds: ids(data.courtIds),
    deviceIds: ids(data.deviceIds)
  };
}

export function compareClubsByName(a, b)
{
  return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

// The club records plus member -> club maps. The backend keeps every court
// and device in at most one club; should two clubs ever list the same member,
// the first club by name wins, so the result is still deterministic.
export function buildClubIndex(clubs = [])
{
  const sorted = [...clubs].sort(compareClubsByName);
  const byId = new Map();
  const clubByCourtId = new Map();
  const clubByDeviceId = new Map();

  for (const club of sorted)
  {
    byId.set(club.id, club);
    for (const courtId of club.courtIds)
    {
      if (!clubByCourtId.has(courtId)) clubByCourtId.set(courtId, club);
    }
    for (const deviceId of club.deviceIds)
    {
      if (!clubByDeviceId.has(deviceId)) clubByDeviceId.set(deviceId, club);
    }
  }

  return { clubs: sorted, byId, clubByCourtId, clubByDeviceId };
}

export const EMPTY_CLUB_INDEX = buildClubIndex([]);

// The { id, name } summary shown next to a court or device, or null.
export function clubSummary(club)
{
  return club ? { id: club.id, name: club.name } : null;
}

export function isClubOpen(club)
{
  return Boolean(club) && club.state === CLUB_STATES.OPEN;
}

export function normalizeSearchTerm(term)
{
  return String(term ?? "").toLowerCase().trim();
}

// True when any value contains the (already normalised) term.
export function anyValueMatches(term, ...values)
{
  if (!term) return true;
  return values.some((value) => typeof value === "string" && value.toLowerCase().includes(term));
}

// Court search: the court's name or id, or the name or id of its club.
export function courtMatchesSearch(court, term)
{
  return anyValueMatches(
    normalizeSearchTerm(term),
    court?.name,
    court?.id,
    court?.club?.name,
    court?.club?.id
  );
}
