// Static Storage ACL analyzer for Supabase repos.
//
// Supabase Storage is a two-layer surface:
//   1. `storage.buckets` — one row per bucket, with a `public` boolean. When
//      `public = true` any object in it is served over the CDN without auth.
//   2. `storage.objects` — one row per uploaded file, gated by Row Level
//      Security policies defined in migrations.
//
// Vibe-coded apps get this wrong in three distinct, high-signal ways. All
// three are detectable from repo SQL alone (no live project needed) and are
// each the shape a real leak takes in production Supabase deployments.
//
//   STORAGE-01  storage_public_bucket — a bucket has `public = true`.
//               Sometimes intentional (avatars, marketing images), but very
//               commonly a mistake: the file names are guessable and the CDN
//               has no auth, so any leaked path is game over.
//
//   STORAGE-02  storage_policy_missing_user_scope — a policy on
//               `storage.objects` filters by `bucket_id = 'X'` but never
//               references `auth.uid()` (or `owner`, or an equivalent
//               per-user column). All authenticated users can read every
//               other user's file in that bucket.
//
//   STORAGE-03  storage_policy_permissive — a policy on `storage.objects`
//               is `USING (true)` or `WITH CHECK (true)` for a client-facing
//               role. Any anon/authenticated caller reaches every object.
//
// The parser lives in rls-sql.ts; this module only runs the checks. Kept
// separate because the RLS analyzer is about ordinary tables while storage
// has its own two-layer model, and mixing them made the code harder to
// reason about.

import type { Severity } from "../types.js";
import { fingerprint } from "../fingerprint.js";
import type { DeepSchemaSnapshot, StorageBucketInfo } from "./rls-sql.js";
import type { PolicyInfo } from "./rls.js";

export type StorageAclIssue =
  | "storage_public_bucket"
  | "storage_policy_missing_user_scope"
  | "storage_policy_permissive";

export interface StorageAclFinding {
  fingerprint: string;
  issue: StorageAclIssue;
  severity: Severity;
  /** Bucket the finding is about, when applicable. */
  bucketId: string | null;
  /** Policy name the finding is about, when applicable. */
  policyName: string | null;
  title: string;
  explanation: string;
}

// Roles that BYPASS RLS. Same set as rls.ts — a permissive policy for
// service_role is expected and safe.
const RLS_BYPASS_ROLES = new Set([
  "service_role",
  "postgres",
  "supabase_admin",
  "supabase_auth_admin",
  "supabase_storage_admin",
  "dashboard_user",
  "authenticator",
]);

function isClientFacing(p: PolicyInfo): boolean {
  if (p.roles.length === 0) return true; // no explicit role → PUBLIC
  if (p.roles.includes("public")) return true;
  return p.roles.some((r) => !RLS_BYPASS_ROLES.has(r));
}

function isPermissive(expr: string | null): boolean {
  if (expr === null) return false;
  const norm = expr.replace(/\s+/g, "").replace(/[()]/g, "").toLowerCase();
  return norm === "true";
}

/** Does the policy body reference the authenticated caller's identity? */
function referencesUser(p: PolicyInfo): boolean {
  const blob = `${p.usingExpr ?? ""} ${p.withCheckExpr ?? ""}`.toLowerCase();
  return (
    blob.includes("auth.uid()") ||
    blob.includes("auth.jwt()") ||
    // `owner` is the Supabase convention for the uploader's uid on
    // storage.objects, so a policy that filters on it (owner = auth.uid())
    // qualifies as user-scoped even if the auth.uid() reference is on the
    // other side of the equality.
    /\bowner\s*=/.test(blob)
  );
}

/** Extract the bucket id(s) a policy filters on. Handles the two shapes
 *  Supabase docs prescribe:
 *    USING (bucket_id = 'avatars')
 *    USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1])
 *  Returns [] when no bucket_id literal is found. */
function bucketsInPolicy(p: PolicyInfo): string[] {
  const blob = `${p.usingExpr ?? ""} ${p.withCheckExpr ?? ""}`;
  const out: string[] = [];
  const re = /bucket_id\s*=\s*'([^']+)'/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(blob)) !== null) out.push(m[1]!);
  return out;
}

function fp(issue: StorageAclIssue, key: string): string {
  return fingerprint(["storage", issue, key]);
}

