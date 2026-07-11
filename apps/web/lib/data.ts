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
import type { Finding, FindingStatus, FindingTriage, Project, Severity, VulnClass } from "./types";

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
  last_scan_id: string | null;
}

function mapFinding(row: FindingRow, latestScanId: string | null, prUrl?: string): Finding {
  const raw = row.evidence?.raw;
  let fixPreview: string | undefined;
  let fixPrompt: string | undefined;
  let autofixable = false;

  // Autonomous-agent findings carry their own paste-ready fix prompt in
  // `raw.fix` — written by the agent from the real code it read, so it names
  // the exact file + change. Always prefer it when present; the template
  // helpers below are for deterministic passive-scan findings (RlsFinding /
  // SecretFinding shapes), and would produce "undefined … undefined" junk
  // when accidentally called on an autonomous-agent payload with a different
  // shape.
  const agentFix = (raw as { fix?: unknown } | undefined)?.fix;
  if (typeof agentFix === "string" && agentFix.trim()) {
    fixPrompt = unescapeFixText(agentFix.trim());
  } else if (row.vuln_class === "rls" && raw && looksLikeRlsFinding(raw)) {
    const r = raw as RlsFinding;
    fixPrompt = fixPromptForRls(r, "generic");
    if (r.fixable && r.ownershipColumn) {
      fixPreview = generateRlsMigration({ schema: r.schema, name: r.table }, r.ownershipColumn);
    }
  } else if (row.vuln_class === "secret" && raw && looksLikeSecretFinding(raw)) {
    const s = raw as SecretFinding;
    fixPrompt = fixPromptForSecret(s, "generic");
    autofixable = s.confidence === "high";
  }

  // Triage annotation (#29): surfaced so the UI can show WHY Kelp downgraded /
  // reclassified. The evidence text carries "[Kelp confirmed: …]" (from the
  // evidence gate) and "Kelp triage: …" (appended by applyTriage) — strip both
  // from the user-facing explanation; the triage reason is shown separately.
  const rawTriage = (raw as { triage?: unknown } | undefined)?.triage;
  const triage = parseTriage(rawTriage);
  const explanation = cleanExplanation(row.explanation);

  return {
    id: row.id,
    vulnClass: row.vuln_class,
    severity: row.severity,
    status: STATUS_MAP[row.status] ?? "open",
    title: row.title,
    location: row.location ?? "",
    explanation,
    remediation:
      row.vuln_class === "bola"
        ? "Queued for review by the Kelp team before it is confirmed."
        : fixPrompt
          ? "Paste the prompt into your AI coding tool to apply the fix."
          : "Review the finding and decide how to fix it.",
    ...(fixPreview ? { fixPreview } : {}),
    ...(fixPrompt ? { fixPrompt } : {}),
    ...(prUrl ? { prUrl } : {}),
    ...(autofixable ? { autofixable: true } : {}),
    ...(triage ? { triage } : {}),
    // Was this finding touched by the most recent scan? Upsert bumps
    // last_scan_id every time a finding is re-detected, so equality here
    // means "the current scan saw it (new or unchanged)"; inequality means
    // "the current scan did not re-detect this" — surfaced as a separate
    // section on Overview so users can tell which findings the fresh run
    // is speaking about vs which are carryover from earlier scans.
    fromLatestScan: latestScanId !== null && row.last_scan_id === latestScanId,
    detectedAt: "recent",
  };
}

/** Autonomous-agent fix prompts sometimes arrive JSON-escaped (literal `\n`,
 *  `\"`, `\\s`) because the agent hand-wrote them into a JSON tool call. Render
 *  them as real newlines/quotes so the paste-ready prompt reads cleanly.
 *  Single-backslash escapes first, then collapse doubled backslashes. */
