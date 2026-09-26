// `kelp scan <path>` — full transparent scan.
//
// v0.2.2 opens up what Kelp is actually doing. Every check that runs
// prints its name + rule count. Every check that CAN'T run (because it
// needs a live target, e.g. RLS probing) is listed too, so the empty
// output doesn't feel like a lie. Real findings are still evidence — no
// change to what we call a finding.

import fs from "node:fs/promises";
import path from "node:path";
import {
  detectSecrets,
  shouldScanPath,
  discoverEdgeFunctions,
  parseSqlMigrations,
  analyzeDeep,
  analyzeStorageAcl,
  analyzeNextjsRoutes,
  analyzeFirebaseRules,
  analyzeClientEnv,
  type SecretFinding,
  type DiscoveredEdgeFunction,
  type StorageAclFinding,
  type NextjsRouteFinding,
  type FirebaseRuleFinding,
  type ClientEnvFinding,
  type Severity,
  type SourceFile,
} from "@kelp/core";
import { walk } from "../walk.js";
import { detectVerifyJwt, type VerifyJwtFinding } from "../checks/verify-jwt.js";
import { loadConfig } from "../config.js";
import { renderReport } from "../output/report.js";

import type { Depth } from "../agent/depth.js";

interface ScanOptions {
  path: string;
  json: boolean;
  minSeverity: string | null;
  verbose: boolean;
  version: string;
  runAgentAfter?: boolean;
  staticOnly?: boolean;
  noStatic?: boolean;
  agentDepth?: Depth | null;
  model?: string;
  maxCostCents?: number;
  maxIterations?: number;
  focus?: readonly string[] | null;
  observations?: boolean;
  dryRun?: boolean;
  reportPath?: string | null;
  squad?: boolean;
}

const SEV_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const MAX_FILE_BYTES = 1_000_000;

// Unified finding shape for output. Preserves everything a downstream tool
// (or the hosted app) needs to dedup + display.
export interface Finding {
  fingerprint: string;
  ruleId: string;
  title: string;
  severity: Severity;
  path: string;
  line: number;
  preview?: string;
  provider?: string;
  confidence?: "high" | "medium";
  clientSide?: boolean;
  source:
    | "secrets"
    | "supabase-config"
    | "rls-sql"
    | "storage-acl"
    | "nextjs-routes"
    | "firebase-rules"
    | "client-env"
    | "agent";
}

function isSeverity(v: string): v is Severity {
  return v === "critical" || v === "high" || v === "medium" || v === "low";
}

function progress(msg: string, verbose: boolean): void {
  if (verbose) process.stderr.write(`  · ${msg}\n`);
}

