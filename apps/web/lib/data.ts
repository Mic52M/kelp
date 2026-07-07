import {
  generateRlsMigration,
  fixPromptForRls,
  fixPromptForSecret,
  PLANS,
  CONSENT_ACCEPTED_FOR_MULTI_SPECIALIST,
  type PlanTier,
  type RlsFinding,
  type SecretFinding,
} from "@kelp/core";
import { getServerSupabase } from "./supabase/server";
import { loadActiveTestConsent, getProjectConfigStatus, expireStuckScans } from "@kelp/worker";
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
  }

  let autofixable = false;
  if (row.vuln_class === "secret" && raw) {
    const s = raw as SecretFinding;
    fixPrompt = fixPromptForSecret(s, "generic");
    // Only high-confidence secrets (branded provider keys, service_role) get the
    // automatic-PR button; medium ones fall back to the prompt. Mirrors the
    // backend guard in openSecretFixPr.
    autofixable = s.confidence === "high";
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
    ...(autofixable ? { autofixable: true } : {}),
    detectedAt: "recent",
  };
}

const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low"];

export interface DashboardData {
  project: Project | null;
  /** all projects the caller can see (for the top-bar switcher) */
  projectOptions: { id: string; name: string; repo: string | null }[];
  findings: Finding[];
  summary: { score: number; critical: number; high: number; medium: number; resolved: number };
  /** status of the most recent scan for the project ("queued" | "running" | … | null) */
  scanStatus: string | null;
  /** mode of the most recent scan — 'passive' | 'active_pentest' (#27). */
  scanMode: "passive" | "active_pentest" | null;
  /** human-readable warnings if a scan class couldn't complete */
  scanIssues: string[];
  /** Active-pentest gate state (#27): what's needed to enable the button. */
  activePentest: {
    /** plan.activePentestEnabled — paid tiers only */
    planAllowed: boolean;
    /** valid non-revoked latest-version consent for the selected project */
    consentGranted: boolean;
    /** projects.app_base_url is set */
    appBaseUrlSet: boolean;
    /** test account A credential is stored */
    accountASet: boolean;
    /** test account B credential is stored */
    accountBSet: boolean;
    /** all preconditions above true → button clickable */
    ready: boolean;
    /** the org's current plan tier (for upgrade CTAs) */
    plan: PlanTier;
  };
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
    // Self-heal any orphaned queued/running scan for this project before
    // reading its status (#8). Cheap: only touches rows past the TTL.
    await expireStuckScans(p.id, 20).catch(() => {});
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

export async function loadDashboard(projectId?: string): Promise<DashboardData> {
  const supabase = await getServerSupabase();

  // If the user picked a specific project (via ?project=…), try to load it.
  // Fall back to the most-recent project if the id is missing or not accessible
  // (RLS returns nothing — pretend it wasn't set).
  let p:
    | {
        id: string;
        name: string;
        github_repo_full_name: string | null;
        supabase_project_ref: string | null;
        app_base_url: string | null;
        org_id: string;
      }
    | undefined;
  if (projectId) {
    const { data } = await supabase
      .from("projects")
      .select("id, name, github_repo_full_name, supabase_project_ref, app_base_url, org_id")
      .eq("id", projectId)
      .maybeSingle();
    p = data ?? undefined;
  }
  if (!p) {
    const { data: projects } = await supabase
      .from("projects")
      .select("id, name, github_repo_full_name, supabase_project_ref, app_base_url, org_id")
      .order("created_at", { ascending: false })
      .limit(1);
    p = projects?.[0];
  }
  const project: Project | null = p
    ? {
        id: p.id,
        name: p.name,
        repo: p.github_repo_full_name ?? "—",
        supabaseRef: p.supabase_project_ref ?? "—",
        lastScan: "recently",
      }
    : null;

  // Self-heal orphaned scans (#8): if the previous scan is still 'running' or
  // 'queued' well past the campaign TTL (a next-server `after()` was killed
  // mid-scan, or Redis went away between enqueue and consume), flip it to
  // 'failed' so the dashboard un-sticks itself. TTL is generous — active-
  // pentest campaigns legitimately take a few minutes.
  if (p) {
    await expireStuckScans(p.id, 20).catch(() => {});
  }
  const { data: scanRows } = p
    ? await supabase
        .from("scans")
        .select("status, error, mode")
        .eq("project_id", p.id)
        .order("queued_at", { ascending: false })
        .limit(1)
    : { data: null };
  const latestScan = scanRows?.[0] as
    | { status: string; error: string | null; mode: "passive" | "active_pentest" }
    | undefined;
  const scanStatus = latestScan?.status ?? null;
  const scanMode = latestScan?.mode ?? null;

  let scanIssues: string[] = [];
  if (latestScan?.error) {
    try {
      const parsed = JSON.parse(latestScan.error) as { vulnClass: string; message: string }[];
      scanIssues = Array.from(
        new Set(parsed.map((e) => friendlyScanIssue(e.vulnClass, e.message))),
      );
    } catch {
      // Plain-string scan errors (e.g. the customer-backend preflight or the
      // 20-min self-heal message) never get JSON-parsed — surface them
      // verbatim, since they're already written for humans.
      if (latestScan.status === "failed") scanIssues = [latestScan.error];
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

  // All projects the user can see — powers the top-bar switcher without an extra roundtrip.
  const { data: allProjects } = await supabase
    .from("projects")
    .select("id, name, github_repo_full_name")
    .order("created_at", { ascending: false });
  const projectOptions = ((allProjects ?? []) as Array<{
    id: string;
    name: string;
    github_repo_full_name: string | null;
  }>).map((r) => ({ id: r.id, name: r.name, repo: r.github_repo_full_name }));

  // Active-pentest gate state (#27). Plan is scoped to the project's org;
  // consent + app_base_url + test-account credentials are per-project. Free
  // tier → planAllowed=false and the CTA renders as "Upgrade" instead of
  // "Run". consentGranted uses the whitelist of versions the campaign accepts
  // (CONSENT_ACCEPTED_FOR_MULTI_SPECIALIST) so bumping the copy version
  // doesn't silently disable the button.
  let planAllowed = false;
  let plan: PlanTier = "free";
  let consentGranted = false;
  const appBaseUrlSet = !!p?.app_base_url;
  let accountASet = false;
  let accountBSet = false;
  if (p) {
    const { data: orgRow } = await supabase
      .from("orgs")
      .select("plan")
      .eq("id", p.org_id)
      .maybeSingle();
    plan = ((orgRow?.plan as PlanTier | undefined) ?? "free") as PlanTier;
    planAllowed = PLANS[plan].activePentestEnabled;
    const [consent, status] = await Promise.all([
      loadActiveTestConsent(p.id),
      getProjectConfigStatus(p.id),
    ]);
    consentGranted =
      !!consent &&
      consent.consented &&
      consent.revokedAt === null &&
      (CONSENT_ACCEPTED_FOR_MULTI_SPECIALIST as readonly string[]).includes(consent.consentVersion);
    accountASet = status.testAccountAEmail !== null;
    accountBSet = status.testAccountBEmail !== null;
  }

  return {
    project,
    projectOptions,
    findings,
    scanStatus,
    scanMode,
    scanIssues,
    summary: {
      score: findings.length === 0 ? 100 : Math.max(5, 100 - penalty),
      critical: activeBySeverity("critical"),
      high: activeBySeverity("high"),
      medium: activeBySeverity("medium"),
      resolved: findings.filter((f) => f.status === "resolved").length,
    },
    activePentest: {
      planAllowed,
      consentGranted,
      appBaseUrlSet,
      accountASet,
      accountBSet,
      ready: planAllowed && consentGranted && appBaseUrlSet && accountASet && accountBSet,
      plan,
    },
  };
}
