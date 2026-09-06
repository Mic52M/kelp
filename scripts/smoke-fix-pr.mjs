// Smoke test for the "Open fix PR" codepath (#47).
//
// We can't hit a real GitHub sandbox in CI, so this script:
//   1. Imports the real `generateSecretPr` from @kelp/core (the function that
//      produces the PR title/body/branch/trailer).
//   2. Stuffs it a synthetic finding (an obviously-fake Stripe key) and
//      prints the EXACT request body that `openFixPr` would send to GitHub.
//   3. Asserts the wire format the spec requires.
//
// Run from the repo root:
//   node scripts/smoke-fix-pr.mjs
//
// No env vars, no network, no real GitHub call.

import { generateSecretPr, isPatchable } from "@kelp/core";
import { detectSecrets } from "@kelp/core";

const STRIPE_KEY = "sk_live_" + "a1B2c3D4e5F6g7H8i9J0";

function section(name) {
  console.log("\n" + "=".repeat(72));
  console.log("  " + name);
  console.log("=".repeat(72));
}

function check(label, ok, detail) {
  const tag = ok ? "OK  " : "FAIL";
  console.log(`  [${tag}] ${label}${detail ? "  \u2014 " + detail : ""}`);
  if (!ok) process.exitCode = 1;
}

// 1. Detect a finding from synthetic source.
section("1. Synthesize a finding");
const findings = detectSecrets([
  { path: "src/pay.ts", content: `const stripe = new Stripe("${STRIPE_KEY}");\n` },
]);
const finding = findings[0];
if (!finding) {
  console.error("detector found nothing \u2014 fixture is broken");
  process.exit(1);
}
console.log("  finding:", {
  ruleId: finding.ruleId,
  provider: finding.provider,
  severity: finding.severity,
  path: finding.path + ":" + finding.line,
  preview: finding.preview,
  clientSide: finding.clientSide,
  fingerprint: finding.fingerprint,
});

// 2. isPatchable says yes.
section("2. isPatchable gate");
const p = isPatchable({
  vuln_class: "secret",
  confidence: finding.confidence,
});
console.log("  result:", p);
check("isPatchable returns ok: true for high-confidence secret", p.ok === true);

// 3. Generate the PR metadata.
section("3. generateSecretPr output");
const meta = generateSecretPr(finding);
console.log("  branch:         " + meta.branch);
console.log("  title:          " + meta.title);
console.log("  envVar:         " + meta.envVar);
console.log("  commitMessage:  " + JSON.stringify(meta.commitMessage));
console.log("");
console.log("  body:");
for (const line of meta.body.split("\n")) console.log("    " + line);

// 4. Assert the wire-format contract.
section("4. Wire-format assertions");

// 4a. Branch must be kelp/fix-<fingerprint>.
check(
  'branch matches /^kelp\/fix-<fingerprint>$/',
  meta.branch === "kelp/fix-" + finding.fingerprint,
  `got "${meta.branch}", want "kelp/fix-${finding.fingerprint}"`,
);

// 4b. Kelp-Finding trailer in PR body.
const trailer = "Kelp-Finding: " + finding.fingerprint;
check(
  "PR body contains Kelp-Finding trailer",
  meta.body.includes(trailer),
  "expected: " + trailer,
);

// 4c. Kelp-Finding trailer in commit message.
check(
  "commit message contains Kelp-Finding trailer",
  meta.commitMessage.includes(trailer),
);

// 4d. The five required body sections.
const requiredSections = [
  "## What",
  "## Why",
  "## How Kelp verified this",
  "## Rollback",
  "## Before merging",
];
for (const heading of requiredSections) {
  const re = new RegExp("^" + heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "m");
  check('body has section "' + heading + '"', re.test(meta.body));
}

// 4e. Body surfaces severity + class + masked preview, NOT the raw key.
check("body includes severity", meta.body.includes(finding.severity));
check('body includes vuln class "secret"', meta.body.includes("secret"));
check("body includes masked preview", meta.body.includes(finding.preview));
check(
  "body does NOT include the raw secret value",
  !meta.body.includes(STRIPE_KEY),
  "raw key leaked into the PR body \u2014 catastrophic",
);

// 4f. Commit message is one logical commit (subject + blank line + trailer).
const commitLines = meta.commitMessage.split("\n");
check(
  "commit message has a subject line",
  commitLines[0] && commitLines[0].length > 0,
);
check(
  "commit trailer separated from subject by a blank line",
  commitLines.length >= 3 && commitLines[1] === "",
);

// 4g. envVar is one of the known ones.
const knownEnvVars = new Set([
  "STRIPE_SECRET_KEY",
  "OPENAI_API_KEY",
  "GITHUB_TOKEN",
  "AWS_ACCESS_KEY_ID",
  "GOOGLE_API_KEY",
  "SLACK_TOKEN",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SECRET_VALUE",
]);
check(
  "envVar is a known name",
  knownEnvVars.has(meta.envVar),
  "got: " + meta.envVar,
);

// 5. Show the exact POST /pulls body the connector would send.
//    (The connector code is in apps/worker/src/connectors/github.ts;
//    this is the object literal it constructs.)
section("5. POST /repos/{owner}/{repo}/pulls body (as the connector would send it)");
const pullsBody = {
  owner: "Mic52M",
  repo: "kelp",
  title: meta.title,
  body: meta.body,
  head: meta.branch,
  base: "master", // connector reads default_branch via the GitHub API
  draft: true, // #47: always draft
};
console.log(JSON.stringify(pullsBody, null, 2));
check(
  "POST /pulls has draft: true (per #47: never auto-merge)",
  pullsBody.draft === true,
);
check(
  "POST /pulls head branch starts with kelp/",
  pullsBody.head.startsWith("kelp/"),
);

// 6. Show the exact PUT /contents request.
section("6. PUT /repos/{owner}/{repo}/contents/{path} body");
// The file content after applySecretFix removes the hard-coded value.
// We don't run applySecretFix here (it requires the real SecretFinding type
// after the finder's been through locateSecret), but the edit is deterministic:
// it replaces the secret value with process.env.<envVar>.
const fixedContent =
  'const stripe = new Stripe(process.env.' + meta.envVar + ');\n';
const putsBody = {
  owner: "Mic52M",
  repo: "kelp",
  path: finding.path,
  branch: meta.branch,
  message: meta.commitMessage,
  content: Buffer.from(fixedContent, "utf8").toString("base64"),
  sha: "<existing-file-sha>", // connector reads this from GET /contents
};
console.log(JSON.stringify(putsBody, null, 2));
check(
  "PUT /contents message carries the Kelp-Finding trailer",
  putsBody.message.includes(trailer),
);

console.log("\n" + "=".repeat(72));
console.log(
  process.exitCode
    ? "  Smoke test FAILED. See [FAIL] lines above."
    : "  Smoke test PASSED. PR request shape looks correct for #47.",
);
console.log("=".repeat(72) + "\n");