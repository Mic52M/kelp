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
}

function mapFinding(row: FindingRow): Finding {
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
        : "Kelp can generate a fix for this — review it before applying.",
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
        .select("status")
        .eq("project_id", p.id)
        .order("queued_at", { ascending: false })
        .limit(1)
    : { data: null };
  const scanStatus = (scanRows?.[0]?.status as string | undefined) ?? null;

  const { data: rows } = await supabase
    .from("findings")
    .select("id, vuln_class, severity, status, title, location, explanation");

  const findings = ((rows ?? []) as FindingRow[])
    .map(mapFinding)
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
    summary: {
      score: findings.length === 0 ? 100 : Math.max(5, 100 - penalty),
      critical: activeBySeverity("critical"),
      high: activeBySeverity("high"),
      medium: activeBySeverity("medium"),
      resolved: findings.filter((f) => f.status === "resolved").length,
    },
  };
}
