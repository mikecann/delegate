import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { home, loadConfig } from "./config.ts";
import { accountFor, cachePath, sessionEmail, type Limits } from "./limits.ts";
import { bestClaude, claudeAccount, findClaudeConfigDir, isSessionProvider, type RunContext } from "./providers.ts";
import { runProcess } from "./process.ts";
import { isolateSessionEnv, fakeProvider, tempDir, testConfig } from "./test-helpers.ts";

isolateSessionEnv();

const limits: Limits = { generatedAt: new Date().toISOString(), source: "test", accounts: [
  { provider: "Claude", email: "mike.cann@gmail.com", configDir: "/accounts/gmail", windows: [{ kind: "weekly", title: "Weekly", remainingPercent: 90 }] },
  { provider: "Claude", email: "mike@cannstudios.com", configDir: join(home, ".claude"), windows: [{ kind: "weekly", title: "Weekly", remainingPercent: 80 }] },
] };
const context: RunContext = { dir: "/tmp", mode: "read", kind: "ask", prompt: "hi", promptFile: "/tmp/p", outputFile: "/tmp/o" };

function withEmail(email: string | undefined, fn: () => void) {
  const before = process.env.CLAUDE_CODE_USER_EMAIL;
  if (email === undefined) delete process.env.CLAUDE_CODE_USER_EMAIL;
  else process.env.CLAUDE_CODE_USER_EMAIL = email;
  try { fn(); } finally {
    if (before === undefined) delete process.env.CLAUDE_CODE_USER_EMAIL;
    else process.env.CLAUDE_CODE_USER_EMAIL = before;
  }
}

describe("session identity and Claude routing", () => {
  test("email wins over the default directory; env wins over config", () => {
    const config = testConfig({ mainClaudeEmail: "mike.cann@gmail.com", mainClaudeConfigDir: join(home, ".claude") });
    withEmail(undefined, () => expect(accountFor(limits, "main", config)?.email).toBe("mike.cann@gmail.com"));
    withEmail(" MIKE@CANNSTUDIOS.COM ", () => {
      expect(sessionEmail(config, limits)).toBe("mike@cannstudios.com");
      expect(accountFor(limits, "main", config)?.configDir).toBe(join(home, ".claude"));
      expect(isSessionProvider("claude-cannstudios", config, limits)).toBe(true);
    });
    withEmail("unknown@example.com", () => expect(accountFor(limits, "main", config)).toBeUndefined());
    withEmail(undefined, () => expect(accountFor(limits, "main", { ...config, mainClaudeEmail: null })?.email).toBe("mike@cannstudios.com"));
  });

  test("live limits resolve the default login before stale account files", () => {
    const config = testConfig({ mainClaudeEmail: "mike.cann@gmail.com" });
    const oldDir = join(config.tokenStatsDir, "Accounts", "old");
    mkdirSync(oldDir, { recursive: true });
    writeFileSync(join(oldDir, ".claude.json"), JSON.stringify({ oauthAccount: { emailAddress: "mike@cannstudios.com" } }));
    mkdirSync(config.dataDir, { recursive: true });
    writeFileSync(cachePath(config), JSON.stringify(limits));
    expect(findClaudeConfigDir("mike@cannstudios.com", config)).toBe(join(home, ".claude"));
    expect(findClaudeConfigDir("mike@cannstudios.com", { ...config, dataDir: tempDir() })).toBe(oldDir);
    const provider = claudeAccount("claude-cannstudios", "mike@cannstudios.com", config);
    const invocation = provider.invocation(context);
    expect(invocation.env?.CLAUDE_CONFIG_DIR).toBeNull();
    expect(invocation.args).toContain("--strict-mcp-config");
    expect(invocation.args.at(invocation.args.indexOf("--model") + 1)).toBe("opus");
    expect(provider.invocation({ ...context, top: true }).args).toContain("claude-fable-5-1");
    expect(provider.invocation({ ...context, model: "sonnet", top: true }).args).toContain("sonnet");
    expect(claudeAccount("claude-gmail", "mike.cann@gmail.com", config).invocation(context).env?.CLAUDE_CONFIG_DIR).toBe("/accounts/gmail");
  });

  test("claude alias chooses the tightest-window headroom, excludes self and low quota", () => {
    withEmail(undefined, () => {
      const config = testConfig({ mainClaudeEmail: "mike.cann@gmail.com" });
      const gmail = fakeProvider("", "claude-gmail", "anthropic");
      const cann = fakeProvider("", "claude-cannstudios", "anthropic");
      expect(bestClaude([gmail, cann], config, limits)?.id).toBe(cann.id);
      const low = structuredClone(limits);
      low.accounts[1].windows.push({ kind: "five_hour", title: "5-hour", remainingPercent: 2 });
      expect(bestClaude([gmail, cann], config, low)).toBeUndefined();
      expect(bestClaude([gmail], config, null)).toBeUndefined();
    });
  });

  test("old account maps gain cannstudios when loading config", () => {
    const path = join(tempDir(), "config.json");
    writeFileSync(path, JSON.stringify({ claudeAccounts: { "claude-gmail": { email: "custom@example.com" } } }));
    expect(loadConfig(path).claudeAccounts["claude-cannstudios"].email).toBe("mike@cannstudios.com");
    expect(loadConfig(path).claudeAccounts["claude-gmail"].email).toBe("custom@example.com");
  });
});

