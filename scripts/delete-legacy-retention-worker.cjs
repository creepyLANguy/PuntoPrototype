const path = require("node:path");
const { createRequire } = require("node:module");

const firebaseToolsRoot = process.env.FIREBASE_TOOLS_ROOT;
if (!firebaseToolsRoot) {
  throw new Error("FIREBASE_TOOLS_ROOT is required");
}

const requireFirebaseTools = createRequire(
  path.join(firebaseToolsRoot, "package.json"),
);
const auth = requireFirebaseTools("./lib/auth");
const api = requireFirebaseTools("./lib/api");
const cloudfunctionsv2 = requireFirebaseTools("./lib/gcp/cloudfunctionsv2");
const poller = requireFirebaseTools("./lib/operation-poller");

const projectId = process.env.FIREBASE_PROJECT_ID;
const refreshToken = process.env.FIREBASE_TOKEN;
if (!projectId || !refreshToken) {
  throw new Error("FIREBASE_PROJECT_ID and FIREBASE_TOKEN are required");
}

async function deleteLegacyRetentionWorker() {
  auth.setRefreshToken(refreshToken);

  const functionName = `projects/${projectId}/locations/africa-south1/functions/idRetentionWorker`;
  let operation;
  try {
    operation = await cloudfunctionsv2.deleteFunction(functionName);
  } catch (error) {
    if (error.status === 404) {
      return;
    }
    throw error;
  }

  await poller.pollOperation({
    apiOrigin: api.functionsV2Origin(),
    apiVersion: cloudfunctionsv2.API_VERSION,
    masterTimeout: 25 * 60 * 1000,
    maxBackoff: 10000,
    pollerName: "delete-legacy-retention-worker",
    operationResourceName: operation.name,
  });
}

deleteLegacyRetentionWorker().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
