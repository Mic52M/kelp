// POST /api/free-scan — submit a free (no-signup) scan (#32).
//
// Contract:
//   Body:  { repoUrl: string; supabaseUrl?: string; supabaseAnonKey?: string }
//   200:   { id, slug, statusUrl }
//   400:   { error: "invalid_repo_url" | "invalid_supabase_url" }
//   404:   { error: "public_repo_not_found" }        (repo missing/private)
//   429:   { error: "rate_limited", retryAfterSec }
//   500:   { error: "internal" }
//
// Not a JSON RPC — response codes are the source of truth. Rate limiting:
// 3 submissions / hour per IP (hashed with FREE_SCAN_IP_PEPPER). Repo URL
// canonicalization: lowercased host + no trailing slash + no ".git".

import { NextResponse } from "next/server";
import { after } from "next/server";
import { createHash } from "node:crypto";
import {
  insertFreeScan,
  countRecentFreeScansForIp,
  verifyPublicRepo,
  parseRepoFullName,
  processFreeScan,
  PublicRepoNotFoundError,
  getFreeScanById,
} from "@kelp/worker";
import { track } from "@/lib/analytics";

const RATE_LIMIT_PER_HOUR = 3;

interface Body {
  repoUrl?: unknown;
  supabaseUrl?: unknown;
  supabaseAnonKey?: unknown;
}

function canonicalizeRepoUrl(raw: string): string | null {
  const trimmed = raw.trim().replace(/\.git$/i, "").replace(/\/+$/, "");
  const m = trimmed.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)$/i);
  if (!m) return null;
  return `https://github.com/${m[1]}/${m[2]}`;
}

function canonicalizeSupabaseUrl(raw: string): string | null {
  const trimmed = raw.trim().replace(/\/+$/, "");
  const m = trimmed.match(/^https:\/\/([a-z0-9]{20})\.supabase\.co$/i);
  if (!m) return null;
  return `https://${m[1].toLowerCase()}.supabase.co`;
}

function hashIp(ip: string): string {
  const pepper = process.env.FREE_SCAN_IP_PEPPER ?? "kelp-dev-pepper-do-not-use-in-prod";
  return createHash("sha256").update(pepper).update(ip).digest("hex");
}

function clientIpFromHeaders(headers: Headers): string {
  // Trust the first entry in x-forwarded-for (Vercel/Cloudflare put the client
  // IP there). Fall back to a stable-per-request-anyway string so an operator
  // misconfiguration can't blow up the endpoint.
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return headers.get("x-real-ip") ?? "unknown";
}

export async function POST(req: Request): Promise<Response> {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const repoUrlRaw = typeof body.repoUrl === "string" ? body.repoUrl : "";
  const repoUrl = canonicalizeRepoUrl(repoUrlRaw);
  if (!repoUrl) {
    return NextResponse.json({ error: "invalid_repo_url" }, { status: 400 });
  }

  let supabaseUrl: string | null = null;
  let supabaseAnonKey: string | null = null;
  if (typeof body.supabaseUrl === "string" && body.supabaseUrl.trim()) {
    supabaseUrl = canonicalizeSupabaseUrl(body.supabaseUrl);
    if (!supabaseUrl) {
      return NextResponse.json({ error: "invalid_supabase_url" }, { status: 400 });
    }
  }
  if (typeof body.supabaseAnonKey === "string" && body.supabaseAnonKey.trim()) {
    // Anon keys are JWTs by convention — cheap shape check, not an auth check.
    const k = body.supabaseAnonKey.trim();
    if (!/^ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(k)) {
      return NextResponse.json({ error: "invalid_supabase_anon_key" }, { status: 400 });
    }
    supabaseAnonKey = k;
  }

  const ip = clientIpFromHeaders(req.headers);
  const ipHash = hashIp(ip);
  const recent = await countRecentFreeScansForIp(ipHash, 60);
  if (recent >= RATE_LIMIT_PER_HOUR) {
    return NextResponse.json(
      { error: "rate_limited", retryAfterSec: 3600 },
      { status: 429 },
    );
  }

  try {
    await verifyPublicRepo(parseRepoFullName(repoUrl));
  } catch (e) {
    if (e instanceof PublicRepoNotFoundError) {
      return NextResponse.json({ error: "public_repo_not_found" }, { status: 404 });
    }
    console.error("free-scan repo verify failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }

  const userAgent = req.headers.get("user-agent")?.slice(0, 400) ?? null;

  let created: { id: string; slug: string };
  try {
    created = await insertFreeScan({
      repoUrl,
      supabaseUrl,
      supabaseAnonKey,
      ipHash,
      userAgent,
    });
  } catch (e) {
    console.error("free-scan insert failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }

  // Run the scan out-of-band. In dev / no-queue, `after()` runs it on this
  // instance after the response ships (same pattern as the paid path). In
  // prod with a queue, wire this to enqueueScanJob variant for free scans.
  // Product analytics (#34): fire pre-signup submit under the free-scan slug
  // as distinctId — later merged via alias() when the visitor claims the scan
  // by signing up. hasAnonKey is a strong hint about scan depth.
  track(created.slug, "free_scan.submitted", {
    hasAnonKey: !!supabaseAnonKey,
    hasSupabaseUrl: !!supabaseUrl,
  });

  // Run the scan, then fire the completion event once the row's final state
  // is written. Product analytics (#34): distinctId stays the slug so the
  // whole free-scan funnel merges into one Person timeline via alias() at
  // signup time.
  after(async () => {
    try {
      await processFreeScan(created.id);
      const row = await getFreeScanById(created.id);
      if (!row) return;
      track(created.slug, "free_scan.completed", {
        status: row.status,
        nFindings: Array.isArray(row.findings) ? row.findings.length : 0,
        durationMs: row.durationMs ?? undefined,
        cappedAtBudget: row.status === "capped",
      });
    } catch (err) {
      console.error("free-scan run failed:", err);
    }
  });

  return NextResponse.json({
    id: created.id,
    slug: created.slug,
    statusUrl: `/api/free-scan/${created.id}`,
  });
}
