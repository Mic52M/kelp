// Report writer — --report out.html or out.md.
//
// Same input shape as the terminal renderer, but instead of printing to
// stdout we write a standalone file the user can open, share, or attach
// to a PR. HTML is the "double-click and see it" format; Markdown is the
// "paste into a PR description" format.

import fs from "node:fs/promises";
import path from "node:path";
import type { Finding } from "../commands/scan.js";

export interface ReportInput {
  version: string;
  target: string;
  scannedAt: Date;
  filesScanned: number;
  durationMs: number;
  findings: readonly Finding[];
  agent?: {
    ran: boolean;
    model: string;
    iterations: number;
    costUsdCents: number;
    durationMs: number;
    aborted: string | null;
    observations: readonly string[];
    coverage?: { filesRead: number; grepsRun: number; listsRun: number };
  } | null;
}

export async function writeReport(outPath: string, input: ReportInput): Promise<void> {
  const abs = path.resolve(outPath);
  const ext = path.extname(abs).toLowerCase();
  const body = ext === ".md" ? renderMarkdown(input) : renderHtml(input);
  await fs.writeFile(abs, body, "utf8");
}

// ── remediation hints per rule ─────────────────────────────────────────
// Short, actionable, one paragraph each. Keyed by ruleId. Unknown rules
// fall through to a generic hint.
const REMEDIATION_EXACT: Record<string, string> = {
  "supabase-config-verify-jwt-false":
    "In supabase/config.toml, set verify_jwt = true for this function (or remove the override to use the default). If the function truly must be public, gate it with a shared secret in the request headers and verify it at the top of the handler.",
  "supabase-service-role":
    "This is a service-role key — treat it as compromised the moment it's in a repo. Rotate it in the Supabase dashboard immediately, move the new value into a server-only env var, and never ship it to the browser bundle.",
  "jwt-exposed":
    "Rotate the JWT-issuing secret. Any token minted with the exposed key is untrusted. Move signing keys out of source and behind a server-only env var.",
  "high-entropy-string":
    "This looks like a secret by entropy — inspect it. If it is a credential, rotate at the provider and move to an env var. If it is a legitimate hash or nonce, add it to your ignore list.",
};

function remediationFor(ruleId: string): string {
  if (REMEDIATION_EXACT[ruleId]) return REMEDIATION_EXACT[ruleId]!;
  // Generic bucket for any provider secret (rule id conventionally
  // ends in "-secret" or "-key" or starts with the provider name).
  if (/(?:^|[-_])(?:secret|key|token)(?:$|[-_])/i.test(ruleId)) {
    return "Rotate the exposed credential immediately at the provider (revoke, then reissue). Move the new value into a server-side env var and never bundle it into client code. If the key was in git history, treat it as compromised — a rebase does not un-leak it.";
  }
  return "Review the finding, confirm it is a real risk in context, and remove or gate the offending pattern.";
}

// ── markdown ───────────────────────────────────────────────────────────

