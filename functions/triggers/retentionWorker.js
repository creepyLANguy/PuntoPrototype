const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { runRetentionWorker } = require("../services/retentionService");
const { REGION } = require("../services/constants");
const { JOBS_COLLECTION } = require("../services/retentionConfig");

const TIMEOUT_SECONDS = 540;
// Leave headroom before the function timeout so the last step can commit.
const WORK_BUDGET_MS = 420 * 1000;

function runWithBudget() {
  return runRetentionWorker({ deadlineMs: Date.now() + WORK_BUDGET_MS });
}

// Starts work as soon as an allocation opens a cull job.
exports.onRetentionJobCreated = onDocumentCreated(
  {
    document: `${JOBS_COLLECTION}/{jobId}`,
    region: REGION,
    timeoutSeconds: TIMEOUT_SECONDS,
    retry: false,
  },
  () => runWithBudget(),
);

// Resumes any unfinished job (expired lease, crash, long cull) every minute.
exports.idRetentionWorker = onSchedule(
  {
    schedule: "every 1 minutes",
    region: REGION,
    timeoutSeconds: TIMEOUT_SECONDS,
    maxInstances: 1,
  },
  () => runWithBudget(),
);
