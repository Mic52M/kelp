// Public-repo GitHub connector for the free scan (#32).
//
// The paid path uses `createGitHubConnector` which authenticates as a GitHub
// App installation — that requires the user to install the Kelp App on their
// account/org. The free scan is pre-signup: no App install, no token. This
// connector downloads a PUBLIC repo tarball with unauthenticated GitHub API
// calls (rate limit: 60 req/hr per IP, plenty for one scan every few minutes
// per landing visitor).
//
// If the repo is private or missing, GitHub returns 404 — surfaced as
// `PublicRepoNotFoundError` so the API layer can render a calm banner instead
// of a stack trace.

import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import * as tar from "tar-stream";
import { shouldScanPath, type SourceFile } from "@kelp/core";

const MAX_FILE_BYTES = 300_000;

// Free-scan tarball extraction is FIFO by tar order. On a big repo the first N
// files may be docs/tests before we ever reach `supabase/migrations/*.sql`
// or config. Two-tier cap:
//   - PRIORITY paths (SQL, migrations, supabase config, .env-like, package
//     manifests, next config) are ALWAYS kept regardless of the counter.
//   - The rest is capped at NON_PRIORITY_MAX_FILES.
// Rationale: SQL is the single most load-bearing input for the RLS analyzer,
// and .env/service_role committed anywhere in the tree is the load-bearing
// input for the secret scan — losing them to a FIFO cap is a correctness bug,
// not a resource-control choice.
const NON_PRIORITY_MAX_FILES = 2000;
const PRIORITY_PATH_RE =
  /(?:^|\/)supabase\/|(?:^|\/)migrations?\/|\.sql$|(?:^|\/)\.env(?!\.example$)[^/]*$|(?:^|\/)package\.json$|(?:^|\/)next\.config\.(?:js|mjs|ts)$|(?:^|\/)firebase\.json$|(?:^|\/)firestore\.rules$|(?:^|\/)storage\.rules$/i;

export interface ListPublicRepoResult {
  files: SourceFile[];
  /** Number of file entries seen in the tarball (before any filter/cap). */
  entriesSeen: number;
  /** Number of file entries the SKIP_PATH_RE filter kept before the cap. */
  entriesEligible: number;
  /** True if the non-priority cap kicked in (some files were dropped). */
  capReached: boolean;
  /** Number of priority-path files retained (never counted against the cap). */
  priorityKept: number;
}

export class PublicRepoNotFoundError extends Error {
  constructor(repoFullName: string) {
    super(`repository "${repoFullName}" is not a public GitHub repo, or does not exist`);
    this.name = "PublicRepoNotFoundError";
  }
}

/** Confirm a repo exists AND is public. Returns default_branch or throws. */
export async function verifyPublicRepo(
  repoFullName: string,
): Promise<{ defaultBranch: string; stars: number }> {
  const [owner, repo] = repoFullName.split("/");
  if (!owner || !repo) throw new PublicRepoNotFoundError(repoFullName);

  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: {
      // Explicit UA per GitHub API guidance; unauth requests without one can 403.
      "User-Agent": "kelp-free-scan",
      Accept: "application/vnd.github+json",
    },
  });
  if (res.status === 404 || res.status === 403) throw new PublicRepoNotFoundError(repoFullName);
  if (!res.ok) throw new Error(`GitHub API ${res.status} verifying ${repoFullName}`);
  const data = (await res.json()) as { private: boolean; default_branch: string; stargazers_count?: number };
  if (data.private) throw new PublicRepoNotFoundError(repoFullName);
  return { defaultBranch: data.default_branch, stars: data.stargazers_count ?? 0 };
}

/**
 * Download a public repo's tarball and return the filtered SourceFile[]. Same
 * shape as `createGitHubConnector.listSourceFiles`, so `runFreeScan` (and the
 * static scanners underneath) work unchanged.
 */
export async function listPublicRepoSourceFiles(repoFullName: string): Promise<ListPublicRepoResult> {
  const [owner, repo] = repoFullName.split("/");
  if (!owner || !repo) throw new PublicRepoNotFoundError(repoFullName);

  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/tarball`,
    {
      headers: {
        "User-Agent": "kelp-free-scan",
        Accept: "application/vnd.github+json",
      },
      // Follow the redirect GitHub returns to codeload.github.com.
      redirect: "follow",
    },
  );
  if (res.status === 404) throw new PublicRepoNotFoundError(repoFullName);
  if (!res.ok) throw new Error(`GitHub tarball ${res.status} for ${repoFullName}`);
  const gzipped = Buffer.from(await res.arrayBuffer());
  return extractSourceFiles(gzipped);
}

function extractSourceFiles(gzipped: Buffer): Promise<ListPublicRepoResult> {
  return new Promise((resolve, reject) => {
    const files: SourceFile[] = [];
    const extract = tar.extract();
    let entriesSeen = 0;
    let entriesEligible = 0;
    let nonPriorityKept = 0;
    let priorityKept = 0;
    let capReached = false;

    extract.on("entry", (header, stream, next) => {
      const path = header.name.replace(/^[^/]+\//, "");
      const isFile = header.type === "file";
      if (isFile) entriesSeen++;

      const scannable = isFile && shouldScanPath(path) && (header.size ?? 0) <= MAX_FILE_BYTES;
      if (!scannable) {
        stream.on("end", next);
        stream.resume();
        return;
      }
      entriesEligible++;

      const priority = PRIORITY_PATH_RE.test(path);
      if (!priority && nonPriorityKept >= NON_PRIORITY_MAX_FILES) {
        capReached = true;
        stream.on("end", next);
        stream.resume();
        return;
      }

      const chunks: Buffer[] = [];
      stream.on("data", (c: Buffer) => chunks.push(c));
      stream.on("end", () => {
        const content = Buffer.concat(chunks);
        if (!content.includes(0)) {
          files.push({ path, content: content.toString("utf8") });
          if (priority) priorityKept++;
          else nonPriorityKept++;
        }
        next();
      });
      stream.on("error", reject);
    });

    extract.on("finish", () =>
      resolve({ files, entriesSeen, entriesEligible, capReached, priorityKept }),
    );
    extract.on("error", reject);

    Readable.from(gzipped).pipe(createGunzip()).pipe(extract);
  });
}
