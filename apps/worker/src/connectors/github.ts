// Real GitHub connector. Authenticates as the GitHub App installation, reads a
// repository's files (for the secret scan), and can list the repos the app is
// installed on. Uses the official @octokit/app SDK, which handles the App JWT
// and installation-token exchange.
//
// Scope used: Contents (read) to fetch files, Pull requests (write) for fixes
// (PR creation lands in a follow-up). Nothing is written during a scan.

import { App } from "@octokit/app";
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

      const { data: repoInfo } = await withRetry(() =>
        kit.request("GET /repos/{owner}/{repo}", { owner, repo }),
      );
      const branch = repoInfo.default_branch;

      // One recursive tree call gives every path + blob sha + size.
      const { data: tree } = await withRetry(() =>
        kit.request("GET /repos/{owner}/{repo}/git/trees/{tree_sha}", {
          owner,
          repo,
          tree_sha: branch,
          recursive: "1",
        }),
      );

      const blobs = (tree.tree ?? [])
        .filter(
          (n): n is typeof n & { path: string; sha: string } =>
            n.type === "blob" &&
            typeof n.path === "string" &&
            typeof n.sha === "string" &&
            shouldScanPath(n.path) &&
            (n.size ?? 0) <= MAX_FILE_BYTES,
        )
        .slice(0, MAX_FILES);

      const files: SourceFile[] = [];
      // Fetch blob contents. Sequential keeps us well under rate limits for MVP.
      for (const b of blobs) {
        const { data: blob } = await withRetry(() =>
          kit.request("GET /repos/{owner}/{repo}/git/blobs/{file_sha}", {
            owner,
            repo,
            file_sha: b.sha,
          }),
        );
        if (blob.encoding !== "base64") continue;
        const content = Buffer.from(blob.content, "base64");
        if (content.includes(0)) continue; // skip binary files
        files.push({ path: b.path, content: content.toString("utf8") });
      }

      return files;
    },
  };
}