function unescapeFixText(s: string): string {
  if (!/\\[nt"\\]/.test(s)) return s; // fast path: nothing escaped
  return s
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

/** Strip Kelp's internal evidence-gate + triage annotations from the
 *  user-facing explanation. Keeps the substance, drops the plumbing. */
function cleanExplanation(text: string): string {
  return text
    .replace(/\n*\[Kelp confirmed:[^\]]*\]/gi, "")
    .replace(/\n*Kelp triage:[^\n]*/gi, "")
    .trim();
}

/** Narrow the persisted triage jsonb into the view-layer FindingTriage. */
function parseTriage(raw: unknown): FindingTriage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const t = raw as Record<string, unknown>;
  const action = t.action;
  if (
    action !== "keep" &&
    action !== "downgrade_to_needs_review" &&
    action !== "reclassify"
  ) {
    return undefined;
  }
  // A plain "keep" with no reclassification isn't worth surfacing.
  if (action === "keep" && !t.originalVulnClass && !t.originalSeverity) return undefined;
  return {
    action,
    reason: typeof t.reason === "string" ? t.reason : "",
    ...(typeof t.originalVulnClass === "string"
      ? { originalVulnClass: t.originalVulnClass as FindingTriage["originalVulnClass"] }
      : {}),
    ...(typeof t.originalSeverity === "string"
      ? { originalSeverity: t.originalSeverity as FindingTriage["originalSeverity"] }
      : {}),
  };
}

/** Duck-type guards: the deterministic scanners populate specific fields.
 *  Autonomous-agent payloads have a completely different shape (surface,
 *  endpoint, fix, evidence) and would produce "undefined … undefined" if
 *  passed to the template helpers. Only apply the templates when the payload
 *  actually looks like the scanner's own shape. */
function looksLikeRlsFinding(raw: unknown): raw is RlsFinding {
  return !!raw && typeof (raw as RlsFinding).table === "string";
}
function looksLikeSecretFinding(raw: unknown): raw is SecretFinding {
  return !!raw && typeof (raw as SecretFinding).ruleId === "string" && typeof (raw as SecretFinding).path === "string";
}

const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low"];

/** Trimmed report the worker persists per active-pentest scan — see
 *  campaignReportToPersisted in apps/worker/src/scan-processor.ts. */
export interface PersistedAgentReport {
  version: number;
  totalUsage: { inputTokens: number; outputTokens: number; estimatedCostUsd: number };
  outcomes: Array<{
    name: string;
    vulnClass: string;
    steps: number;
    findingsCount: number;
    error: string | null;
    usage: { inputTokens: number; outputTokens: number; estimatedCostUsd: number } | null;
    transcript: string[];
  }>;
}

export interface DashboardData {
  project: Project | null;
  /** all projects the caller can see (for the top-bar switcher) */
  projectOptions: { id: string; name: string; repo: string | null }[];
  findings: Finding[];
  summary: { score: number | null; critical: number; high: number; medium: number; low: number; resolved: number };
  /** status of the most recent scan for the project ("queued" | "running" | … | null) */
  scanStatus: string | null;
  /** mode of the most recent scan — 'passive' | 'active_pentest' (#27). */
  scanMode: "passive" | "active_pentest" | null;
  /** Full per-agent report of the most recent active-pentest scan (transcripts,
   *  step counts, per-agent cost). Null for passive scans or when the row
   *  predates the agent_report column. */
  agentReport: PersistedAgentReport | null;
  /** Claude spend of the most recent scan, in USD cents. */
  scanCostCents: number | null;
  /** human-readable warnings if a scan class couldn't complete */
  scanIssues: string[];
  /** Active-pentest gate state (#27): what's needed to enable the button. */
  activePentest: {
    /** plan.activePentestEnabled — paid tiers only */
    planAllowed: boolean;
    /** valid non-revoked latest-version consent for the selected project */
    consentGranted: boolean;
    /** Supabase read-only connection string is stored (schema discovery) */
    supabaseReadonlySet: boolean;
    /** anon key stored, OR management PAT stored (auto-fetch fallback) */
    supabaseAnonReady: boolean;
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
        .select("id, status, error, mode, agent_report, cost_cents")
        .eq("project_id", p.id)
        .order("queued_at", { ascending: false })
        .limit(1)
    : { data: null };
  const latestScan = scanRows?.[0] as
    | {
        id: string;
        status: string;
        error: string | null;
        mode: "passive" | "active_pentest";
        agent_report: PersistedAgentReport | null;
        cost_cents: number | null;
      }
    | undefined;
  const latestScanId = latestScan?.id ?? null;
  const scanStatus = latestScan?.status ?? null;
  const scanMode = latestScan?.mode ?? null;
  const agentReport = latestScan?.agent_report ?? null;
  const scanCostCents = latestScan?.cost_cents ?? null;

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
        .select("id, vuln_class, severity, status, title, location, explanation, evidence, last_scan_id")
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
    .map((r) => mapFinding(r, latestScanId, prUrls.get(r.id)))
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
  let supabaseReadonlySet = false;
  let supabaseAnonReady = false;
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
    supabaseReadonlySet = status.hasSupabaseReadonly;
    // Reachable if we have any stored credential OR a connected repo — a repo
    // lets Kelp auto-detect the anon key + schema from the source (the
    // Lovable-Cloud path, where the user has no DB access to hand over).
    const hasRepo = !!(p as { github_repo_full_name?: string | null }).github_repo_full_name;
    supabaseAnonReady =
      status.hasSupabaseAnonKey || status.hasSupabaseManagement || status.hasSupabaseReadonly || hasRepo;
    accountASet = status.testAccountAEmail !== null;
    accountBSet = status.testAccountBEmail !== null;
  }

  return {
    project,
    projectOptions,
    findings,
    scanStatus,
    scanMode,
    agentReport,
    scanCostCents,
    scanIssues,
    summary: {
      // A `null` score means "no successful scan yet, we don't know" — the
      // dashboard renders it as `—`, not 100. A project with zero findings
      // AFTER a successful scan is legitimately 100. Distinguishes "clean" from
      // "unknown" — the latter was showing as 100/100 which was misleading.
      score:
        latestScan && (latestScan.status === "succeeded" || findings.length > 0)
          ? findings.length === 0
            ? 100
            : Math.max(5, 100 - penalty)
          : null,
      critical: activeBySeverity("critical"),
      high: activeBySeverity("high"),
      medium: activeBySeverity("medium"),
      low: activeBySeverity("low"),
      resolved: findings.filter((f) => f.status === "resolved").length,
    },
    activePentest: {
      planAllowed,
      consentGranted,
      supabaseReadonlySet,
      supabaseAnonReady,
      accountASet,
      accountBSet,
      // No longer requires the read-only DB string — supabaseAnonReady covers
      // any reachable path (stored creds OR a repo we can auto-detect from).
      ready: planAllowed && consentGranted && supabaseAnonReady && accountASet && accountBSet,
      plan,
    },
  };
}
