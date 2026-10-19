import { describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { accountFor, headroom, parseLimitsText } from "./limits.ts";
import { allowedProviderIds, isEmployerWork, policyRefusal } from "./policy.ts";
import { limitsFixture, tempDir, testConfig } from "./test-helpers.ts";

const providers = [{ id: "codex" }, { id: "grok" }, { id: "claude-gmail" }, { id: "claude-convex", employerOnly: true }];

describe("employer policy", () => {
  const config = testConfig();

  test("a get-convex remote is employer work", () => {
    expect(isEmployerWork("/tmp", config, ["https://github.com/get-convex/stack.git"])).toBe(true);
    expect(isEmployerWork("/tmp", config, ["git@github.com:get-convex/convex.git"])).toBe(true);
    expect(isEmployerWork("/tmp", config, ["ssh://git@ssh.github.com:443/get-convex/backend.git"])).toBe(true);
    expect(isEmployerWork("/tmp", config, ["ssh://git@github.com:443/get-convex/backend.git"])).toBe(true);
  });

  test("Mike's own repos about Convex aren't", () => {
    expect(isEmployerWork("/tmp", config, ["https://github.com/mikecann/convex-playground-local.git"])).toBe(false);
  });

  test("folders listed under employer paths count, including subfolders", () => {
    const root = tempDir();
    mkdirSync(join(root, "videos", "one"), { recursive: true });
    const withPath = testConfig({ employer: { ...config.employer!, paths: [join(root, "videos")] } });
    expect(isEmployerWork(join(root, "videos", "one"), withPath, [])).toBe(true);
    expect(isEmployerWork(root, withPath, [])).toBe(false);
  });

  test("a worktree of an employer folder still counts, wherever the worktree lives", () => {
    const root = tempDir();
    const withPath = testConfig({ employer: { ...config.employer!, paths: [join(root, "work")] } });
    expect(isEmployerWork("/somewhere/else/.delegate/worktrees/x", withPath, [], join(root, "work", "repo"))).toBe(true);
  });

  test("employer work only goes to the allow list", () => {
    expect(allowedProviderIds("/tmp", config, providers, true)).toEqual(["claude-convex"]);
    expect(policyRefusal("codex", "/tmp", config, providers, true)).toContain("Convex work");
  });

  test("employer-only accounts never see other work", () => {
    expect(allowedProviderIds("/tmp", config, providers, false)).toEqual(["codex", "grok", "claude-gmail"]);
    expect(policyRefusal("claude-convex", "/tmp", config, providers, false)).toContain("reserved");
  });
});

describe("limits", () => {
  const config = testConfig({ tokenStatsDir: "/ts", mainClaudeConfigDir: "/home/me/.claude" });

  test("parses Token Stats' text output", () => {
    const text = `Codex Pro mike.cann@gmail.com [~/.codex]
  Weekly: 94% left resets Thu 2:21 pm
  64,390 credits · 2 limit resets available
Claude Team mike.cann@convex.dev [claude-2]
  5-hour: 100% left
  Weekly: 97% left resets Wed 12:00 am
  Weekly Fable: 100% left resets Wed 12:00 am
Claude Max mike.cann@gmail.com [claude-1]
  5-hour: 76% left resets in 1h 47m
  $250 allowance: 53% left $132.79 left, resets Thu 3:59 pm
Grok  mike.cann@gmail.com [~/.grok]
  Weekly: 100% left resets Wed 2:53 pm
Muse Power Usage mike.cann@gmail.com [~/.config/muse]
  Muse didn't report usage this time.`;
    const accounts = parseLimitsText(text, config);
    expect(accounts.map((a) => a.provider)).toEqual(["Codex", "Claude", "Claude", "Grok", "Muse"]);
    expect(accounts[0].plan).toBe("Pro");
    expect(accounts[0].windows[0]).toMatchObject({ kind: "weekly", remainingPercent: 94, resetsText: "resets Thu 2:21 pm" });
    expect(accounts[1].configDir).toBe("/ts/Accounts/claude-2");
    expect(accounts[1].windows.map((w) => w.kind)).toEqual(["five_hour", "weekly", "weekly_model"]);
    expect(accounts[2].windows[1].kind).toBe("allowance");
    expect(accounts[3].plan).toBeNull();
    expect(accounts[4]).toMatchObject({ plan: "Power Usage", windows: [] });
    expect(accounts[4].notice).toContain("didn't report");
  });

  test("maps providers to accounts and finds the tightest window", () => {
    const limits = limitsFixture();
    expect(accountFor(limits, "main", config)?.email).toBe("me@main.com");
    expect(accountFor(limits, "claude-gmail", config)?.configDir).toBe("/x/claude-1");
    expect(headroom(accountFor(limits, "main", config))?.percent).toBe(78);
    expect(headroom(accountFor(limits, "muse", config))).toBeNull();
  });
});
