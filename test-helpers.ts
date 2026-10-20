import { beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { defaultConfig, type Config } from "./config.ts";
import type { Limits } from "./limits.ts";
import type { Provider } from "./providers.ts";

export function tempDir(prefix = "delegate-test-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function testConfig(overrides: Partial<Config> = {}): Config {
  const root = tempDir();
  return { ...defaultConfig(), dataDir: join(root, "data"), tokenStatsDir: join(root, "token-stats"), mainClaudeConfigDir: "/home/me/.claude", mainClaudeEmail: "me@main.com", ...overrides };
}

export function git(cwd: string, ...args: string[]) {
  const result = spawnSync("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout;
}

export function tempRepo(): string {
  const dir = tempDir("delegate-repo-");
  git(dir, "init", "-q", "-b", "main");
  writeFileSync(join(dir, "a.txt"), "one\n");
  mkdirSync(join(dir, "sub"));
  writeFileSync(join(dir, "sub", "b.txt"), "two\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init");
  return dir;
}

/** A provider that runs a shell script instead of an AI CLI. */
export function fakeProvider(script: string, id = "fake", lab: Provider["lab"] = "openai"): Provider {
  return {
    id, lab, label: id, enforcesReadOnly: true, sandboxesWrites: true,
    unavailable: () => null,
    invocation: (ctx) => ({ command: "bash", args: ["-c", script], env: { PROMPT_FILE: ctx.promptFile, OUT_FILE: ctx.outputFile } }),
    parse: (stdout) => ({ text: stdout.trim(), error: stdout.trim() ? undefined : "nothing printed" }),
  };
}

export function limitsFixture(): Limits {
  return {
    generatedAt: new Date().toISOString(),
    source: "test",
    accounts: [
      { provider: "Claude", email: "me@main.com", configDir: "/home/me/.claude", windows: [
        { kind: "five_hour", title: "5-hour", remainingPercent: 90 },
        { kind: "weekly", title: "Weekly", remainingPercent: 78, resetsText: "resets Wed 5:00 am" },
      ] },
      { provider: "Claude", email: "mike.cann@gmail.com", configDir: "/x/claude-1", windows: [
        { kind: "weekly", title: "Weekly", remainingPercent: 60 },
      ] },
      { provider: "Codex", email: "mike.cann@gmail.com", configDir: "/home/me/.codex", windows: [
        { kind: "weekly", title: "Weekly", remainingPercent: 97 },
      ] },
      { provider: "Grok", windows: [{ kind: "weekly", title: "Weekly", remainingPercent: 5 }] },
      { provider: "Muse", windows: [] },
    ],
  };
}

export function withMainWeekly(limits: Limits, percent: number): Limits {
  const copy = structuredClone(limits);
  copy.accounts[0].windows[1].remainingPercent = percent;
  return copy;
}

/** Tests must not inherit the desktop session's identity or nesting flag. */
export function isolateSessionEnv() {
  let email: string | undefined;
  let child: string | undefined;
  beforeEach(() => {
    email = process.env.CLAUDE_CODE_USER_EMAIL;
    child = process.env.DELEGATE_CHILD;
    delete process.env.CLAUDE_CODE_USER_EMAIL;
    delete process.env.DELEGATE_CHILD;
  });
  afterEach(() => {
    if (email === undefined) delete process.env.CLAUDE_CODE_USER_EMAIL;
    else process.env.CLAUDE_CODE_USER_EMAIL = email;
    if (child === undefined) delete process.env.DELEGATE_CHILD;
    else process.env.DELEGATE_CHILD = child;
  });
}