test("process env can remove inherited variables and always marks children", async () => {
  const dir = tempDir();
  const before = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = "/inherited/other-login";
  try {
    const result = await runProcess({ command: process.execPath, args: ["-e", 'console.log(JSON.stringify({hasPath: "PATH" in process.env, hasClaudeDir: "CLAUDE_CONFIG_DIR" in process.env, child: process.env.DELEGATE_CHILD}))'], cwd: dir,
      env: { PATH: null, CLAUDE_CONFIG_DIR: null, DELEGATE_CHILD: "0" }, stdoutFile: join(dir, "out"), stderrFile: join(dir, "err"), timeoutMs: 5000 });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, "out"), "utf8"))).toEqual({ hasPath: false, hasClaudeDir: false, child: "1" });
  } finally {
    if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = before;
  }
});

test("Claude alias respects the unchanged employer boundary and tightest-window ranking", async () => {
  const { allowedProviderIds } = await import("./policy.ts");
  const config = testConfig({ mainClaudeEmail: "mike.cann@gmail.com" });
  const candidates = [fakeProvider("", "claude-gmail", "anthropic"), fakeProvider("", "claude-cannstudios", "anthropic"), { ...fakeProvider("", "claude-convex", "anthropic"), employerOnly: true }];
  const work = allowedProviderIds("/tmp", config, candidates, true);
  const personal = allowedProviderIds("/tmp", config, candidates, false);
  expect(bestClaude(candidates.filter((p) => work.includes(p.id)), config, limits)?.id).toBe("claude-convex");
  expect(bestClaude(candidates.filter((p) => personal.includes(p.id)), config, limits)?.id).toBe("claude-cannstudios");
  const rooms = structuredClone(limits);
  rooms.accounts.push({ provider: "Claude", email: "other@example.com", windows: [{ kind: "weekly", title: "Weekly", remainingPercent: 70 }] });
  config.claudeAccounts["claude-other"] = { email: "other@example.com" };
  const other = fakeProvider("", "claude-other", "anthropic");
  const cann = candidates[1];
  expect(bestClaude([other, cann], config, rooms)?.id).toBe(cann.id);
  rooms.accounts[1].windows.push({ kind: "five_hour", title: "5-hour", remainingPercent: 65 });
  expect(bestClaude([other, cann], config, rooms)?.id).toBe(other.id);
});

test("Claude read and write invocations keep strict MCP and sandbox flags", () => {
  const config = testConfig();
  mkdirSync(config.dataDir, { recursive: true });
  writeFileSync(cachePath(config), JSON.stringify(limits));
  const provider = claudeAccount("claude-cannstudios", "mike@cannstudios.com", config);
  for (const mode of ["read", "write"] as const) {
    const invocation = provider.invocation({ ...context, mode });
    expect(invocation.args).toContain("--strict-mcp-config");
    expect(invocation.env?.CLAUDE_CONFIG_DIR).toBeNull();
    const sandbox = JSON.parse(invocation.args[invocation.args.indexOf("--settings") + 1]).sandbox;
    expect(sandbox.enabled).toBe(true);
    expect(sandbox.allowUnsandboxedCommands).toBe(false);
    expect(sandbox.failIfUnavailable).toBe(true);
    expect(invocation.args[invocation.args.indexOf("--allowedTools") + 1].includes("Edit(./**)")).toBe(mode === "write");
  }
  withEmail("mike@cannstudios.com", () => expect(provider.unavailable()).toBe("that's the account this session runs on"));
});
