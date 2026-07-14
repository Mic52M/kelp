// Real GitHub connector. Authenticates as the GitHub App installation, reads a
// repository's files (for the secret scan), and can list the repos the app is
// installed on. Uses the official @octokit/app SDK, which handles the App JWT
// and installation-token exchange.
//
// Scopes used: Contents (read/write) to fetch files and commit fixes, Pull
// requests (write) to open fix PRs. Nothing is written during a scan — writes
// happen only through openFixPr, always on a fresh kelp/* branch, never the
// default branch.

import { App } from "@octokit/app";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import * as tar from "tar-stream";
import { shouldScanPath, type GitHubConnector, type SourceFile } from "@kelp/core";

// Guard rails so a scan can't blow up on a huge monorepo.
const MAX_FILE_BYTES = 300_000;
const MAX_FILES = 500;

export interface GitHubConnectorConfig {
  appId: string;
  privateKey: string; // PEM
  installationId: number;
}

export interface FixPrInput {
  /** head branch to create (must be namespaced, e.g. "kelp/…") */
  branch: string;
  title: string;
  body: string;
  commitMessage: string;
  /** file to rewrite */
  path: string;
  /** pure edit: current content → fixed content, or null if no safe fix */
  edit: (content: string) => string | null;
}

export interface FixPrResult {
  url: string;
  /** true when an open PR for this branch already existed and was reused */
  alreadyExisted: boolean;
}

/** Thrown when the edit callback can't produce a safe fix for the file. */
export class FixNotApplicableError extends Error {
  constructor() {
    super("no safe automatic fix for this file");
    this.name = "FixNotApplicableError";
  }
}

export interface RealGitHubConnector extends GitHubConnector {
  /** repos the installation can access, as "owner/repo". */
  listRepos(): Promise<string[]>;
  /** Open (or reuse) a fix PR: branch off the default branch, commit the edited file, open the PR. */
  openFixPr(repoFullName: string, input: FixPrInput): Promise<FixPrResult>;
}

// Retry transient GitHub errors (5xx and secondary/abuse rate limits, which can
// surface as 403/429 or a 5xx HTML page) with exponential backoff.
async function withRetry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const status = (e as { status?: number }).status ?? 0;
      const retryable = status === 0 || status >= 500 || status === 403 || status === 429;
      if (!retryable || attempt === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
    }
  }
  throw lastErr;
}

export interface GitHubAppConfig {
  appId: string;
  privateKey: string; // PEM
}

/** App-level (JWT-authenticated) operations, not scoped to any installation. */
export interface GitHubApp {
  /** The app's URL slug, used to build the install redirect. */
  getAppSlug(): Promise<string>;
  /** Account (user/org) a given installation belongs to. */
  getInstallationAccount(installationId: number): Promise<{ login: string | null; type: string | null }>;
}

export function createGitHubApp(cfg: GitHubAppConfig): GitHubApp {
  const app = new App({ appId: cfg.appId, privateKey: cfg.privateKey });
  return {
    async getAppSlug(): Promise<string> {
      const { data } = await withRetry(() => app.octokit.request("GET /app"));
      if (!data?.slug) throw new Error("GitHub app has no slug");
      return data.slug;
    },
    async getInstallationAccount(installationId: number) {
      const { data } = await withRetry(() =>
        app.octokit.request("GET /app/installations/{installation_id}", {
          installation_id: installationId,
        }),
      );
      const acct = data.account as { login?: string; type?: string } | null;
      return { login: acct?.login ?? null, type: acct?.type ?? null };
    },
  };
}

