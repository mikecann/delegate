import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { runDelegate } from "./runner.ts";
import { fakeProvider, git, tempDir, testConfig } from "./test-helpers.ts";

function cli(dataDir: string, ...args: string[]) {
  const config = join(tempDir(), "config.json");
  writeFileSync(config, JSON.stringify({ dataDir }));
  return spawnSync(join(import.meta.dir, "delegate"), args, { encoding: "utf8", env: { ...process.env, DELEGATE_CONFIG: config } });
}

describe("delegate clean", () => {
  test("refuses ids that would escape the worktrees folder", () => {
    const dataDir = join(tempDir(), "data");
    mkdirSync(join(dataDir, "worktrees"), { recursive: true });
    writeFileSync(join(dataDir, "keep-me"), "precious");
    const result = cli(dataDir, "clean", "..");
    expect(result.stderr).toContain("not a run id");
    expect(existsSync(join(dataDir, "keep-me"))).toBe(true);
  });

  test("skips runs that are still going", () => {
    const dataDir = join(tempDir(), "data");
    const id = "20260101-000000-codex-abcd";
    mkdirSync(join(dataDir, "worktrees", id), { recursive: true });
    mkdirSync(join(dataDir, "runs", id), { recursive: true });
    writeFileSync(join(dataDir, "runs", id, "status.json"), JSON.stringify({ id, status: "running", pid: process.pid, runDir: join(dataDir, "runs", id) }));
    expect(cli(dataDir, "clean", "--all").stdout).toContain("still running");
    expect(existsSync(join(dataDir, "worktrees", id))).toBe(true);
  });

  test("cleans worktrees from interrupted runs that have no record", () => {
    const repo = tempDir("delegate-repo-");
    git(repo, "init", "-q", "-b", "main");
    writeFileSync(join(repo, "a.txt"), "x\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "init");
    const dataDir = join(tempDir(), "data");
    const id = "20260101-000000-grok-dead";
    mkdirSync(join(dataDir, "worktrees"), { recursive: true });
    git(repo, "worktree", "add", "-q", "--detach", join(dataDir, "worktrees", id), "HEAD");
    expect(cli(dataDir, "clean", "--all").stdout).toContain(`cleaned ${id}`);
    expect(existsSync(join(dataDir, "worktrees", id))).toBe(false);
    expect(git(repo, "worktree", "list").trim().split("\n")).toHaveLength(1);
  });
});

describe("repos with no commits", () => {
  test("providers without real read-only need --in-place there too", async () => {
    const repo = tempDir();
    git(repo, "init", "-q");
    const loose = { ...fakeProvider("echo hi"), enforcesReadOnly: false };
    const record = await runDelegate({ provider: loose, kind: "review", brief: "x", cwd: repo }, testConfig());
    expect(record.status).toBe("failed");
    expect(record.error).toContain("--in-place");
  });
});
