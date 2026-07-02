// Worker entrypoint. In production this runs as a persistent process on
// Railway/Fly: it consumes scan jobs from the Redis-backed queue, builds the
// real GitHub/Supabase/BOLA connectors from the project's (decrypted)
// credentials, runs processScanJob, and upserts findings.
//
// The real connectors and the DB-backed queue/consent store require API
// credentials and infrastructure (GITHUB_APP_*, Supabase, REDIS_URL), so this
// entrypoint is intentionally a documented stub until those exist. The scan
// pipeline itself is fully implemented and exercised in demo.ts with mocks.

export { processScanJob } from "./runner.js";
export { InMemoryQueue } from "./queue.js";
export type { ScanJob, ScanQueue } from "./queue.js";

async function main() {
  console.log("Kelp worker: real queue loop not wired yet — needs REDIS_URL and");
  console.log("connector credentials. Run the demo instead: npm run demo");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
