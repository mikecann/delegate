import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export type ClaudeAccount = {
  email: string;
  /** Only used inside employer repos, and the only account allowed there. */
  employerOnly?: boolean;
};

export type Employer = {
  name: string;
  /** Regexes matched against every git remote URL of the repo. */
  remotes: string[];
  /** Folders (and everything under them) that count as employer work. */
  paths: string[];
  /** The only providers that may receive this employer's code. */
  allow: string[];
};

export type Config = {
  dataDir: string;
  mainClaudeConfigDir: string;
  tokenStatsDir: string;
  claudeAccounts: Record<string, ClaudeAccount>;
  employer: Employer | null;
  hook: { blockBelowWeeklyPercent: number; blockBelowFiveHourPercent: number };
  chairPreference: string[];
  panelPreference: string[];
  timeoutMinutes: { read: number; write: number };
};

export const home = homedir();

export function expandHome(path: string): string {
  if (path === "~") return home;
  if (path.startsWith("~/")) return join(home, path.slice(2));
  return path;
}

export function defaultConfig(): Config {
  return {
    dataDir: join(home, ".delegate"),
    mainClaudeConfigDir: join(home, ".claude"),
    tokenStatsDir: join(home, "Library", "Application Support", "Token Stats"),
    claudeAccounts: {
      "claude-gmail": { email: "mike.cann@gmail.com" },
      "claude-convex": { email: "mike.cann@convex.dev", employerOnly: true },
    },
    employer: {
      name: "Convex",
      // Convex's GitHub org was renamed from get-convex to convex (Oct 2026);
      // old remotes still redirect, so match both.
      remotes: ["github\\.com(?::\\d+)?[:/](?:get-)?convex/"],
      paths: ["~/dev/convex/convex-videos"],
      allow: ["claude-convex"],
    },
    hook: { blockBelowWeeklyPercent: 40, blockBelowFiveHourPercent: 15 },
    chairPreference: ["codex", "claude-gmail", "grok", "muse"],
    panelPreference: ["codex", "grok", "muse", "claude-gmail"],
    timeoutMinutes: { read: 20, write: 45 },
  };
}

export function configPath(): string {
  return process.env.DELEGATE_CONFIG ?? join(home, ".config", "delegate", "config.json");
}

/** Defaults, with any keys from the user's config file laid over the top. */
export function loadConfig(path = configPath()): Config {
  const config = defaultConfig();
  if (!existsSync(path)) return config;
  const user = JSON.parse(readFileSync(path, "utf8")) as Partial<Config>;
  const merged: Config = {
    ...config,
    ...user,
    hook: { ...config.hook, ...user.hook },
    timeoutMinutes: { ...config.timeoutMinutes, ...user.timeoutMinutes },
  };
  for (const key of ["dataDir", "mainClaudeConfigDir", "tokenStatsDir"] as const) {
    merged[key] = resolve(expandHome(merged[key]));
  }
  return merged;
}
