import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { home, loadConfig } from "./config.ts";
import { accountFor, cachePath, readCachedLimits, sessionEmail, type Limits } from "./limits.ts";
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
  test("session email wins; outside Claude the protected main supplies the budget", () => {
    const config = testConfig({ mainClaudeEmail: "mike.cann@gmail.com", mainClaudeConfigDir: join(home, ".claude") });
    withEmail(undefined, () => expect(accountFor(limits, "main", config)?.email).toBe("mike.cann@gmail.com"));
    withEmail(" MIKE@CANNSTUDIOS.COM ", () => {
      expect(sessionEmail(config, limits)).toBe("mike@cannstudios.com");
      expect(accountFor(limits, "main", config)?.configDir).toBe(join(home, ".claude"));
      expect(isSessionProvider("claude-cannstudios", config, limits)).toBe(true);
    });
    withEmail("unknown@example.com", () => expect(accountFor(limits, "main", config)).toBeUndefined());
    withEmail(undefined, () => {
      expect(sessionEmail(config, limits)).toBeNull();
      expect(accountFor(limits, "main", { ...config, mainClaudeEmail: null })).toBeUndefined();
    });
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


test("terminal sessions use the active login directory, never the protected main email", () => {
  const config = testConfig({ mainClaudeEmail: "mike.cann@gmail.com", mainClaudeConfigDir: join(home, ".claude") });
  process.env.CLAUDECODE = "1";
  expect(sessionEmail(config, limits)).toBe("mike@cannstudios.com");
  expect(isSessionProvider("claude-cannstudios", config, limits)).toBe(true);
  expect(accountFor(limits, "main", config)?.email).toBe("mike@cannstudios.com");
  const gmail = fakeProvider("", "claude-gmail", "anthropic");
  const cann = fakeProvider("", "claude-cannstudios", "anthropic");
  expect(bestClaude([gmail, cann], config, limits)).toBeUndefined();
  // A concrete protected account remains available when it isn't this session.
  expect(isSessionProvider(gmail.id, config, limits)).toBe(false);
  process.env.CLAUDE_CONFIG_DIR = "/accounts/gmail";
  expect(sessionEmail(config, limits)).toBe("mike.cann@gmail.com");
  expect(bestClaude([gmail, cann], config, limits)?.id).toBe(cann.id);
  withEmail("unknown@example.com", () => expect(sessionEmail(config, limits)).toBe("unknown@example.com"));
  delete process.env.CLAUDECODE;
  expect(sessionEmail(config, limits)).toBeNull();
});

test("merged Claude accounts dedupe emails with user keys winning", () => {
  const path = join(tempDir(), "config.json");
  writeFileSync(path, JSON.stringify({ claudeAccounts: {
    "my-personal": { email: " MIKE@CANNSTUDIOS.COM " },
    "claude-gmail": { email: "custom@example.com" },
    "custom-alias": { email: "CUSTOM@example.com" },
  } }));
  const accounts = loadConfig(path).claudeAccounts;
  expect(accounts["claude-cannstudios"]).toBeUndefined();
  expect(accounts["my-personal"].email).toBe("mike@cannstudios.com");
  expect(accounts["claude-gmail"].email).toBe("custom@example.com");
  expect(accounts["custom-alias"]).toBeUndefined();
  expect(Object.values(accounts).filter((a) => a.email === "custom@example.com")).toHaveLength(1);
  expect(accounts["claude-convex"].employerOnly).toBe(true);
});

test("old cached logins still map to the default config directory", () => {
  const config = testConfig();
  mkdirSync(config.dataDir, { recursive: true });
  const old = { ...limits, generatedAt: new Date(Date.now() - 30 * 86400000).toISOString() };
  writeFileSync(cachePath(config), JSON.stringify(old));
  expect(findClaudeConfigDir("mike@cannstudios.com", config)).toBe(join(home, ".claude"));
  expect(findClaudeConfigDir("not-present@example.com", config)).toBeNull();
  expect(readCachedLimits(config)).toBeNull();
  process.env.CLAUDECODE = "1";
  expect(sessionEmail({ ...config, mainClaudeConfigDir: join(home, ".claude") })).toBe("mike@cannstudios.com");
  // The same mapping must work from Token Stats' own old snapshot.
  mkdirSync(config.tokenStatsDir, { recursive: true });
  writeFileSync(join(config.tokenStatsDir, "limits.json"), JSON.stringify(old));
  expect(findClaudeConfigDir("mike@cannstudios.com", { ...config, dataDir: tempDir() })).toBe(join(home, ".claude"));
});

test("every child drops parent Claude identity, host auth and API credentials", async () => {
  const dir = tempDir();
  const keys = ["CLAUDECODE", "CLAUDE_CODE_USER_EMAIL", "CLAUDE_CODE_ACCOUNT_UUID", "CLAUDE_CODE_ORGANIZATION_UUID",
    "CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH", "CLAUDE_CODE_OAUTH_SCOPES", "CLAUDE_CODE_MESSAGING_SOCKET", "CLAUDE_CODE_MESSAGING_TOKEN",
    "CLAUDE_CODE_HOST_SESSION_ID", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_FUTURE_VARIABLE", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"];
  const before = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) process.env[key] = "parent-value";
    const provider = fakeProvider('printf "unused"');
    const invocation = provider.invocation(context);
    const result = await runProcess({ ...invocation, command: process.execPath,
      args: ["-e", `console.log(JSON.stringify({leaked: Object.keys(process.env).filter(k => ${JSON.stringify(keys)}.includes(k)), child: process.env.DELEGATE_CHILD, dir: process.env.CLAUDE_CONFIG_DIR}))`],
      cwd: dir, env: { ...invocation.env, CLAUDE_CONFIG_DIR: "/chosen/login", CLAUDE_CODE_ENTRYPOINT: "override", ANTHROPIC_API_KEY: "override" },
      stdoutFile: join(dir, "out"), stderrFile: join(dir, "err"), timeoutMs: 5000 });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, "out"), "utf8"))).toEqual({ leaked: [], child: "1", dir: "/chosen/login" });
  } finally {
    for (const key of keys) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  }
});


test("null disables main-account protection without inventing a session identity", () => {
  const config = testConfig({ mainClaudeEmail: null });
  const gmail = fakeProvider("", "claude-gmail", "anthropic");
  expect(sessionEmail(config, limits)).toBeNull();
  expect(bestClaude([gmail], config, limits)?.id).toBe(gmail.id);
  expect(accountFor(limits, "main", config)).toBeUndefined();
});
