export function setButtonIcon(button, name) {
  if (!button) return;

  const icon = document.createElement("span");
  icon.className = `icon icon--${name}`;
  icon.setAttribute("aria-hidden", "true");
  button.replaceChildren(icon);
}
