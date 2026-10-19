import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { home, type Config } from "./config.ts";
import { DELEGATE_SYSTEM_NOTE } from "./text.ts";

export type Mode = "read" | "write";
export type Kind = "ask" | "review" | "research" | "implement";
export type Lab = "openai" | "xai" | "meta" | "anthropic";

export type RunContext = {
  dir: string;
  mode: Mode;
  kind: Kind;
  prompt: string;
  promptFile: string;
  outputFile: string;
  model?: string;
  effort?: string;
  /** Ask for the provider's strongest model, e.g. for consensus. */
  top?: boolean;
};

export type Invocation = {
  command: string;
  args: string[];
  env?: Record<string, string>;
  stdin?: string;
};

export type Parsed = {
  text: string;
  tokens?: number;
  costUsd?: number;
  error?: string;
};

export type Provider = {
  id: string;
  lab: Lab;
  label: string;
  employerOnly?: boolean;
  /** Its read-only mode really stops writes (checked live), so it can run in place outside git. */
  enforcesReadOnly: boolean;
  /** Its write mode runs in an OS sandbox, so links to the caller's dependencies are safe. */
  sandboxesWrites: boolean;
  /** Null when ready, otherwise why it can't run. */
  unavailable(): string | null;
  invocation(ctx: RunContext): Invocation;
  parse(stdout: string, ctx: RunContext): Parsed;
};

const which = (command: string) => Bun.which(command) ?? null;

function readText(path: string): string {
  try { return readFileSync(path, "utf8"); } catch { return ""; }
}

/** Pull the first JSON object out of output that may have log lines around it. */
export function firstJsonObject(text: string): any | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

/**
 * Build caches Codex's write sandbox otherwise blocks, which breaks Swift and
 * clang builds. Only these specific tools' caches, never all of ~/Library/Caches.
 */
const CODEX_WRITABLE_CACHES = [".cache/clang", "Library/Caches/org.swift.swiftpm", ".bun/install/cache", ".npm/_cacache"];

function writableCaches(): string[] {
  return CODEX_WRITABLE_CACHES.map((rel) => join(home, rel)).filter((path) => existsSync(path));
}

export const codex: Provider = {
  id: "codex",
  lab: "openai",
  label: "Codex (ChatGPT)",
  enforcesReadOnly: true,
  sandboxesWrites: true,
  unavailable() {
    if (!which("codex")) return "codex isn't installed";
    if (!existsSync(join(process.env.CODEX_HOME ?? join(home, ".codex"), "auth.json"))) return "codex isn't signed in (run `codex login`)";
    return null;
  },
  invocation(ctx) {
    const write = ctx.mode === "write";
    return {
      command: "codex",
      args: [
        ...(ctx.kind === "research" ? ["--search"] : []),
        "exec", "--skip-git-repo-check", "--ephemeral", "-C", ctx.dir,
        "-s", write ? "workspace-write" : "read-only",
        "-c", 'approval_policy="never"',
        ...(write ? writableCaches().flatMap((dir) => ["--add-dir", dir]) : []),
        ...(ctx.model ? ["-m", ctx.model] : []),
        ...(ctx.effort ? ["-c", `model_reasoning_effort="${ctx.effort}"`] : []),
        "--json", "-o", ctx.outputFile, "-",
      ],
      stdin: ctx.prompt,
    };
  },
  parse(stdout, ctx) {
    let tokens = 0;
    let error: string | undefined;
    for (const line of stdout.split("\n")) {
      if (!line.startsWith("{")) continue;
      try {
        const event = JSON.parse(line);
        if (event.type === "turn.completed" && event.usage) {
          tokens += (event.usage.input_tokens ?? 0) + (event.usage.output_tokens ?? 0);
        }
        if (event.type === "turn.failed" || event.type === "error") {
          error = event.error?.message ?? event.message ?? JSON.stringify(event).slice(0, 300);
        }
      } catch {}
    }
    return { text: readText(ctx.outputFile).trim(), tokens: tokens || undefined, error };
  },
};

export const grok: Provider = {
  id: "grok",
  lab: "xai",
  label: "Grok",
  enforcesReadOnly: false,
  sandboxesWrites: true,
  unavailable() {
    if (!which("grok")) return "grok isn't installed";
    if (!existsSync(join(home, ".grok", "auth.json"))) return "grok isn't signed in (run `grok login`)";
    return null;
  },
  invocation(ctx) {
    return {
      command: "grok",
      args: [
        "--prompt-file", ctx.promptFile, "--output-format", "json", "--cwd", ctx.dir,
        // Headless runs can't answer approval prompts. Read-only work runs in a
        // throwaway snapshot, because Grok's sandbox profiles still allow writes
        // inside the workspace.
        "--always-approve", "--sandbox", "workspace",
        ...(ctx.model ? ["-m", ctx.model] : []),
        ...(ctx.effort ? ["--effort", ctx.effort] : []),
      ],
    };
  },
  parse(stdout) {
    const json = firstJsonObject(stdout);
    if (!json) return { text: stdout.trim(), error: stdout.trim() ? undefined : "grok printed nothing" };
    return {
      text: String(json.text ?? "").trim(),
      tokens: json.usage?.total_tokens,
      costUsd: json.total_cost_usd,
      error: json.stopReason && json.stopReason !== "end_turn" ? `stopped: ${json.stopReason}` : undefined,
    };
  },
};

