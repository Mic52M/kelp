// User config resolution — env vars + ~/.config/kelp/config.json.
//
// Priority: CLI flag > env var > config file > default. Nothing here reads
// live secrets; the config file just carries an Anthropic API key for the
// agent-driven scan mode (arriving in a future minor release — for now we
// only detect its presence and print a hint).

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface KelpConfig {
  /** Set → agent-driven scans available in a future release. */
  anthropicApiKey: string | null;
  /** Where the config was loaded from, for the "config" line in output. */
  source: "env" | "file" | "none";
  /** Absolute path of the config file, if loaded from one. */
  filePath: string | null;
}

function configPath(): string {
  // Follow XDG_CONFIG_HOME if set, otherwise ~/.config/kelp/config.json.
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : path.join(os.homedir(), ".config");
  return path.join(base, "kelp", "config.json");
}

export function loadConfig(): KelpConfig {
  // Env wins over file.
  if (process.env.ANTHROPIC_API_KEY) {
    return { anthropicApiKey: process.env.ANTHROPIC_API_KEY, source: "env", filePath: null };
  }
  const p = configPath();
  try {
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, "utf8");
      const parsed = JSON.parse(raw) as { anthropicApiKey?: unknown };
      const key = typeof parsed.anthropicApiKey === "string" ? parsed.anthropicApiKey : null;
      return { anthropicApiKey: key, source: "file", filePath: p };
    }
  } catch {
    // Malformed config: treat as no config, don't crash the scan.
  }
  return { anthropicApiKey: null, source: "none", filePath: null };
}

/** The path where a user should write their config, whether it exists or not. */
export function suggestedConfigPath(): string {
  return configPath();
}