export async function runScan(opts: ScanOptions): Promise<void> {
  const abs = path.resolve(opts.path);

  let stat;
  try {
    stat = await fs.stat(abs);
  } catch {
    process.stderr.write(`kelp scan: path not found: ${opts.path}\n`);
    process.exit(2);
  }
  if (!stat.isDirectory()) {
    process.stderr.write(`kelp scan: ${opts.path} is not a directory\n`);
    process.exit(2);
  }

  if (opts.minSeverity && !isSeverity(opts.minSeverity)) {
    process.stderr.write(
      `kelp scan: invalid --severity value "${opts.minSeverity}". ` +
        `Use critical, high, medium, or low.\n`,
    );
    process.exit(2);
  }

  const config = loadConfig();
  const startedAt = Date.now();

  // ── walk ────────────────────────────────────────────────────────────
  progress(`walking ${abs}`, opts.verbose);
  const allPaths = await walk(abs);
  const candidatePaths = allPaths.filter((p) => shouldScanPath(path.relative(abs, p)));
  progress(`${allPaths.length} paths walked, ${candidatePaths.length} eligible`, opts.verbose);

  // ── read ────────────────────────────────────────────────────────────
  const files: SourceFile[] = [];
  let skippedBig = 0;
  let skippedUnreadable = 0;
  for (const p of candidatePaths) {
    try {
      const s = await fs.stat(p);
      if (s.size > MAX_FILE_BYTES) {
        skippedBig++;
        continue;
      }
      const content = await fs.readFile(p, "utf8");
      files.push({ path: path.relative(abs, p), content });
    } catch {
      skippedUnreadable++;
    }
  }
  progress(
    `${files.length} read, ${skippedBig} skipped (>1MB), ${skippedUnreadable} unreadable`,
    opts.verbose,
  );

  // ── checks ──────────────────────────────────────────────────────────
  // Every check emits its own step so the caller sees what actually ran,
  // and a `ranOn`/`applicable` flag so we can say "n/a — no config.toml"
  // instead of pretending we scanned something we didn't.

  // --no-static skips the static phase entirely (agent-only run).
  const runStatic = !opts.noStatic;
  progress(
    runStatic
      ? "running SEC-001 (secret patterns + entropy)"
      : "skipping static checks (--no-static)",
    opts.verbose,
  );
  const secretFindings: SecretFinding[] = runStatic ? detectSecrets(files) : [];

  const hasSupabaseConfig = runStatic && files.some((f) => /supabase\/config\.toml$/i.test(f.path));
  progress(
    `running EDGE-003 (verify_jwt=false in supabase/config.toml) — ${hasSupabaseConfig ? "applicable" : "n/a"}`,
    opts.verbose,
  );
  const verifyJwtFindings: VerifyJwtFinding[] = hasSupabaseConfig
    ? detectVerifyJwt(files)
    : [];

  const hasEdgeFns = runStatic && files.some((f) => /supabase\/functions\//i.test(f.path));
  progress(
    `running edge-fn recon (informational) — ${hasEdgeFns ? "applicable" : "n/a"}`,
    opts.verbose,
  );
  const edgeFns: DiscoveredEdgeFunction[] = hasEdgeFns
    ? discoverEdgeFunctions(files)
    : [];

  // Static RLS + Storage ACL analysis over the repo's SQL migrations. Both
  // share one parse of supabase/migrations/*.sql, so it's a single cost.
  // The parser returns an empty snapshot on repos without migrations, so we
  // gate on a cheap path check first to keep the CHECKS output honest
  // (applicable vs n/a) rather than always claiming to have run.
  const hasSchemaSql =
    runStatic &&
    files.some(
      (f) =>
        /\.sql$/i.test(f.path) &&
        (/(?:^|\/)supabase\//i.test(f.path) || /(?:^|\/)migrations\//i.test(f.path)),
    );
  progress(
    `running RLS-DEEP + STORAGE (static, over supabase/migrations/*.sql) — ${hasSchemaSql ? "applicable" : "n/a"}`,
    opts.verbose,
  );
  const schemaSnapshot = hasSchemaSql ? parseSqlMigrations(files) : null;
  // analyzeDeep returns the base RLS findings and the three deep graph checks
  // as one union; both carry issue/schema/table/severity, which is all the
  // mapping below needs.
  const rlsDeepFindings: ReturnType<typeof analyzeDeep> = schemaSnapshot
    ? analyzeDeep(schemaSnapshot)
    : [];
  const storageFindings: StorageAclFinding[] = schemaSnapshot
    ? analyzeStorageAcl(schemaSnapshot)
    : [];

  // Static analysis of Next.js route handlers + server actions. The scanner
  // self-filters to app/**/route.* , pages/api/** , and "use server" files,
  // so it's safe to run over the whole set; the applicable flag just tells
  // the report whether the target even has routes to look at.
  const hasRoutes =
    runStatic &&
    files.some(
      (f) =>
        /(?:^|\/)app\/(?:.*\/)?route\.[tj]sx?$/i.test(f.path) ||
        /(?:^|\/)pages\/api\/.+\.[tj]sx?$/i.test(f.path) ||
        (/\.[tj]sx?$/i.test(f.path) && /["']use server["']/.test(f.content)),
    );
  progress(
    `running ROUTE-AUTH (static, Next.js route + server-action auth checks) — ${hasRoutes ? "applicable" : "n/a"}`,
    opts.verbose,
  );
  const routeFindings: NextjsRouteFinding[] = runStatic ? analyzeNextjsRoutes(files) : [];

  // Static Firebase Security Rules analysis (Firestore + Storage .rules).
  // Self-filters to *.rules files, so it's cheap to run over the whole set.
  const hasRulesFiles = runStatic && files.some((f) => /\.rules$/i.test(f.path));
  progress(
    `running FIREBASE (static, Firestore + Storage security rules) — ${hasRulesFiles ? "applicable" : "n/a"}`,
    opts.verbose,
  );
  const firebaseFindings: FirebaseRuleFinding[] = runStatic ? analyzeFirebaseRules(files) : [];

  // Backend secrets exposed to the browser via a public env-var prefix
  // (NEXT_PUBLIC_/VITE_/... + SERVICE_ROLE/SECRET/...). Runs over all source.
  progress(
    `running CLIENT-ENV (static, public-prefixed backend secrets) — ${runStatic ? "applicable" : "n/a"}`,
    opts.verbose,
  );
  const clientEnvFindings: ClientEnvFinding[] = runStatic ? analyzeClientEnv(files) : [];

  // ── merge + filter + sort ───────────────────────────────────────────
  let findings: Finding[] = [
    ...secretFindings.map<Finding>((f) => ({
      fingerprint: f.fingerprint,
      ruleId: f.ruleId,
      title: f.title,
      severity: f.severity,
      path: f.path,
      line: f.line,
      preview: f.preview,
      provider: f.provider,
      confidence: f.confidence,
      clientSide: f.clientSide,
      source: "secrets",
    })),
    ...verifyJwtFindings.map<Finding>((f) => ({
      fingerprint: f.fingerprint,
      ruleId: f.ruleId,
      title: f.title,
      severity: f.severity,
      path: f.path,
      line: f.line,
      source: "supabase-config",
    })),
    // Schema-level findings have no file:line — they live in the graph the
    // migrations describe. We surface the schema object as the location
    // (schema.table for RLS, the bucket/objects target for storage) so the
    // report still points somewhere actionable.
    ...rlsDeepFindings.map<Finding>((f) => ({
      fingerprint: f.fingerprint,
      ruleId: f.issue,
      title: f.title,
      severity: f.severity,
      path: `${f.schema}.${f.table}`,
      line: 1,
      confidence: "medium" as const,
      source: "rls-sql",
    })),
    ...storageFindings.map<Finding>((f) => ({
      fingerprint: f.fingerprint,
      ruleId: f.issue,
      title: f.title,
      severity: f.severity,
      path: f.bucketId ? `storage.buckets/${f.bucketId}` : "storage.objects",
      line: 1,
      source: "storage-acl",
    })),
    ...routeFindings.map<Finding>((f) => ({
      fingerprint: f.fingerprint,
      ruleId: f.issue,
      title: f.title,
      severity: f.severity,
      path: f.path,
      line: f.line,
      confidence: f.confidence,
      source: "nextjs-routes",
    })),
    ...firebaseFindings.map<Finding>((f) => ({
      fingerprint: f.fingerprint,
      ruleId: f.issue,
      title: f.title,
      severity: f.severity,
      path: f.path,
      line: f.line,
      confidence: f.confidence,
      source: "firebase-rules",
    })),
    ...clientEnvFindings.map<Finding>((f) => ({
      fingerprint: f.fingerprint,
      ruleId: f.ruleId,
      title: f.title,
      severity: f.severity,
      path: f.path,
      line: f.line,
      confidence: f.confidence,
      source: "client-env",
    })),
  ];

  if (opts.minSeverity) {
    const min = opts.minSeverity as Severity;
    findings = findings.filter((f) => SEV_ORDER[f.severity] <= SEV_ORDER[min]);
  }
  findings.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);

  const durationMs = Date.now() - startedAt;

  if (opts.json && !opts.runAgentAfter) {
    // JSON mode + no agent: emit and exit right away. Agent-augmented
    // JSON is handled after the agent runs so the payload includes both
    // static and agent findings.
    emitJson({
      opts,
      abs,
      files,
      skippedBig,
      skippedUnreadable,
      secretsCount: secretFindings.length,
      hasSupabaseConfig,
      verifyJwtCount: verifyJwtFindings.length,
      hasEdgeFns,
      edgeFns,
      hasSchemaSql,
      rlsDeepCount: rlsDeepFindings.length,
      storageCount: storageFindings.length,
      hasRoutes,
      routeCount: routeFindings.length,
      hasRulesFiles,
      firebaseCount: firebaseFindings.length,
      runStatic,
      clientEnvCount: clientEnvFindings.length,
      durationMs,
      findings,
    });
    process.exit(findings.length === 0 ? 0 : 1);
  }

  if (!opts.json) {
    renderReport({
      version: opts.version,
      target: opts.path,
      filesScanned: files.length,
      pathsWalked: allPaths.length,
      checks: {
        secretsApplicable: true,
        supabaseConfigApplicable: hasSupabaseConfig,
        edgeFnReconApplicable: hasEdgeFns,
        schemaSqlApplicable: hasSchemaSql,
        routesApplicable: hasRoutes,
        firebaseRulesApplicable: hasRulesFiles,
        clientEnvApplicable: runStatic,
      },
      findings,
      edgeFns,
      durationMs,
      config,
    });
  }

  // ── agent mode (opt-in, requires API key) ──────────────────────────
  let agentFindings: Finding[] = [];
  let agentObservations: string[] = [];
  let agentInfo: {
    costUsdCents: number;
    iterations: number;
    durationMs: number;
    aborted: string | null;
    model: string;
    coverage: { filesRead: number; grepsRun: number; listsRun: number };
  } | null = null;

  if (opts.runAgentAfter) {
    if (!config.anthropicApiKey) {
      process.stderr.write(
        "\nkelp scan --agent: no ANTHROPIC_API_KEY found. " +
          "Set it in your env or write ~/.config/kelp/config.json — run `kelp config` for details.\n",
      );
      process.exit(2);
    }
    const { runAgentScan } = await import("./scan-agent.js");
    const r = await runAgentScan({
      target: abs,
      apiKey: config.anthropicApiKey,
      depth: opts.agentDepth,
      model: opts.model,
      maxCostCents: opts.maxCostCents,
      maxIterations: opts.maxIterations,
      focus: opts.focus,
      observations: opts.observations,
      dryRun: opts.dryRun,
      squad: opts.squad,
    });
    agentInfo = {
      costUsdCents: r.costUsdCents,
      iterations: r.iterations,
      durationMs: r.durationMs,
      aborted: r.aborted,
      model: r.model,
      coverage: r.coverage,
    };
    agentObservations = r.observations;
    agentFindings = r.findings.map<Finding>((f) => ({
      fingerprint: `agent-${f.ruleId}-${f.path}-${f.line ?? 0}`,
      ruleId: f.ruleId,
      title: f.title,
      severity: f.severity,
      path: f.path,
      line: f.line ?? 1,
      source: "agent",
    }));
  }

  const merged: Finding[] = [...findings, ...agentFindings];

  if (opts.json) {
    emitJson({
      opts,
      abs,
      files,
      skippedBig,
      skippedUnreadable,
      secretsCount: secretFindings.length,
      hasSupabaseConfig,
      verifyJwtCount: verifyJwtFindings.length,
      hasEdgeFns,
      edgeFns,
      hasSchemaSql,
      rlsDeepCount: rlsDeepFindings.length,
      storageCount: storageFindings.length,
      hasRoutes,
      routeCount: routeFindings.length,
      hasRulesFiles,
      firebaseCount: firebaseFindings.length,
      runStatic,
      clientEnvCount: clientEnvFindings.length,
      durationMs: durationMs + (agentInfo?.durationMs ?? 0),
      findings: merged,
      agent: agentInfo,
    });
  } else if (agentInfo) {
    // A proper AGENT section — findings integrated with the static ones
    // + observations if any + cost/iteration summary.
    const { renderAgentSection } = await import("../output/agent-section.js");
    renderAgentSection({
      findings: agentFindings,
      observations: agentObservations,
      costUsdCents: agentInfo.costUsdCents,
      iterations: agentInfo.iterations,
      durationMs: agentInfo.durationMs,
      aborted: agentInfo.aborted,
      model: agentInfo.model,
      coverage: agentInfo.coverage,
    });
  }

  if (opts.reportPath) {
    const { writeReport } = await import("../report/writer.js");
    await writeReport(opts.reportPath, {
      version: opts.version,
      target: opts.path,
      scannedAt: new Date(),
      filesScanned: files.length,
      durationMs: durationMs + (agentInfo?.durationMs ?? 0),
      findings: merged,
      agent: agentInfo
        ? {
            ran: true,
            model: agentInfo.model,
            iterations: agentInfo.iterations,
            costUsdCents: agentInfo.costUsdCents,
            durationMs: agentInfo.durationMs,
            aborted: agentInfo.aborted,
            observations: agentObservations,
            coverage: agentInfo.coverage,
          }
        : null,
    });
    if (!opts.json) {
      process.stdout.write(`\n  ${"·"} report written to ${opts.reportPath}\n\n`);
    }
  }

  process.exit(merged.length === 0 ? 0 : 1);
}

function emitJson(input: {
  opts: ScanOptions;
  abs: string;
  files: SourceFile[];
  skippedBig: number;
  skippedUnreadable: number;
  secretsCount: number;
  hasSupabaseConfig: boolean;
  verifyJwtCount: number;
  hasEdgeFns: boolean;
  edgeFns: DiscoveredEdgeFunction[];
  hasSchemaSql: boolean;
  rlsDeepCount: number;
  storageCount: number;
  hasRoutes: boolean;
  routeCount: number;
  hasRulesFiles: boolean;
  firebaseCount: number;
  runStatic: boolean;
  clientEnvCount: number;
  durationMs: number;
  findings: Finding[];
  agent?: { costUsdCents: number; iterations: number; durationMs: number; aborted: string | null } | null;
}): void {
  const report = {
    version: 2,
    tool: { name: "kelp", version: input.opts.version },
    target: input.abs,
    scannedAt: new Date().toISOString(),
    filesScanned: input.files.length,
    filesSkipped: { oversize: input.skippedBig, unreadable: input.skippedUnreadable },
    checks: {
      secrets: { applicable: true, findings: input.secretsCount },
      supabaseConfigVerifyJwt: {
        applicable: input.hasSupabaseConfig,
        findings: input.verifyJwtCount,
      },
      edgeFnRecon: {
        applicable: input.hasEdgeFns,
        discovered: input.edgeFns.length,
        mutating: input.edgeFns.filter((e) => e.mutating).length,
      },
      rlsSchema: { applicable: input.hasSchemaSql, findings: input.rlsDeepCount },
      storageAcl: { applicable: input.hasSchemaSql, findings: input.storageCount },
      nextjsRoutes: { applicable: input.hasRoutes, findings: input.routeCount },
      firebaseRules: { applicable: input.hasRulesFiles, findings: input.firebaseCount },
      clientEnv: { applicable: input.runStatic, findings: input.clientEnvCount },
      agent: input.agent
        ? {
            ran: true,
            iterations: input.agent.iterations,
            costUsdCents: input.agent.costUsdCents,
            aborted: input.agent.aborted,
          }
        : { ran: false },
    },
    durationMs: input.durationMs,
    findings: input.findings,
  };
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}
