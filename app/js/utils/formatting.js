// Formatting helpers. Pure functions.
export function normalizeCourtId(value)
{
  if (typeof value !== "string") return null;

  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

export function formatPct(value)
{
  const numeric = Number(value) || 0;
  return `${Math.round(numeric)}%`;
}
