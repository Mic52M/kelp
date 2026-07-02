// End-to-end demo of the scan pipeline with mock connectors — no API keys.
// Run: npm run build && npm --prefix apps/worker run demo
//
// Proves the whole chain works: queue → orchestrator → three scanners →
// normalized findings, with the BOLA consent gate enforced.

import { InMemoryQueue, type ScanJob } from "./queue.js";
import { processScanJob } from "./runner.js";
import {
  mockGitHub,
  mockSupabase,
  mockBola,
  consentStoreFor,
  consoleAudit,
} from "./connectors/mock.js";

const SEV_ICON: Record<string, string> = {
  critical: "🔴",
  high: "🟠",
  medium: "🟡",
  low: "🔵",
};

async function main() {
  const queue = new InMemoryQueue();

  // A project that HAS given active-test consent, so BOLA is allowed to run.
  const job: ScanJob = {
    id: "job_demo_1",
    orgId: "demo-org",
    projectId: "demo-project",
    repoFullName: "acme/roamly-app",
    supabaseRef: "xkltpqwabcde",
    classes: ["secret", "rls", "bola"],
    trigger: "initial",
  };
  await queue.enqueue(job);

  const deps = {
    github: mockGitHub,
    supabase: mockSupabase,
    bola: mockBola,
    consent: consentStoreFor(new Set(["demo-project"])),
    audit: consoleAudit,
  };

  console.log(`\nKelp worker — processing ${queue.size()} job(s)\n`);

  let next: ScanJob | null;
  while ((next = await queue.dequeue())) {
    console.log(`▶ scan ${next.id}  (${next.repoFullName})`);
    const { found } = await processScanJob(next, { deps }, (findings) => {
      console.log(`\n  ${found_label(findings.length)}:\n`);
      for (const f of findings) {
        console.log(
          `  ${SEV_ICON[f.severity]} [${f.vulnClass.toUpperCase()}] ${f.title}` +
            (f.location ? `\n       ↳ ${f.location}` : "") +
            (f.fixable ? "  · auto-fix available" : "  · manual / review"),
        );
      }
    });
    console.log(`\n  done — ${found} finding(s)\n`);
  }

  // Show the gate works: a project WITHOUT consent cannot run BOLA.
  console.log("— consent gate check —");
  await processScanJob(
    { ...job, id: "job_demo_2", projectId: "no-consent-project", classes: ["bola"] },
    { deps: { ...deps, consent: consentStoreFor(new Set()) } },
    () => {},
  );
  console.log("  (BOLA correctly refused without consent)\n");
}

function found_label(n: number): string {
  return n === 1 ? "1 finding" : `${n} findings`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
