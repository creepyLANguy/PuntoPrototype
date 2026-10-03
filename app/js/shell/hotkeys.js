// Keyboard shortcuts for the menu and scoreboard pages.
import { EVENT_TYPES } from "../config/constants.js";
import { addPoint } from "../scoring/actions.js";
import { session } from "../state/sessionState.js";
import { toggleWaves } from "../ui/appearance.js";
import { elements } from "../ui/dom.js";
import { toggleTheme } from "../ui/theme.js";

export function registerHotkeys()
{
  document.addEventListener("keydown", (e) =>
  {
    // Never fire hotkeys when typing in an input, textarea, or select
    const tag = document.activeElement?.tagName?.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return;

    // Also skip if any modifier key is held (Ctrl, Alt, Meta)
    if (e.ctrlKey || e.altKey || e.metaKey) return;

    const isVisible = (el) => el && window.getComputedStyle(el).display !== "none";

    const onMenu = isVisible(elements.menuPage);
    const onScoreboard = isVisible(elements.scoreboardPage);

    const key = e.key;

    // ── T : Toggle theme (works everywhere) ──────────────────────────
    if (key === "t" || key === "T")
    {
      toggleTheme();
      return;
    }

    // ── ` : Open admin portal (works from menu) ───────────────────────
    if (key === "`")
    {
      if (onMenu)
      {
        e.preventDefault();
        elements.adminLoginBtn.click();
      }
      return;
    }

    // ── Menu-page hotkeys ─────────────────────────────────────────────
    if (onMenu)
    {
      // P : Open play menu
      if (key === "p" || key === "P")
      {
        e.preventDefault();
        const playBtn = document.querySelector(".menu-btn[data-action='start']");
        if (playBtn) playBtn.click();
        return;
      }

      // S : Open spectate menu
      if (key === "s" || key === "S")
      {
        e.preventDefault();
        const btns = document.querySelectorAll(".menu-btn[data-action='start']");
        if (btns.length >= 2) btns[1].click(); // second button is Spectate
        return;
      }
    }

    // ── Scoreboard-page hotkeys ───────────────────────────────────────
    if (onScoreboard)
    {
      // Q : Exit the court
      if (key === "q" || key === "Q")
      {
        elements.backBtn.click();
        return;
      }

      // R : Reset court
      if (key === "r" || key === "R")
      {
        if (!session.isSpectating)
        {
          e.preventDefault();
          // Open settings modal to the reset tile
          elements.settingsBtn.click();
        }
        return;
      }

      // U : Undo
      if (key === "u" || key === "U")
      {
        if (!session.isSpectating) elements.undoBtn.click();
        return;
      }

      // M : Mute / unmute
      if (key === "m" || key === "M")
      {
        if (!session.isSpectating) elements.muteBtn.click();
        return;
      }

      // S : Switch / swap sides
      if (key === "s" || key === "S")
      {
        elements.swapBtn.click();
        return;
      }

      // A / 1 : Add point for Team A
      if ((key === "a" || key === "A" || key === "1") && !session.isSpectating)
      {
        addPoint(EVENT_TYPES.POINT_TEAM_A);
        return;
      }

      // B / 2 : Add point for Team B
      if ((key === "b" || key === "B" || key === "2") && !session.isSpectating)
      {
        addPoint(EVENT_TYPES.POINT_TEAM_B);
        return;
      }

      // W : Toggle waves
      if (key === "w" || key === "W")
      {
        toggleWaves();
        return;
      }

      // O : Open settings
      if (key === "o" || key === "O")
      {
        elements.settingsBtn.click();
        return;
      }

      // D : Open match details
      if (key === "d" || key === "D")
      {
        e.preventDefault();
        elements.detailsBtn.click();
        return;
      }
    }
  });
}
