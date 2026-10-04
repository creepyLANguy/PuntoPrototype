// Small DOM builders for the tournament and match pages. Text is always set
// through textContent, so names typed by hosts can never inject markup.

export function h(tag, attributes = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "className") element.className = value;
    else if (key === "dataset") Object.assign(element.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") {
      element.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) element.setAttribute(key, "");
    else element.setAttribute(key, String(value));
  }
  appendChildren(element, children);
  return element;
}

function appendChildren(element, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    element.appendChild(
      child instanceof Node ? child : document.createTextNode(String(child)),
    );
  }
}

export function clear(element) {
  while (element?.firstChild) element.removeChild(element.firstChild);
  return element;
}

export function replaceContent(element, ...children) {
  clear(element);
  appendChildren(element, children);
  return element;
}

// Status chips use the shared vocabulary of spec section 48.2 and carry the
// text label, so state is never colour-only.
export function statusChip(status) {
  const label = String(status || "")
    .toUpperCase()
    .replace(/_/g, " ");
  const tone = label.toLowerCase().replace(/\s+/g, "-");
  return h("span", { className: `chip chip-${tone}` }, label);
}

export function section(title, ...children) {
  return h(
    "section",
    { className: "ev-section" },
    title ? h("h2", { className: "ev-section-title" }, title) : null,
    ...children,
  );
}

export function emptyState(text) {
  return h("p", { className: "ev-empty" }, text);
}

export function formatTime(ms, timezone) {
  if (!ms) return "";
  try {
    return new Date(ms).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: timezone || undefined,
    });
  } catch {
    return new Date(ms).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
}

export function formatDateTime(ms, timezone) {
  if (!ms) return "";
  try {
    return new Date(ms).toLocaleString([], {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: timezone || undefined,
    });
  } catch {
    return new Date(ms).toLocaleString();
  }
}
