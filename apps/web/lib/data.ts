import {
  generateRlsMigration,
  fixPromptForRls,
  fixPromptForSecret,
  type RlsFinding,
  type SecretFinding,
} from "@kelp/core";
import { getServerSupabase } from "./supabase/server";
import type { Finding, FindingStatus, Project, Severity, VulnClass } from "./types";

// Loads the signed-in org's project + findings from the DB. Queries run through
// the user's session, so RLS scopes them to orgs the user belongs to.

const STATUS_MAP: Record<string, FindingStatus> = {
  open: "open",
  pr_opened: "pr_opened",
  needs_review: "needs_review",
  confirmed: "confirmed",
  resolved: "resolved",
  regressed: "open",
  dismissed: "resolved",
};

interface FindingRow {
  id: string;
  vuln_class: VulnClass;
  severity: Severity;
  status: string;
  title: string;
  location: string | null;
  explanation: string;
  evidence: { fixable?: boolean; raw?: unknown } | null;
}

function mapFinding(row: FindingRow, prUrl?: string): Finding {
  const raw = row.evidence?.raw;
  let fixPreview: string | undefined;
  let fixPrompt: string | undefined;

  if (row.vuln_class === "rls" && raw) {
    const r = raw as RlsFinding;
    fixPrompt = fixPromptForRls(r, "generic");
    if (r.fixable && r.ownershipColumn) {
      fixPreview = generateRlsMigration({ schema: r.schema, name: r.table }, r.ownershipColumn);
    }
  } else if (row.vuln_class === "secret" && raw) {
    fixPrompt = fixPromptForSecret(raw as SecretFinding, "generic");
  }

  return {
    id: row.id,
    vulnClass: row.vuln_class,
    severity: row.severity,
    status: STATUS_MAP[row.status] ?? "open",
    title: row.title,
    location: row.location ?? "",
    explanation: row.explanation,
    remediation:
      row.vuln_class === "bola"
        ? "Queued for review by the Kelp team before it is confirmed."
        : "Apply the fix below, or paste the prompt into your AI coding tool.",
    ...(fixPreview ? { fixPreview } : {}),
    ...(fixPrompt ? { fixPrompt } : {}),
    ...(prUrl ? { prUrl } : {}),
    detectedAt: "recent",
  };
}

const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low"];

export interface DashboardData {
  project: Project | null;
  findings: Finding[];
  summary: { score: number; critical: number; high: number; medium: number; resolved: number };
  /** status of the most recent scan for the project ("queued" | "running" | … | null) */
  scanStatus: string | null;
  /** human-readable warnings if a scan class couldn't complete */
  scanIssues: string[];
}

function friendlyScanIssue(vulnClass: string, message: string): string {
  if (/401|unauthor/i.test(message)) {
    return vulnClass === "rls"
      ? "The Supabase scan couldn't run — your Management API token was rejected. Reconnect the project with a valid token."
      : "A credential was rejected during the scan. Reconnect the affected project.";
  }
  if (/rate limit|secondary|Unicorn/i.test(message)) {
    return "GitHub rate-limited the scan. It will succeed on the next run.";
  }
  if (/not found|404/i.test(message)) {
    return `The ${vulnClass === "rls" ? "Supabase project" : "repository"} could not be reached — it may have been removed.`;
  }
  return `The ${vulnClass.toUpperCase()} scan didn't complete. Try re-scanning.`;
}

export interface ProjectSummary {
  id: string;
  name: string;
  repo: string | null;
  supabaseRef: string | null;
  activeFindings: number;
  scanStatus: string | null;
}

/** All projects for the signed-in org, with active-finding counts. */
export async function loadProjects(): Promise<ProjectSummary[]> {
  const supabase = await getServerSupabase();
  const { data: projects } = await supabase
    .from("projects")
    .select("id, name, github_repo_full_name, supabase_project_ref")
    .order("created_at", { ascending: false });

  const out: ProjectSummary[] = [];
  for (const p of projects ?? []) {
    const { count } = await supabase
      .from("findings")
      .select("id", { count: "exact", head: true })
      .eq("project_id", p.id)
      .neq("status", "resolved");
    const { data: scan } = await supabase
      .from("scans")
      .select("status")
      .eq("project_id", p.id)
      .order("queued_at", { ascending: false })
      .limit(1);
    out.push({
      id: p.id,
      name: p.name,
      repo: p.github_repo_full_name,
      supabaseRef: p.supabase_project_ref,
      activeFindings: count ?? 0,
      scanStatus: (scan?.[0]?.status as string | undefined) ?? null,
    });
  }
  return out;
}

export async function loadDashboard(): Promise<DashboardData> {
  const supabase = await getServerSupabase();

  const { data: projects } = await supabase
    .from("projects")
    .select("id, name, github_repo_full_name, supabase_project_ref")
    .order("created_at", { ascending: false })
    .limit(1);

  const p = projects?.[0];
  const project: Project | null = p
    ? {
        id: p.id,
        name: p.name,
        repo: p.github_repo_full_name ?? "—",
        supabaseRef: p.supabase_project_ref ?? "—",
        lastScan: "recently",
      }
    : null;

  const { data: scanRows } = p
    ? await supabase
        .from("scans")
        .select("status, error")
        .eq("project_id", p.id)
        .order("queued_at", { ascending: false })
        .limit(1)
    : { data: null };
  const latestScan = scanRows?.[0] as { status: string; error: string | null } | undefined;
  const scanStatus = latestScan?.status ?? null;

  let scanIssues: string[] = [];
  if (latestScan?.error) {
    try {
      const parsed = JSON.parse(latestScan.error) as { vulnClass: string; message: string }[];
      scanIssues = Array.from(
        new Set(parsed.map((e) => friendlyScanIssue(e.vulnClass, e.message))),
      );
    } catch {
      /* non-JSON error — ignore for display */
    }
  }

  const { data: rows } = p
    ? await supabase
        .from("findings")
        .select("id, vuln_class, severity, status, title, location, explanation, evidence")
        .eq("project_id", p.id)
    : { data: null };

  // Fix-PR links for these findings (RLS scopes remediations to the user's orgs).
  const findingIds = ((rows ?? []) as FindingRow[]).map((r) => r.id);
  const { data: rems } = findingIds.length
    ? await supabase
        .from("remediations")
        .select("finding_id, github_pr_url")
        .in("finding_id", findingIds)
        .not("github_pr_url", "is", null)
    : { data: null };
  const prUrls = new Map(
    ((rems ?? []) as { finding_id: string; github_pr_url: string }[]).map((r) => [
      r.finding_id,
      r.github_pr_url,
    ]),
  );

  const findings = ((rows ?? []) as FindingRow[])
    .map((r) => mapFinding(r, prUrls.get(r.id)))
    .sort(
      (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
    );

  const activeBySeverity = (s: Severity) =>
    findings.filter((f) => f.severity === s && f.status !== "resolved").length;
  const penalty =
    activeBySeverity("critical") * 25 +
    activeBySeverity("high") * 12 +
    activeBySeverity("medium") * 5 +
    activeBySeverity("low") * 1;

  return {
    project,
    findings,
    scanStatus,
    scanIssues,
    summary: {
      score: findings.length === 0 ? 100 : Math.max(5, 100 - penalty),
      critical: activeBySeverity("critical"),
      high: activeBySeverity("high"),
      medium: activeBySeverity("medium"),
      resolved: findings.filter((f) => f.status === "resolved").length,
    },
  };
}