export const muse: Provider = {
  id: "muse",
  lab: "meta",
  label: "Muse (Meta)",
  enforcesReadOnly: false,
  sandboxesWrites: true,
  unavailable() {
    if (!which("muse")) return "muse isn't installed";
    if (!existsSync(join(home, ".config", "muse", "auth.json"))) return "muse isn't signed in (run `muse login`)";
    return null;
  },
  invocation(ctx) {
    return {
      command: "muse",
      args: [
        "exec", "--prompt-file", ctx.promptFile, "--workspace", ctx.dir,
        "--approval-mode", "never", "--trust-workspace", "--no-session-log",
        ...(ctx.mode === "read" ? ["--disable-write"] : []),
        ...(ctx.model ? ["--model", ctx.model] : []),
        ...(ctx.effort ? ["--reasoning-effort", ctx.effort] : []),
      ],
    };
  },
  parse(stdout) {
    // Muse's banner lines go to stderr, so stdout is just the final answer.
    const text = stdout.trim();
    return { text, error: text ? undefined : "muse printed nothing" };
  },
};

const CLAUDE_READ_TOOLS = [
  "Read", "Grep", "Glob", "WebSearch", "WebFetch",
  "Bash(git log *)", "Bash(git diff *)", "Bash(git show *)", "Bash(git status *)", "Bash(git blame *)",
  "Bash(ls *)", "Bash(rg *)",
];

// Write mode adds edits inside the working directory and any shell command.
// Claude Code's own sandbox keeps those commands from writing outside it.
const CLAUDE_WRITE_TOOLS = [...CLAUDE_READ_TOOLS, "Edit(./**)", "Write(./**)", "NotebookEdit(./**)", "Bash"];

/**
 * Claude Code's OS sandbox for Bash: writes only inside the working directory
 * (and temp), no way to ask for an unsandboxed command, and no running at all
 * if the sandbox isn't available. Checked live: it blocks
 * `echo > ~/x` and `git diff --output=~/x`, which an allow list alone doesn't.
 */
const CLAUDE_SANDBOX = JSON.stringify({ sandbox: { enabled: true, failIfUnavailable: true, autoAllowBashIfSandboxed: true, allowUnsandboxedCommands: false } });

/** Find the CLAUDE_CONFIG_DIR whose login belongs to this email. */
export function findClaudeConfigDir(email: string, config: Config): string | null {
  const accounts = join(config.tokenStatsDir, "Accounts");
  const candidates = existsSync(accounts)
    ? readdirSync(accounts).map((name) => join(accounts, name))
    : [];
  for (const dir of candidates) {
    try {
      const json = JSON.parse(readFileSync(join(dir, ".claude.json"), "utf8"));
      if (json.oauthAccount?.emailAddress?.toLowerCase() === email.toLowerCase()) return dir;
    } catch {}
  }
  return null;
}

export function claudeAccount(id: string, email: string, config: Config, employerOnly = false): Provider {
  const configDir = () => findClaudeConfigDir(email, config);
  return {
    id,
    lab: "anthropic",
    label: `Claude (${email})`,
    employerOnly,
    // `git diff --no-index --output=x` can still write inside the working directory,
    // so outside git it needs a snapshot or --in-place like Grok and Muse.
    enforcesReadOnly: false,
    sandboxesWrites: true,
    unavailable() {
      if (!which("claude")) return "claude isn't installed";
      if (!configDir()) return `no Claude login for ${email} (add it in Token Stats with Add account)`;
      return null;
    },
    invocation(ctx) {
      const tools = ctx.mode === "write" ? CLAUDE_WRITE_TOOLS : CLAUDE_READ_TOOLS;
      return {
        command: "claude",
        args: [
          "-p", "--output-format", "json", "--no-session-persistence",
          "--permission-mode", "dontAsk", "--allowedTools", tools.join(","),
          "--settings", CLAUDE_SANDBOX,
          "--append-system-prompt", DELEGATE_SYSTEM_NOTE,
          "--model", ctx.model ?? (ctx.top ? "claude-fable-5-1" : "sonnet"),
          ...(ctx.effort ? ["--effort", ctx.effort] : []),
        ],
        env: { CLAUDE_CONFIG_DIR: configDir() ?? "" },
        stdin: ctx.prompt,
      };
    },
    parse(stdout) {
      const json = firstJsonObject(stdout);
      if (!json) return { text: stdout.trim(), error: "claude didn't print JSON" };
      const usage = json.usage ?? {};
      const tokens = (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0) +
        (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
      return {
        text: String(json.result ?? "").trim(),
        tokens: tokens || undefined,
        costUsd: json.total_cost_usd,
        error: json.is_error ? String(json.result ?? json.subtype ?? "claude reported an error").slice(0, 300) : undefined,
      };
    },
  };
}

export function allProviders(config: Config): Provider[] {
  return [
    codex, grok, muse,
    ...Object.entries(config.claudeAccounts).map(([id, account]) => claudeAccount(id, account.email, config, account.employerOnly)),
  ];
}

export function providerById(id: string, config: Config): Provider | undefined {
  return allProviders(config).find((p) => p.id === id);
}
