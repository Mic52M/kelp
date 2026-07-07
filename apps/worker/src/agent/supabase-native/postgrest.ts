// Thin PostgREST client for the pen-test specialists. Two verbs — GET rows,
// GET row count via HEAD + Prefer: count=exact — with the two headers
// PostgREST always wants:
//
//   apikey:        <anon key>              — public, project-scoping
//   Authorization: Bearer <access token>   — a signed-in user's JWT, so RLS
//                                             fires as if the app opened the
//                                             request from a browser session
//
// Every call carries an AbortSignal.timeout so a stalled project can't hang
// the whole campaign, and never persists the response body — Kelp's data
// hygiene rule: values never enter the transcript, only field names / row
// counts / booleans.

import { supabaseBaseUrl } from "./auth.js";

const REQUEST_TIMEOUT_MS = 8000;

/** Result of a PostgREST GET the specialists actually care about — just
 *  enough to know "was there a body, and what did its shape look like". */
export interface PostgrestGet {
  status: number;
  /** Top-level field names of the FIRST row of the response body. Empty if
   *  the body wasn't an array of objects. Values are never captured. */
  firstRowFields: string[];
  /** Row count when we asked for it via Prefer: count=exact; null otherwise. */
  rowCount: number | null;
  /** true when the response body was a JSON array with at least one row. */
  hasRows: boolean;
  /** The parsed first row, minus values, for owner-column checks. Only the
   *  columns the caller lists in `keepValuesFor` are actually copied in —
   *  used by BOLA / RLS-deep to check "does this row belong to A or B?". */
  ownerValues: Record<string, string | null>;
}

export interface PostgrestGetOptions {
  /** Which owner-column values to actually capture (never row payload data —
   *  just the owner references so we can decide A vs B). */
  keepValuesFor?: string[];
  /** ask PostgREST to return the total row count in a Content-Range header. */
  requestCount?: boolean;
  /** Extra query string bits appended raw (e.g. `id=eq.42`). Caller is
   *  responsible for URL-encoding values. */
  rawQuery?: string;
}

/**
 * GET one PostgREST endpoint. Returns a small, hygiene-safe summary — never
 * the row bodies.
 */
export async function postgrestGet(input: {
  ref: string;
  anonKey: string;
  accessToken: string;
  table: string;
  options?: PostgrestGetOptions;
}): Promise<PostgrestGet> {
  const opts = input.options ?? {};
  const params = new URLSearchParams();
  // Cap at 3 rows even when the caller doesn't ask — we only need presence
  // + owner-column values, never bulk data.
  params.set("limit", "3");
  if (opts.rawQuery) {
    // Merge raw query bits. Values may legitimately contain "=" (PostgREST
    // filters like "id=eq.a=b" are legal), so we split only on the FIRST "="
    // instead of every one — otherwise the value would silently truncate.
    for (const bit of opts.rawQuery.split("&").filter(Boolean)) {
      const eq = bit.indexOf("=");
      const k = eq >= 0 ? bit.slice(0, eq) : bit;
      const v = eq >= 0 ? bit.slice(eq + 1) : "";
      if (k) params.append(k, decodeURIComponent(v));
    }
  }
  const url = `${supabaseBaseUrl(input.ref)}/rest/v1/${encodeURIComponent(input.table)}?${params.toString()}`;

  const headers: Record<string, string> = {
    apikey: input.anonKey,
    Authorization: `Bearer ${input.accessToken}`,
    Accept: "application/json",
  };
  if (opts.requestCount) headers["Prefer"] = "count=exact";

  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`PostgREST GET ${input.table} timed out or failed: ${msg}`);
  }

  const raw = await res.text().catch(() => "");
  let firstRowFields: string[] = [];
  let hasRows = false;
  const ownerValues: Record<string, string | null> = {};
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === "object" && parsed[0] !== null) {
        const first = parsed[0] as Record<string, unknown>;
        firstRowFields = Object.keys(first);
        hasRows = true;
        for (const col of opts.keepValuesFor ?? []) {
          const v = first[col];
          ownerValues[col] =
            typeof v === "string" || typeof v === "number" || typeof v === "boolean"
              ? String(v)
              : null;
        }
      }
    } catch {
      // Non-JSON body (PostgREST error, HTML from a paused project) — leave
      // fields/hasRows at their defaults. Status carries the signal.
    }
  }

  let rowCount: number | null = null;
  if (opts.requestCount) {
    const range = res.headers.get("content-range");
    // Format: "0-2/17"  (or "*/*" on error)
    if (range) {
      const slash = range.lastIndexOf("/");
      const parsed = slash >= 0 ? Number(range.slice(slash + 1)) : NaN;
      if (Number.isFinite(parsed)) rowCount = parsed;
    }
  }

  return { status: res.status, firstRowFields, rowCount, hasRows, ownerValues };
}
