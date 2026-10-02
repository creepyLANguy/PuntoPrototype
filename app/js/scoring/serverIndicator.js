// Server indicator badges (#serverBadgeA / #serverBadgeB).
import { getCurrentServerLabel } from "./presentation.js";
import { session } from "../state/sessionState.js";
import { themeState } from "../state/themeState.js";
import { getServerDisplayLabel } from "../teams/playerNames.js";
import { elements } from "../ui/dom.js";

export function updateServerIndicator()
{
  if (!elements.serverBadgeA || !elements.serverBadgeB)
  {
    return;
  }

  const teamAColour = getComputedStyle(document.body).getPropertyValue("--teamAcolour").trim();
  const teamBColour = getComputedStyle(document.body).getPropertyValue("--teamBcolour").trim();
  //elements.serverBadgeA.style.color = teamAColour;
  //elements.serverBadgeB.style.color = teamBColour;

  const label = getCurrentServerLabel(session.score);
  const teamAServing = themeState.isServerBadgeVisible && label?.startsWith("A");
  const teamBServing = themeState.isServerBadgeVisible && label?.startsWith("B");

  elements.serverBadgeA.classList.toggle("hidden", !teamAServing);
  elements.serverBadgeB.classList.toggle("hidden", !teamBServing);

  const displayLabel = getServerDisplayLabel(label);

  if (teamAServing)
  {
    elements.serverBadgeA.textContent = `${displayLabel}`;
  }
  if (teamBServing)
  {
    elements.serverBadgeB.textContent = `${displayLabel}`;
  }
}
