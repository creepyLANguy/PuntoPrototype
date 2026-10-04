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

// Escapes text for safe use inside HTML markup (e.g. a confirm message).
export function escapeHtml(value)
{
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}
