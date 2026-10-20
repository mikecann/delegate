import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cachePath } from "./limits.ts";
import { limitsFixture, tempDir, testConfig } from "./test-helpers.ts";

function cli(args: string[], options: { env?: Record<string, string>; config?: ReturnType<typeof testConfig>; input?: string } = {}) {
  const config = options.config ?? testConfig();
  const dir = tempDir();
  const path = join(dir, "config.json");
  writeFileSync(path, JSON.stringify(config));
  return spawnSync(process.execPath, [join(import.meta.dir, "index.ts"), ...args], {
    cwd: dir, input: options.input ?? "{}", encoding: "utf8", timeout: 5000,
    // Empty PATH prevents any real CLI being discovered or called.
    env: { ...process.env, PATH: "", CLAUDE_CODE_USER_EMAIL: "", DELEGATE_CHILD: "", DELEGATE_CONFIG: path, ...options.env },
  });
}

test("nested run and consensus refuse before reading briefs or config", () => {
  for (const command of ["run", "consensus"]) {
    const out = cli([command, "--brief", "-"], { env: { DELEGATE_CHILD: "1", DELEGATE_CONFIG: "/nonexistent/config.json" } });
    expect(out.status).toBe(2);
    expect(out.stdout).toBe("");
    expect(out.stderr.trim().split("\n")).toHaveLength(1);
    expect(out.stderr).toContain("nested delegation is disabled");
  }
});

test("every nested hook subcommand is silent and cannot mutate pause state", () => {
  const config = testConfig();
  for (const sub of ["session-start", "pre-tool-use", "user-prompt-submit", "pause", "resume", "status", "unknown"]) {
    const out = cli(["hook", sub], { config, env: { DELEGATE_CHILD: "1", DELEGATE_CONFIG: "/nonexistent/config.json" } });
    expect(out.status).toBe(0);
    expect(out.stdout + out.stderr).toBe("");
  }
  expect(existsSync(join(config.dataDir, "hook-paused-until"))).toBe(false);
});

test("self refuses with a one-line reason before looking for a CLI", () => {
  const out = cli(["run", "--to", "claude-gmail", "test"], { env: { CLAUDE_CODE_USER_EMAIL: "mike.cann@gmail.com" } });
  expect(out.status).toBe(2);
  expect(out.stderr.trim()).toBe("delegate: claude-gmail: that's the account this session runs on");
});

test("claude alias clearly reports when no account qualifies", () => {
  const out = cli(["run", "--to", "claude", "test"]);
  expect(out.status).toBe(2);
  expect(out.stderr).toContain("no allowed, non-self Claude account");
});

test("providers labels the session account even when it is not installed", () => {
  const config = testConfig();
  mkdirSync(config.dataDir, { recursive: true });
  writeFileSync(cachePath(config), JSON.stringify(limitsFixture()));
  const out = cli(["providers"], { config, env: { CLAUDE_CODE_USER_EMAIL: "mike.cann@gmail.com" } });
  expect(out.status).toBe(0);
  expect(out.stdout.split("\n").find((l) => l.startsWith("claude-gmail"))).toContain("this session");
});

test("prompt hook reads cached limits without a provider refresh and tolerates malformed config", () => {
  const config = testConfig();
  const limits = limitsFixture();
  // Stale but still usable. Relative resets must be anchored to this timestamp.
  limits.generatedAt = new Date(Date.now() - 31 * 60_000).toISOString();
  limits.accounts[0].windows[1] = { kind: "weekly", title: "Weekly", remainingPercent: 40, resetsAt: new Date(Date.now() + 0.5 * 7 * 86400000).toISOString() };
  mkdirSync(config.dataDir, { recursive: true });
  writeFileSync(cachePath(config), JSON.stringify(limits));
  const out = cli(["hook", "user-prompt-submit"], { config });
  expect(out.status).toBe(0);
  const hook = JSON.parse(out.stdout).hookSpecificOutput;
  expect(hook.hookEventName).toBe("UserPromptSubmit");
  expect(hook.additionalContext).toContain("40% of its weekly limit left and 50% of the week to go");
  expect(hook.additionalContext).toContain("behind pace");
  limits.accounts[0].windows[1].remainingPercent = 90;
  writeFileSync(cachePath(config), JSON.stringify(limits));
  expect(cli(["hook", "user-prompt-submit"], { config }).stdout).toBe("");
  const broken = join(tempDir(), "broken.json");
  writeFileSync(broken, "{");
  const bad = cli(["hook", "user-prompt-submit"], { env: { DELEGATE_CONFIG: broken } });
  expect(bad.status).toBe(0);
  expect(bad.stdout + bad.stderr).toBe("");
});
