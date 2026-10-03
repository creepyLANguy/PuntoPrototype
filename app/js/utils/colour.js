// Colour helpers: hex normalisation and WCAG luminance / contrast. Pure functions.
export function normalizeTeamColourPair(value)
{
  if (!value || typeof value !== "object") return null;

  const A = normalizeHexColour(value.A);
  const B = normalizeHexColour(value.B);
  return A && B ? { A, B } : null;
}

export function normalizeHexColour(value)
{
  if (typeof value !== "string") return null;

  const colour = value.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(colour) ? colour : null;
}

export function getReadableTextColour(colours)
{
  const averageLuminance = (getRelativeLuminance(colours.A) + getRelativeLuminance(colours.B)) / 2;
  return averageLuminance > 0.45 ? "#000000" : "#ffffff";
}

export function getReadableTextColourForBackground(hexColour)
{
  const luminance = getRelativeLuminance(hexColour);
  const whiteContrast = 1.05 / (luminance + 0.05);
  const blackContrast = (luminance + 0.05) / 0.05;
  return whiteContrast >= blackContrast ? "#ffffff" : "#000000";
}

export function getRelativeLuminance(hexColour)
{
  const channels = [1, 3, 5].map((start) => parseInt(hexColour.slice(start, start + 2), 16) / 255);
  const linearChannels = channels.map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  );
  return (linearChannels[0] * 0.2126) + (linearChannels[1] * 0.7152) + (linearChannels[2] * 0.0722);
}
