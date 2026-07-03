// Worker package entry. Exports the scan engine API consumed by the web app's
// server actions (connect flow, run-scan), plus the queue types.
//
// A production deployment also runs this as a persistent process polling the
// queue; locally the web app drives scans inline via the exported functions.

export { processOneScan, drainScans, runScanForProject } from "./scan-processor.js";
export {
  listReposForOrg,
  listSupabaseProjects,
  createProjectAndEnqueueScan,
  enqueueScanForProject,
  getGithubInstallUrl,
  verifyInstallState,
  registerGithubInstallation,
} from "./api.js";
export { putCredential } from "./db.js";
export { openSecretFixPr } from "./fix-pr.js";
export type { SecretFixPrResult } from "./fix-pr.js";
export type { SupabaseProjectInfo, ConnectInput, RepoOption } from "./api.js";
export { InMemoryQueue } from "./queue.js";
export type { ScanJob, ScanQueue } from "./queue.js";

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

if (import.meta.url === `file://${process.argv[1]}`) {
  void pollLoop();
}
