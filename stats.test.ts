import { expect, test } from "bun:test";
import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { historyPath } from "./limits.ts";
import { collectStats, formatStats, weekSegments } from "./stats.ts";
import { tempDir, testConfig } from "./test-helpers.ts";

const NOW = new Date("2026-10-20T12:00:00Z");
const SINCE = new Date("2026-10-13T12:00:00Z");
const at = (iso: string) => new Date(iso).toISOString();

const jsonl = (rows: unknown[]) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";

function assistant(id: string, timestamp: string, usage: Record<string, number>, content: unknown[] = [], extra: Record<string, unknown> = {}) {
  return { type: "assistant", entrypoint: "claude-desktop", timestamp, isSidechain: false, message: { id, model: "claude-opus-5-5", usage, content }, ...extra };
}

/** Synthetic transcripts in the layout Claude Code uses: <project>/<session>.jsonl and <session>/subagents/agent-*.jsonl. */
function projectsFixture(): string {
  const root = tempDir("delegate-projects-");
  const project = join(root, "-Users-me-dev-app");
  mkdirSync(join(project, "s1", "subagents"), { recursive: true });
  const u = { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 100, cache_creation_input_tokens: 5 };
  writeFileSync(join(project, "s1.jsonl"), jsonl([
    { type: "user", entrypoint: "claude-desktop", timestamp: "2026-10-19T00:00:00Z", message: { content: "hi" } },
    // The same message logged once per content block must count once.
    assistant("m1", "2026-10-19T00:00:01Z", u, [{ type: "thinking" }]),
    assistant("m1", "2026-10-19T00:00:01Z", u, [{ type: "tool_use", name: "Agent", input: { description: "x" } }]),
    assistant("m2", "2026-10-19T00:00:02Z", u, [{ type: "tool_use", name: "Bash", input: { command: "delegate run --to codex --brief -" } }]),
    assistant("m3", "2026-10-19T00:00:03Z", u, [{ type: "tool_use", name: "Bash", input: { command: "cd x && delegate consensus 'q'" } }]),
    { type: "user", timestamp: "2026-10-19T00:00:04Z", message: { content: [{ type: "tool_result", is_error: true, content: "Blocked by the delegate hook. Main account is low." }] } },
    // Quoting the hook text in a normal result isn't a block.
    { type: "user", timestamp: "2026-10-19T00:00:05Z", message: { content: [{ type: "tool_result", content: "it said Blocked by the delegate hook" }] } },
    // Before the window: ignored.
    assistant("m0", "2026-10-01T00:00:00Z", { input_tokens: 1_000_000, output_tokens: 0 }),
    "not json",
  ]));
  writeFileSync(join(project, "s1", "subagents", "agent-a1.jsonl"), jsonl([
    assistant("sa1", "2026-10-19T00:00:02Z", { input_tokens: 1000, output_tokens: 0 }, [], { isSidechain: true }),
  ]));
  const terminal = join(root, "-Users-me-dev-tool");
  mkdirSync(terminal);
  writeFileSync(join(terminal, "s2.jsonl"), jsonl([assistant("t1", "2026-10-18T00:00:00Z", { input_tokens: 7, output_tokens: 3 }, [], { entrypoint: "cli" })]));
  // Employer folders must never be read: this file would add huge numbers if it were.
  const employer = join(root, "-Users-me-dev-convex-backend");
  mkdirSync(employer);
  writeFileSync(join(employer, "s3.jsonl"), jsonl([assistant("c1", "2026-10-19T00:00:00Z", { input_tokens: 9e9, output_tokens: 9e9 })]));
  // Old files are skipped by mtime without being opened.
  writeFileSync(join(terminal, "old.jsonl"), jsonl([assistant("o1", "2026-10-19T00:00:00Z", { input_tokens: 5e9, output_tokens: 0 }, [], { entrypoint: "cli" })]));
  utimesSync(join(terminal, "old.jsonl"), new Date("2026-09-01"), new Date("2026-09-01"));
  return root;
}