export function createGitHubConnector(cfg: GitHubConnectorConfig): RealGitHubConnector {
  const app = new App({ appId: cfg.appId, privateKey: cfg.privateKey });

  async function octokit() {
    return app.getInstallationOctokit(cfg.installationId);
  }

  return {
    async listRepos(): Promise<string[]> {
      const kit = await octokit();
      const repos: string[] = [];
      const perPage = 100;
      // Walk pages manually (the installation Octokit has no paginate plugin).
      for (let page = 1; ; page++) {
        const { data } = await kit.request("GET /installation/repositories", {
          per_page: perPage,
          page,
        });
        for (const r of data.repositories) repos.push(r.full_name);
        if (data.repositories.length < perPage) break;
      }
      return repos;
    },

    async listSourceFiles(repoFullName: string, ref?: string): Promise<SourceFile[]> {
      const kit = await octokit();
      const [owner, repo] = repoFullName.split("/");
      if (!owner || !repo) throw new Error(`invalid repo "${repoFullName}"`);

      // One request: download the repo tarball. Default branch when ref is
      // omitted; a specific SHA/branch/tag when the caller wants to scan an
      // exact commit (e.g. the PR head SHA from the GitHub Action, #36). Far
      // fewer API calls than fetching each blob, so no secondary rate limits.
      const res = ref
        ? await withRetry(() =>
            kit.request("GET /repos/{owner}/{repo}/tarball/{ref}", { owner, repo, ref }),
          )
        : await withRetry(() =>
            kit.request("GET /repos/{owner}/{repo}/tarball", { owner, repo }),
          );
      const gzipped = Buffer.from(res.data as ArrayBuffer);

      return extractSourceFiles(gzipped);
    },

    async openFixPr(repoFullName: string, input: FixPrInput): Promise<FixPrResult> {
      const kit = await octokit();
      const [owner, repo] = repoFullName.split("/");
      if (!owner || !repo) throw new Error(`invalid repo "${repoFullName}"`);
      if (!input.branch.startsWith("kelp/")) {
        throw new Error(`fix branch must be kelp-namespaced, got "${input.branch}"`);
      }

      const { data: repoInfo } = await withRetry(() =>
        kit.request("GET /repos/{owner}/{repo}", { owner, repo }),
      );
      const base = repoInfo.default_branch;

      // Idempotent: if an open PR for this branch already exists, reuse it.
      const { data: existing } = await withRetry(() =>
        kit.request("GET /repos/{owner}/{repo}/pulls", {
          owner,
          repo,
          head: `${owner}:${input.branch}`,
          state: "open",
        }),
      );
      if (existing.length > 0) {
        return { url: existing[0]!.html_url, alreadyExisted: true };
      }

      // Read the file at the tip of the default branch and build the fix.
      const { data: baseRef } = await withRetry(() =>
        kit.request("GET /repos/{owner}/{repo}/git/ref/{ref}", {
          owner,
          repo,
          ref: `heads/${base}`,
        }),
      );
      const headSha = baseRef.object.sha;

      const { data: fileData } = await withRetry(() =>
        kit.request("GET /repos/{owner}/{repo}/contents/{path}", {
          owner,
          repo,
          path: input.path,
          ref: base,
        }),
      );
      if (Array.isArray(fileData) || fileData.type !== "file" || !("content" in fileData)) {
        throw new Error(`"${input.path}" is not a file on ${base}`);
      }
      const current = Buffer.from(fileData.content, "base64").toString("utf8");

      const fixed = input.edit(current);
      if (fixed === null) throw new FixNotApplicableError();

      // Branch off the default branch head. If a stale kelp/* branch exists
      // (e.g. a previous PR was closed unmerged), reset it — it's our namespace.
      try {
        await kit.request("POST /repos/{owner}/{repo}/git/refs", {
          owner,
          repo,
          ref: `refs/heads/${input.branch}`,
          sha: headSha,
        });
      } catch (e) {
        if ((e as { status?: number }).status !== 422) throw e;
        await kit.request("PATCH /repos/{owner}/{repo}/git/refs/{ref}", {
          owner,
          repo,
          ref: `heads/${input.branch}`,
          sha: headSha,
          force: true,
        });
      }

      await withRetry(() =>
        kit.request("PUT /repos/{owner}/{repo}/contents/{path}", {
          owner,
          repo,
          path: input.path,
          branch: input.branch,
          message: input.commitMessage,
          content: Buffer.from(fixed, "utf8").toString("base64"),
          sha: fileData.sha,
        }),
      );

      const { data: pr } = await withRetry(() =>
        kit.request("POST /repos/{owner}/{repo}/pulls", {
          owner,
          repo,
          title: input.title,
          body: input.body,
          head: input.branch,
          base,
        }),
      );
      return { url: pr.html_url, alreadyExisted: false };
    },
  };
}

/** Gunzip + untar a GitHub tarball in memory, returning scannable text files. */
function extractSourceFiles(gzipped: Buffer): Promise<SourceFile[]> {
  return new Promise((resolve, reject) => {
    const files: SourceFile[] = [];
    const extract = tar.extract();

    extract.on("entry", (header, stream, next) => {
      // GitHub tarballs nest everything under a top-level "<repo>-<sha>/" dir.
      const path = header.name.replace(/^[^/]+\//, "");
      const tooMany = files.length >= MAX_FILES;
      const skip =
        header.type !== "file" ||
        tooMany ||
        !shouldScanPath(path) ||
        (header.size ?? 0) > MAX_FILE_BYTES;

      if (skip) {
        stream.on("end", next);
        stream.resume();
        return;
      }

      const chunks: Buffer[] = [];
      stream.on("data", (c: Buffer) => chunks.push(c));
      stream.on("end", () => {
        const content = Buffer.concat(chunks);
        if (!content.includes(0)) files.push({ path, content: content.toString("utf8") });
        next();
      });
      stream.on("error", reject);
    });

    extract.on("finish", () => resolve(files));
    extract.on("error", reject);

    Readable.from(gzipped).pipe(createGunzip()).pipe(extract);
  });
}
