// Real GitHub connector. Authenticates as the GitHub App installation, reads a
// repository's files (for the secret scan), and can list the repos the app is
// installed on. Uses the official @octokit/app SDK, which handles the App JWT
// and installation-token exchange.
//
// Scope used: Contents (read) to fetch files, Pull requests (write) for fixes
// (PR creation lands in a follow-up). Nothing is written during a scan.

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

export interface RealGitHubConnector extends GitHubConnector {
  /** repos the installation can access, as "owner/repo". */
  listRepos(): Promise<string[]>;
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

    async listSourceFiles(repoFullName: string): Promise<SourceFile[]> {
      const kit = await octokit();
      const [owner, repo] = repoFullName.split("/");
      if (!owner || !repo) throw new Error(`invalid repo "${repoFullName}"`);

      // One request: download the repo tarball (default branch). Far fewer API
      // calls than fetching each blob, so no secondary rate limits and it's fast.
      const res = await withRetry(() =>
        kit.request("GET /repos/{owner}/{repo}/tarball", { owner, repo }),
      );
      const gzipped = Buffer.from(res.data as ArrayBuffer);

      return extractSourceFiles(gzipped);
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
