// Worker package entry. Exports the scan engine API consumed by the web app's
// server actions (connect flow, run-scan), plus the queue types.
//
// A production deployment also runs this as a persistent process polling the
// queue; locally the web app drives scans inline via the exported functions.

export { processOneScan, drainScans, runScanForProject } from "./scan-processor.js";
export {
  listReposForOrg,
  listSupabaseProjects,
  validateSupabaseReadonlyConnString,
  getProjectConfigStatus,
  detectAndStoreSupabaseBackend,
  createProjectAndEnqueueScan,
  enqueueScanForProject,
  getGithubInstallUrl,
  verifyInstallState,
  registerGithubInstallation,
} from "./api.js";
export {
  putCredential,
  getCredential,
  findProjectByRepo,
  loadActiveTestConsent,
  saveActiveTestConsent,
  revokeActiveTestConsent,
  monthToDateCampaignCostCents,
  loadOrgPlan,
  countProjectsForOrg,
  setAppBaseUrl,
  setSupabaseProjectRef,
  findUserEmail,
  findOrgName,
  expireStuckScans,
  markFindingResolvedByUser,
  pickWebhookRescanClasses,
  hasLiveScan,
} from "./db.js";
export type { StoredActiveTestConsent } from "./db.js";
export { openSecretFixPr } from "./fix-pr.js";
export type { SecretFixPrResult } from "./fix-pr.js";
export type { SupabaseProjectInfo, ConnectInput, RepoOption, ProjectConfigStatus } from "./api.js";
export { analyzeAndStoreBackendReport, loadBackendReport } from "./api.js";
export { InMemoryQueue } from "./queue.js";
export type { ScanJob, ScanQueue } from "./queue.js";
export {
  enqueueScanJob,
  startScanWorker,
  closeScanQueue,
  redisEnabled,
} from "./redis-queue.js";
export { processScanById } from "./scan-processor.js";
export { processFreeScan, parseRepoFullName } from "./free-scan-processor.js";
export { verifyPublicRepo, PublicRepoNotFoundError, listPublicRepoSourceFiles } from "./connectors/github-public.js";
export {
  insertFreeScan,
  countRecentFreeScansForIp,
  findLatestFreeScanForRepo,
  getFreeScanById,
  getFreeScanBySlug,
  captureFreeScanEmail,
} from "./free-scan-db.js";
export type { FreeScanPublicView } from "./free-scan-db.js";
export {
  loadFindingForChat,
  loadOrCreateConversation,
  appendConversationTurn,
} from "./db.js";
export type { FindingForChat, ConversationRow } from "./db.js";
export {
  startCheckoutForOrg,
  verifyWebhookSignature as verifyStripeWebhookSignature,
  handleWebhookEvent as handleStripeWebhookEvent,
  stripeConfigured,
  StripeNotConfiguredError,
  tierForPrice,
} from "./stripe.js";
export type { CheckoutInput } from "./stripe.js";

async function pollLoop() {
  const { processOneScan } = await import("./scan-processor.js");
  console.log("Kelp worker: polling for queued scans (Ctrl+C to stop)…");
  for (;;) {
    try {
      const r = await processOneScan();
      if (!r.processed) await new Promise((res) => setTimeout(res, 3000));
    } catch (e) {
      console.error("scan error:", e instanceof Error ? e.message : e);
    }
  }
}

/**
 * Production entry (issue #7): if REDIS_URL is set, consume scans from BullMQ
 * and run a light reconciler that re-delivers any 'queued' rows that never
 * reached Redis (idempotent — jobId = scanId de-dupes). Otherwise fall back
 * to the DB poll loop (local dev / no Redis).
 */
async function main() {
  const { startScanWorker, enqueueScanJob, closeScanQueue, redisEnabled } =
    await import("./redis-queue.js");
  if (!redisEnabled()) {
    await pollLoop();
    return;
  }

  const worker = await startScanWorker();
  console.log("Kelp worker: consuming scans via Redis (BullMQ)…");

  const { listQueuedScanIds } = await import("./db.js");
  const reconcile = setInterval(() => {
    void (async () => {
      try {
        for (const id of await listQueuedScanIds()) await enqueueScanJob(id);
      } catch (e) {
        console.error("reconcile error:", e instanceof Error ? e.message : e);
      }
    })();
  }, 15000);

  const shutdown = async () => {
    clearInterval(reconcile);
    try {
      if (worker) await worker.close();
      await closeScanQueue();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
