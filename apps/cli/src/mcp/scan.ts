// Shared scanning primitive for the MCP surface.
//
// The CLI's `scan` command does more than we want here (renders, exits with
// non-zero on findings, prints ANSI). This module keeps only the parts the
// MCP tools need: walk a directory, run the static engine, return a plain
// JSON-shaped Finding[] the LLM can reason about.
//
// Both `scan_path` (real filesystem, walks .gitignore) and `scan_snippet`
// (synthetic single-file input) go through the same detection pipeline so
// results are consistent.

import fs from "node:fs/promises";
import path from "node:path";
import {
  detectSecrets,
  shouldScanPath,
  discoverEdgeFunctions,
  type SecretFinding,
  type DiscoveredEdgeFunction,
  type SourceFile,
} from "@kelp/core";
import { walk } from "../walk.js";
import { detectVerifyJwt, type VerifyJwtFinding } from "../checks/verify-jwt.js";

const MAX_FILE_BYTES = 1_000_000;

/** Plain JSON shape a caller (LLM or otherwise) can consume without imports. */
export interface McpFinding {
  ruleId: string;
  title: string;
  provider?: string;
  severity: "critical" | "high" | "medium" | "low";
  path: string;
  line: number;
  preview?: string;
  confidence?: "high" | "medium";
  clientSide?: boolean;
  class: "secret" | "auth" | "rls" | "edge-fn" | "misc";
}

export interface ScanSummary {
  filesScanned: number;
  filesSkipped: { oversize: number; unreadable: number };
  applied: {
    secrets: boolean;
    supabaseConfigVerifyJwt: boolean;
    edgeFnRecon: boolean;
  };
  discoveredEdgeFunctions: DiscoveredEdgeFunction[];
  findings: McpFinding[];
  durationMs: number;
}

/** Walk + read + detect, all in one call. */
export async function scanPath(root: string): Promise<ScanSummary> {
  const abs = path.resolve(root);
  const startedAt = Date.now();

  let stat;
  try {
    stat = await fs.stat(abs);
  } catch {
    throw new Error(`path not found: ${root}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`not a directory: ${root}`);
  }

  const walked = await walk(abs);
  const candidates = walked.filter((p) => shouldScanPath(path.relative(abs, p)));

  const files: SourceFile[] = [];
  let oversize = 0;
  let unreadable = 0;
  for (const p of candidates) {
    try {
      const s = await fs.stat(p);
      if (s.size > MAX_FILE_BYTES) {
        oversize++;
        continue;
      }
      const content = await fs.readFile(p, "utf8");
      files.push({ path: path.relative(abs, p), content });
    } catch {
      unreadable++;
    }
  }

  return detectAll(files, { startedAt, oversize, unreadable });
}

/** Detect over an in-memory SourceFile[]. Used by scan_snippet and reused
 *  by scanPath. Kept pure so it is trivially unit-testable. */
export function scanFiles(files: readonly SourceFile[]): ScanSummary {
  return detectAll([...files], { startedAt: Date.now(), oversize: 0, unreadable: 0 });
}

function detectAll(
  files: SourceFile[],
  meta: { startedAt: number; oversize: number; unreadable: number },
): ScanSummary {
  const secrets: SecretFinding[] = detectSecrets(files);

  const hasSupabaseConfig = files.some((f) => /supabase\/config\.toml$/i.test(f.path));
  const verifyJwt: VerifyJwtFinding[] = hasSupabaseConfig ? detectVerifyJwt(files) : [];

  const hasEdgeFns = files.some((f) => /supabase\/functions\//i.test(f.path));
  const edgeFns: DiscoveredEdgeFunction[] = hasEdgeFns ? discoverEdgeFunctions(files) : [];

  const findings: McpFinding[] = [
    ...secrets.map<McpFinding>((f) => ({
      ruleId: f.ruleId,
      title: f.title,
      provider: f.provider,
      severity: f.severity,
      path: f.path,
      line: f.line,
      preview: f.preview,
      confidence: f.confidence,
      clientSide: f.clientSide,
      class: "secret",
    })),
    ...verifyJwt.map<McpFinding>((f) => ({
      ruleId: f.ruleId,
      title: f.title,
      severity: f.severity,
      path: f.path,
      line: f.line,
      class: "edge-fn",
    })),
  ];

  // Findings are already deterministic. Sort by severity so the LLM sees
  // the most urgent one first.
  const order: Record<McpFinding["severity"], number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);

  return {
    filesScanned: files.length,
    filesSkipped: { oversize: meta.oversize, unreadable: meta.unreadable },
    applied: {
      secrets: true,
      supabaseConfigVerifyJwt: hasSupabaseConfig,
      edgeFnRecon: hasEdgeFns,
    },
    discoveredEdgeFunctions: edgeFns,
    findings,
    durationMs: Date.now() - meta.startedAt,
  };
}
