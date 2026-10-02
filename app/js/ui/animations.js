// Score feedback animations on the team cards and point displays.
import { $, elements } from "./dom.js";

export function animate(team)
{
  const el = $(`team${team}`);
  el.classList.remove("score-animate");
  void el.offsetWidth;
  el.classList.add("score-animate");
}

export function animateUndo(team)
{
  const el = elements.points[team];
  if (!el) return;
  el.classList.remove("undo-flash");
  void el.offsetWidth;
  el.classList.add("undo-flash");
}