function renderMarkdown(i: ReportInput): string {
  const lines: string[] = [];
  lines.push(`# kelp scan — ${escapeMd(i.target)}`);
  lines.push("");
  lines.push(`_${i.scannedAt.toISOString()} · kelp v${i.version} · ${i.filesScanned} files · ${(i.durationMs / 1000).toFixed(1)}s_`);
  lines.push("");

  const bySev = groupBySeverity(i.findings);
  lines.push(`**Summary:** ${summaryLine(bySev)}`);
  lines.push("");

  if (i.findings.length === 0) {
    lines.push("No findings.");
  } else {
    lines.push("## Findings");
    lines.push("");
    for (const f of i.findings) {
      lines.push(`### \`${escapeMd(f.ruleId)}\` · **${f.severity.toUpperCase()}** · ${escapeMd(f.title)}`);
      lines.push("");
      lines.push(`- **Location:** \`${escapeMd(f.path)}:${f.line}\``);
      lines.push(`- **Source:** ${f.source}`);
      if (f.preview) lines.push(`- **Preview:** \`${escapeMd(f.preview)}\``);
      lines.push("");
      lines.push(`**Remediation.** ${remediationFor(f.ruleId)}`);
      lines.push("");
    }
  }

  if (i.agent?.ran) {
    lines.push("## Agent run");
    lines.push("");
    lines.push(`- Model: \`${i.agent.model}\``);
    lines.push(`- Iterations: ${i.agent.iterations}`);
    lines.push(`- Cost: $${(i.agent.costUsdCents / 100).toFixed(3)}`);
    lines.push(`- Duration: ${(i.agent.durationMs / 1000).toFixed(1)}s`);
    if (i.agent.aborted) lines.push(`- Aborted: ${i.agent.aborted}`);
    if (i.agent.coverage) {
      lines.push(`- Coverage: ${i.agent.coverage.filesRead} files read, ${i.agent.coverage.grepsRun} greps, ${i.agent.coverage.listsRun} directory listings`);
    }
    if (i.agent.observations.length > 0) {
      lines.push("");
      lines.push("### Observations (not verified findings)");
      lines.push("");
      for (const o of i.agent.observations) lines.push(`- ${escapeMd(o)}`);
    }
  }

  return lines.join("\n") + "\n";
}

function escapeMd(s: string): string {
  return s.replace(/([\\`*_{}[\]()#+\-.!])/g, "\\$1");
}

// ── html ───────────────────────────────────────────────────────────────

function renderHtml(i: ReportInput): string {
  const bySev = groupBySeverity(i.findings);
  const rows = i.findings
    .map(
      (f) => `
        <tr class="sev-${f.severity}">
          <td><span class="chip chip-${f.severity}">${f.severity}</span></td>
          <td><code>${esc(f.ruleId)}</code></td>
          <td>${esc(f.title)}</td>
          <td><code>${esc(f.path)}:${f.line}</code></td>
          <td class="muted">${esc(f.source)}</td>
        </tr>
        <tr class="detail">
          <td colspan="5">
            <div class="detail-body">
              ${f.preview ? `<div class="preview"><span class="lbl">preview</span><code>${esc(f.preview)}</code></div>` : ""}
              <div class="remediation"><span class="lbl">remediation</span>${esc(remediationFor(f.ruleId))}</div>
            </div>
          </td>
        </tr>`,
    )
    .join("");

  const agentBlock = i.agent?.ran
    ? `
      <section>
        <h2>Agent run</h2>
        <dl class="kv">
          <dt>Model</dt><dd><code>${esc(i.agent.model)}</code></dd>
          <dt>Iterations</dt><dd>${i.agent.iterations}</dd>
          <dt>Cost</dt><dd>$${(i.agent.costUsdCents / 100).toFixed(3)}</dd>
          <dt>Duration</dt><dd>${(i.agent.durationMs / 1000).toFixed(1)}s</dd>
          ${i.agent.aborted ? `<dt>Aborted</dt><dd class="warn">${esc(i.agent.aborted)}</dd>` : ""}
          ${i.agent.coverage ? `<dt>Coverage</dt><dd>${i.agent.coverage.filesRead} files read · ${i.agent.coverage.grepsRun} greps · ${i.agent.coverage.listsRun} listings</dd>` : ""}
        </dl>
        ${
          i.agent.observations.length > 0
            ? `<h3>Observations <span class="muted">(not verified findings)</span></h3><ul class="obs">${i.agent.observations.map((o) => `<li>${esc(o)}</li>`).join("")}</ul>`
            : ""
        }
      </section>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>kelp scan — ${esc(i.target)}</title>
<style>
  :root {
    --ink: #0f172a;
    --paper: #fafaf9;
    --muted: #64748b;
    --line: #e2e8f0;
    --accent: #0ea5e9;
    --critical: #dc2626;
    --high: #ea580c;
    --medium: #ca8a04;
    --low: #0369a1;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --ink: #f1f5f9;
      --paper: #0b0e14;
      --muted: #94a3b8;
      --line: #1e293b;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--paper);
    color: var(--ink);
    font: 15px/1.55 -apple-system, "Inter Tight", system-ui, sans-serif;
    padding: 40px 24px;
  }
  main { max-width: 960px; margin: 0 auto; }
  h1 { font-family: "Fraunces", Georgia, serif; font-weight: 500; font-size: 32px; margin: 0 0 4px; }
  h2 { font-family: "Fraunces", Georgia, serif; font-weight: 500; font-size: 22px; margin: 40px 0 12px; }
  h3 { font-size: 15px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); font-weight: 600; margin: 24px 0 8px; }
  code { font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, monospace; font-size: 0.88em; background: color-mix(in srgb, var(--ink) 6%, transparent); padding: 1px 5px; border-radius: 3px; }
  .muted { color: var(--muted); }
  .meta { color: var(--muted); font-size: 13px; margin-bottom: 24px; }
  .summary { display: flex; gap: 8px; flex-wrap: wrap; margin: 16px 0 32px; }
  .chip { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; letter-spacing: 0.03em; text-transform: uppercase; color: white; }
  .chip-critical { background: var(--critical); }
  .chip-high     { background: var(--high); }
  .chip-medium   { background: var(--medium); }
  .chip-low      { background: var(--low); }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); font-weight: 600; }
  tr.detail td { border-bottom: 1px solid var(--line); padding: 0 8px 16px 8px; }
  .detail-body { display: grid; gap: 8px; margin-left: 12px; padding: 12px; background: color-mix(in srgb, var(--ink) 3%, transparent); border-left: 2px solid var(--accent); border-radius: 0 4px 4px 0; }
  .lbl { display: inline-block; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); font-weight: 600; margin-right: 8px; }
  dl.kv { display: grid; grid-template-columns: max-content 1fr; gap: 6px 20px; }
  dl.kv dt { color: var(--muted); font-size: 13px; }
  ul.obs { padding-left: 20px; }
  ul.obs li { margin-bottom: 6px; }
  .warn { color: var(--high); }
  footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid var(--line); color: var(--muted); font-size: 12px; }
