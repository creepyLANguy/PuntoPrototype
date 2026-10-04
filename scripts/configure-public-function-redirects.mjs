import fs from "node:fs";

const projectId = process.env.FIREBASE_PROJECT_ID?.trim();

if (!projectId) {
  throw new Error("FIREBASE_PROJECT_ID is required.");
}

if (!/^[a-z0-9-]+$/.test(projectId)) {
  throw new Error(
    `FIREBASE_PROJECT_ID is not a valid Firebase project ID: ${projectId}`,
  );
}

const firebasePath = "firebase.json";
const firebase = JSON.parse(fs.readFileSync(firebasePath, "utf8"));
const redirects = firebase.hosting?.redirects || [];
const placeholder = "__FIREBASE_PROJECT_ID__";

const publicFunctionNames = new Set([
  "getCourtScore",
  "getCourtScoreRevision",
  "getCourtStats",
  "getCourtMomentum",
]);

const publicRedirects = redirects.filter((redirect) => {
  const destination = String(redirect.destination || "");
  return (
    destination.includes(placeholder) && destination.includes("africa-south1-")
  );
});

// Each public function has a court route (/score/:courtId) and a match route
// (/score/match/:matchId).
const ROUTES_PER_FUNCTION = 2;

if (publicRedirects.length !== publicFunctionNames.size * ROUTES_PER_FUNCTION) {
  throw new Error(
    `Expected ${publicFunctionNames.size * ROUTES_PER_FUNCTION} Johannesburg public-function redirects with the ${placeholder} placeholder; found ${publicRedirects.length}.`,
  );
}

for (const redirect of publicRedirects) {
  redirect.destination = redirect.destination.replaceAll(
    placeholder,
    projectId,
  );
}

fs.writeFileSync(firebasePath, JSON.stringify(firebase, null, 2) + "\n");
console.log(
  `Configured ${publicRedirects.length} public API redirects for Firebase project ${projectId}.`,
);