/** Run the three storage checks over a parsed schema snapshot. */
export function analyzeStorageAcl(snapshot: DeepSchemaSnapshot): StorageAclFinding[] {
  const findings: StorageAclFinding[] = [];

  // Policies on storage.objects, only the client-facing ones — internal
  // service_role policies are safe and expected.
  const objectsTable = snapshot.tables.find(
    (t) => t.schema === "storage" && t.name === "objects",
  );
  const objectPolicies = (objectsTable?.policies ?? []).filter(isClientFacing);

  // STORAGE-01 — public buckets. Flag every one. Users who intentionally
  // want a public bucket (marketing assets, avatars) can suppress with the
  // usual finding-management workflow; we surface it because most public
  // buckets in vibe-coded apps are accidents.
  for (const b of snapshot.buckets) {
    if (!b.isPublic) continue;
    findings.push({
      fingerprint: fp("storage_public_bucket", b.id),
      issue: "storage_public_bucket",
      severity: "high",
      bucketId: b.id,
      policyName: null,
      title: `Storage bucket "${b.id}" is public`,
      explanation:
        `The bucket "${b.id}" is created with public = true. Every object in ` +
        `it is served over Supabase's CDN without authentication. Anyone who ` +
        `guesses or captures a file path (from your app's HTML, from an error ` +
        `log, from a shared link) can download it. Confirm that this bucket is ` +
        `meant to hold public content only. If it holds anything user-private ` +
        `(documents, avatars from private accounts, attachments), set public ` +
        `to false and gate access with an RLS policy on storage.objects.`,
    });
  }

  // STORAGE-03 — permissive policy for a client role.
  // (Runs before STORAGE-02 so a permissive policy dominates the finding.)
  const permissiveCovered = new Set<string>();
  for (const p of objectPolicies) {
    if (!isPermissive(p.usingExpr) && !isPermissive(p.withCheckExpr)) continue;
    findings.push({
      fingerprint: fp("storage_policy_permissive", p.name),
      issue: "storage_policy_permissive",
      severity: "critical",
      bucketId: null,
      policyName: p.name,
      title: `Storage policy "${p.name}" allows access to every object`,
      explanation:
        `The policy "${p.name}" on storage.objects uses USING (true) or ` +
        `WITH CHECK (true) for a client-facing role (${p.roles.join(", ") || "public"}). ` +
        `Any authenticated caller reaches every file in the storage.objects ` +
        `table, ignoring bucket and owner. Restrict the policy to the ` +
        `specific bucket(s) it applies to and to the authenticated user ` +
        `(auth.uid() = owner, or auth.uid()::text = (storage.foldername(name))[1]).`,
    });
    permissiveCovered.add(p.name);
  }

  // STORAGE-02 — bucket-scoped but not user-scoped.
  // A policy that filters on `bucket_id = 'X'` but never references
  // auth.uid() / owner / auth.jwt() means every authenticated user in that
  // bucket sees everyone else's files. Common footgun in Supabase tutorials
  // that stop at "restrict to bucket".
  for (const p of objectPolicies) {
    if (permissiveCovered.has(p.name)) continue;
    if (referencesUser(p)) continue;
    const bucketIds = bucketsInPolicy(p);
    if (bucketIds.length === 0) continue; // policy without a bucket_id is a different bug
    findings.push({
      fingerprint: fp("storage_policy_missing_user_scope", `${p.name}:${bucketIds.join(",")}`),
      issue: "storage_policy_missing_user_scope",
      severity: "high",
      bucketId: bucketIds[0]!,
      policyName: p.name,
      title: `Storage policy "${p.name}" scopes to a bucket but not to the user`,
      explanation:
        `The policy "${p.name}" on storage.objects filters on ` +
        `bucket_id = '${bucketIds.join("', '")}' but never checks auth.uid() ` +
        `(or owner, or auth.jwt()). Every authenticated caller can read/write ` +
        `every other user's files in that bucket. Add a per-user check, for ` +
        `example: auth.uid()::text = (storage.foldername(name))[1], so users ` +
        `only see the folder named after their own uid.`,
    });
  }

  const order: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  return findings;
}

/** Convenience re-export of the bucket type — callers that only depend on
 *  storage-acl don't have to import rls-sql. */
export type { StorageBucketInfo };
