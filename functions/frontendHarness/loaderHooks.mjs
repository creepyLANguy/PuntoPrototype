// Node module customization hooks that redirect the browser-only imports used
// by app/js/script.js (Firebase CDN URLs, esm.sh, generated firebase-config.js)
// to local mocks so the real frontend can run under node:test + jsdom.
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const mocksDir = path.dirname(fileURLToPath(import.meta.url));

function mockUrl(fileName)
{
  return pathToFileURL(path.join(mocksDir, "mocks", fileName)).href;
}

const urlMap = new Map([
  ["https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js", mockUrl("firebase-app.mjs")],
  ["https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js", mockUrl("firebase-firestore.mjs")],
  ["https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js", mockUrl("firebase-functions.mjs")],
  ["https://esm.sh/html-to-image@1.11.13", mockUrl("html-to-image.mjs")]
]);

export async function resolve(specifier, context, nextResolve)
{
  if (urlMap.has(specifier))
  {
    return { url: urlMap.get(specifier), shortCircuit: true };
  }

  if (specifier === "./firebase-config.js" && context.parentURL?.includes("/app/js/"))
  {
    return { url: mockUrl("firebase-config.mjs"), shortCircuit: true };
  }

  return nextResolve(specifier, context);
}