</style>
</head>
<body>
<main>
  <h1>Security scan</h1>
  <div class="meta">${esc(i.target)} · ${i.scannedAt.toISOString()} · ${i.filesScanned} files · ${(i.durationMs / 1000).toFixed(1)}s</div>
  <div class="summary">
    ${(["critical", "high", "medium", "low"] as const)
      .filter((s) => bySev[s] > 0)
      .map((s) => `<span class="chip chip-${s}">${bySev[s]} ${s}</span>`)
      .join("")}
    ${i.findings.length === 0 ? `<span class="muted">No findings.</span>` : ""}
  </div>
  ${
    i.findings.length > 0
      ? `<section>
        <h2>Findings</h2>
        <table>
          <thead><tr><th></th><th>Rule</th><th>Title</th><th>Location</th><th>Source</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </section>`
      : ""
  }
  ${agentBlock}
  <footer>Generated by <a href="https://kelp.build">kelp</a> v${esc(i.version)}.</footer>
</main>
</body>
</html>`;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));
}

// ── shared helpers ─────────────────────────────────────────────────────

type SeverityCounts = { critical: number; high: number; medium: number; low: number };

function groupBySeverity(findings: readonly Finding[]): SeverityCounts {
  const counts: SeverityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) counts[f.severity]++;
  return counts;
}

function summaryLine(c: SeverityCounts): string {
  const parts: string[] = [];
  if (c.critical) parts.push(`${c.critical} critical`);
  if (c.high) parts.push(`${c.high} high`);
  if (c.medium) parts.push(`${c.medium} medium`);
  if (c.low) parts.push(`${c.low} low`);
  return parts.length > 0 ? parts.join(" · ") : "no findings";
}
