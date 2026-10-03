// ESLint configuration for the browser frontend (app/js). The Cloud Functions
// package has its own configuration in functions/eslint.config.mjs; ESLint
// resolves the nearest configuration for each linted file.
//
// Run with: npm run lint:frontend --prefix functions
const browserGlobals = Object.fromEntries(
  [
    "window", "document", "navigator", "location", "history", "localStorage", "sessionStorage",
    "console", "setTimeout", "clearTimeout", "setInterval", "clearInterval",
    "requestAnimationFrame", "cancelAnimationFrame", "getComputedStyle", "performance", "fetch",
    "MutationObserver", "ResizeObserver", "HTMLElement", "Element", "Node", "Event", "CustomEvent",
    "KeyboardEvent", "File", "Blob", "URL", "Image", "TextDecoder", "TextEncoder", "Path2D",
    "NDEFReader", "structuredClone", "alert", "globalThis",
  ].map((name) => [name, "readonly"]),
);

export default [
  {
    ignores: ["**/*.min.js", "app/js/firebase-config.js", "functions/**", "**/node_modules/**"],
  },
  {
    files: ["app/js/**/*.js", "app/js/**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: browserGlobals,
    },
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
    rules: {
      // Every identifier must be declared or imported: this is what guarantees
      // the module boundaries are explicit.
      "no-undef": "error",
      "no-unused-vars": ["warn", { args: "none", caughtErrors: "none" }],
      "no-constant-condition": ["error", { checkLoops: false }],
      "no-debugger": "error",
      "no-duplicate-case": "error",
      "no-unreachable": "error",
      "no-import-assign": "error",
    },
  },
];
