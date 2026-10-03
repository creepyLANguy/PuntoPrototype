// DOM predicates shared across modules.
export function isElementVisible(el)
{
  return Boolean(el) && window.getComputedStyle(el).display !== "none";
}

export function isOverlayVisible(el)
{
  return Boolean(el) && !el.classList.contains("hidden");
}

export function isTextInputElement(el)
{
  if (!el || !(el instanceof HTMLElement)) return false;
  const tagName = el.tagName.toLowerCase();
  if (tagName === "textarea" || el.isContentEditable) return true;
  if (tagName === "input")
  {
    const type = (el.getAttribute("type") || "text").toLowerCase();
    const nonTextTypes = [
      "button", "checkbox", "color", "file", "hidden",
      "image", "radio", "range", "reset", "submit"
    ];
    return !nonTextTypes.includes(type);
  }
  return false;
}
