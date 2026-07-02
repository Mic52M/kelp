// Runs a REAL secret scan against a repository the GitHub App is installed on.
//
//   npm run build
//   node --env-file=.env.local apps/worker/dist/scan-github.js [owner/repo]
//
// With no argument it lists the installation's repos and scans the first one.

import { detectSecrets } from "@kelp/core";
import { createGitHubConnector } from "./connectors/github.js";

const SEV_ICON: Record<string, string> = { critical: "🔴", high: "🟠", medium: "🟡", low: "🔵" };

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name} (did you pass --env-file=.env.local?)`);
  return v;
}

async function main() {
  const connector = createGitHubConnector({
    appId: requireEnv("GITHUB_APP_ID"),
    privateKey: Buffer.from(requireEnv("GITHUB_APP_PRIVATE_KEY_BASE64"), "base64").toString("utf8"),
    installationId: Number(requireEnv("GITHUB_APP_INSTALLATION_ID")),
  });

  const repos = await connector.listRepos();
  if (repos.length === 0) {
    console.log("The app has no repositories. Install it on a repo and retry.");
    return;
  }
  console.log(`\nInstallation can access ${repos.length} repo(s):`);
  for (const r of repos) console.log(`  · ${r}`);

  const target = process.argv[2] ?? repos[0]!;
  console.log(`\n▶ scanning ${target} for exposed secrets…\n`);

  const files = await connector.listSourceFiles(target);
  console.log(`  read ${files.length} scannable file(s)`);

  const findings = detectSecrets(files);
  if (findings.length === 0) {
    console.log("\n✓ No secrets found in the scanned files.\n");
    return;
  }

  console.log(`\n${findings.length} finding(s):\n`);
  for (const f of findings) {
    console.log(
      `  ${SEV_ICON[f.severity]} ${f.title}` +
        `\n       ↳ ${f.path}:${f.line}  (${f.preview})` +
        (f.clientSide ? "  · ships to the browser" : ""),
    );
  }
  console.log();
}

main().catch((e) => {
  console.error("scan failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
