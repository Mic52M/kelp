# @kelp-security/cli — changelog

## 0.4.0 — 2026-09-01

**Critical fix**

- Tool-result contents no longer leak into the CLI transcript. Previous
  versions of the agent mode printed truncated `read_file` output directly
  to stderr, which meant `.env` files (and any real secrets in them) could
  end up in a saved log. The renderer now emits a safe summary
  (`read_file → 2.1 KB`, `grep → 4 matches`, `list_files → 87 files`). The
  model still receives the full content — only the human-facing renderer
  is redacted. **Upgrade immediately if you ran 0.3.0 against a real
  project.**

**New**

- `--depth <preset>` picks model + cost cap + iteration cap together:
  `quick` (haiku, $0.15, 10), `standard` (sonnet, $1.00, 24, default),
  `thorough` (sonnet, $3.00, 40), `paranoid` (opus, $10.00, 80).
- `--focus <classes>` narrows the agent to specific classes:
  `secrets`, `auth`, `rls`, `edge-fn`, `redirects`. Comma-separated.
- `--observations` surfaces the agent's soft hints (things it noticed but
  couldn't cite evidence for) as a separate section, not as findings.
- `--dry-run` shows what would be scanned and the worst-case cost without
  calling the Anthropic API.
- `--no-static` skips the static checks (agent-only run).
- `--static-only` is now explicit (default when `--agent` is not passed).
- Agent findings are now part of the final report, with the same severity
  chips and file:line layout as static findings, plus a run-summary block
  (model, iterations, cost, duration, aborted reason if any).

**Prompt tuning**

- The agent system prompt now demands finding-first behaviour: any
  concrete evidence must be filed via `report_finding` immediately, before
  exploring further. Prior versions could hit the cost cap after
  identifying real vulnerabilities but before calling the reporting tool.

## 0.3.0 — 2026-09-01

- First multi-agent scan (`--agent`). Deprecated in favour of 0.4.0 due
  to the tool-result leak described above.

## 0.2.2 — 2026-08-31

- Transparent static scan: prints every check that ran + every check that
  was skipped because it needs a live target.

## 0.2.1 — 2026-08-31

- Bundle `@kelp/core` with esbuild so `npm i -g @kelp-security/cli` works
  without pulling a workspace-only package.

## 0.2.0 — 2026-08-31

- First public release on npm.
