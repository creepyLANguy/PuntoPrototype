// Keep the initial rules focused on correctness while Prettier owns formatting and the existing tests remain unchanged.
// This baseline intentionally avoids broad stylistic lint rules while the codebase is normalized.
export default [
  {
    ignores: ["node_modules/**"],
  },
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
    },
    rules: {
      "no-constant-condition": ["error", { checkLoops: false }],
      "no-debugger": "error",
      "no-duplicate-case": "error",
      "no-unreachable": "error",
    },
  },
  {
    files: ["**/*.mjs"],
    languageOptions: {
      sourceType: "module",
    },
  },
];