function dataFixture() {
  const config = testConfig({ mainClaudeEmail: "me@main.com" });
  mkdirSync(join(config.dataDir, "consensus", "20261019-021201-consensus-2be2"), { recursive: true });
  mkdirSync(join(config.dataDir, "consensus", "20261001-021201-consensus-aaaa"), { recursive: true });
  const main = (t: string, weekly: number, five = 50) => ({ at: at(t), accounts: [
    { provider: "Claude", email: "me@main.com", windows: { weekly, five_hour: five } },
    { provider: "Codex", email: "x@y.com", windows: { weekly: weekly + 10 } },
  ] });
  writeFileSync(historyPath(config), jsonl([
    main("2026-10-10T00:00:00Z", 99), // before the window
    main("2026-10-14T00:00:00Z", 60),
    main("2026-10-15T00:00:00Z", 30, 4),
    main("2026-10-16T00:00:00Z", 8),
    main("2026-10-17T00:00:00Z", 100), // weekly reset
    main("2026-10-18T00:00:00Z", 70),
  ]));
  writeFileSync(join(config.dataDir, "runs.jsonl"), jsonl([
    { id: "r1", provider: "codex", kind: "implement", status: "ok", durationMs: 60_000, tokens: 1000, cwd: "/work/a", startedAt: "2026-10-19T00:00:00Z" },
    { id: "r2", provider: "codex", kind: "review", status: "failed", durationMs: 180_000, tokens: 500, cwd: "/work/a", startedAt: "2026-10-19T01:00:00Z" },
    { id: "r3", provider: "grok", kind: "ask", status: "ok", durationMs: 30_000, cwd: "/work/b", startedAt: "2026-10-19T02:00:00Z" },
    { id: "r0", provider: "muse", kind: "ask", status: "ok", durationMs: 1, startedAt: "2026-10-01T00:00:00Z" },
  ]));
  return config;
}

test("collects accounts, runs and sessions from synthetic data", async () => {
  const config = dataFixture();
  const stats = await collectStats(config, { since: SINCE, until: NOW, projectsDir: projectsFixture() });

  const main = stats.accounts.find((a) => a.main)!;
  expect(main.account).toBe("Claude me@main.com");
  expect(main.weeks.map((w) => [w.start, w.end, w.low])).toEqual([[60, 8, 8], [100, 70, 70]]);
  expect(main.ranOut).toEqual([{ window: "five_hour", at: at("2026-10-15T00:00:00Z") }]);
  expect(Object.values(main.lowestPerDay!)).toContain(8);

  expect(stats.runs!.total).toBe(3);
  expect(stats.runs!.consensus).toBe(1);
  const codex = stats.runs!.byProvider.find((p) => p.provider === "codex")!;
  expect(codex).toMatchObject({ runs: 2, tokens: 1500, medianMs: 120_000, kinds: { implement: 1, review: 1 } });
  expect(stats.runs!.notOk).toEqual([{ id: "r2", provider: "codex", status: "failed" }]);
  expect(stats.runs!.topFolders[0]).toEqual({ folder: "/work/a", runs: 2 });

  const s = stats.sessions!;
  expect(s.skippedFolders).toBe(1);
  const desktop = s.byEntrypoint["claude-desktop"];
  expect(desktop.sessions).toBe(1);
  expect(desktop.byModel["claude-opus-5-5"]).toEqual({ input: 30 + 1000, output: 60, cacheRead: 300, cacheCreation: 15 });
  expect(desktop).toMatchObject({ subagentCalls: 1, subagentTokens: 1000, delegateRuns: 1, delegateConsensus: 1, hookBlocks: 1 });
  expect(s.byEntrypoint.cli.sessions).toBe(1);
  expect(s.byEntrypoint.cli.byModel["claude-opus-5-5"].input).toBe(7);
  expect(s.top[0]).toMatchObject({ session: "s1", tokens: 1405, subagentTokens: 1000 });

  expect(stats.ratio).toContain("75% of handed-off jobs went to delegates (3 delegate runs vs 1 built-in");
  const text = formatStats(stats);
  expect(text.split("\n").length).toBeLessThan(80);
  expect(text).toContain("60% → 8% (low 8%); reset, then 100% → 70% (low 70%)");
  expect(text).toContain("five_hour");
  expect(text).not.toContain("9.00B");
});

test("missing files give no data rather than errors", async () => {
  const config = testConfig();
  const stats = await collectStats(config, { since: SINCE, until: NOW, projectsDir: join(tempDir(), "nope") });
  expect(stats.accounts).toEqual([]);
  expect(stats.runs).toBeNull();
  expect(stats.sessions).toBeNull();
  const text = formatStats(stats);
  expect(text.match(/^no data$/gm)).toHaveLength(3);
});

test("a big rise in the weekly window starts a new week", () => {
  const s = (p: number) => ({ at: new Date(), windows: { weekly: p } });
  expect(weekSegments([s(50), s(40), s(45), s(95), s(90)]).map((w) => [w.start, w.end, w.low])).toEqual([[50, 45, 40], [95, 90, 90]]);
});
