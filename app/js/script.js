// Compatibility entry point. app/index.html loads js/main.js directly; this
// module only exists so that a page cached before the modular frontend was
// deployed (which still requests js/script.js) boots the current application
// instead of failing. It must never contain application code: the structure
// check (scripts/check-frontend-structure.mjs) enforces that.
import "./main.js";
