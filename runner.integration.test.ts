import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runDelegate, formatRun } from "./runner.ts";
import { applyPatch } from "./workspace.ts";
import { fakeProvider, git, tempDir, tempRepo, testConfig } from "./test-helpers.ts";

describe("runDelegate", () => {
  test("read-only runs see uncommitted and untracked changes, and stray writes are thrown away", async () => {
    const repo = tempRepo();
    writeFileSync(join(repo, "a.txt"), "edited\n");
    writeFileSync(join(repo, "new.txt"), "untracked\n");
    const config = testConfig();
    const provider = fakeProvider('cat a.txt new.txt; echo vandal > a.txt; grep -q "read-only" "$PROMPT_FILE" && echo saw-preamble');
    const record = await runDelegate({ provider, kind: "review", brief: "look", cwd: repo }, config);

    expect(record.status).toBe("ok");
    expect(record.workspace).toBe("snapshot");
    const output = readFileSync(join(record.runDir, "output.md"), "utf8");
    expect(output).toContain("edited");
    expect(output).toContain("untracked");
    expect(output).toContain("saw-preamble");
    expect(record.strayWrites).toEqual(["a.txt"]);
    expect(readFileSync(join(repo, "a.txt"), "utf8")).toBe("edited\n");
    expect(existsSync(record.worktree!)).toBe(false);
    expect(formatRun(record)).toContain("despite being read-only");
  });

  test("runs from a subfolder start in the same subfolder of the snapshot", async () => {
    const repo = tempRepo();
    const record = await runDelegate({ provider: fakeProvider("cat b.txt"), kind: "ask", brief: "x", cwd: join(repo, "sub") }, testConfig());
    expect(readFileSync(join(record.runDir, "output.md"), "utf8")).toContain("two");
  });

  test("write runs keep a branch, record only the delegate's changes, and apply back cleanly", async () => {
    const repo = tempRepo();
    writeFileSync(join(repo, "a.txt"), "mine\n");
    const config = testConfig();
    const provider = fakeProvider('echo "added by delegate" > c.txt; echo done');
    const record = await runDelegate({ provider, kind: "implement", brief: "add c", cwd: repo }, config);

    expect(record.mode).toBe("write");
    expect(record.branch).toStartWith("delegate/");
    expect(record.changedFiles).toEqual(["c.txt"]);
    expect(existsSync(record.worktree!)).toBe(true);
    expect(existsSync(join(repo, "c.txt"))).toBe(false);

    const patch = readFileSync(join(record.runDir, "changes.patch"), "utf8");
    expect(patch).not.toContain("mine");
    expect(applyPatch(repo, patch).ok).toBe(true);
    expect(readFileSync(join(repo, "c.txt"), "utf8")).toBe("added by delegate\n");
    expect(readFileSync(join(repo, "a.txt"), "utf8")).toBe("mine\n");
  });

  test("node_modules is linked in for builds and kept out of the diff", async () => {
    const repo = tempRepo();
    writeFileSync(join(repo, ".gitignore"), "node_modules/\n");
    git(repo, "add", "-A"); git(repo, "commit", "-qm", "ignore");
    mkdirSync(join(repo, "node_modules", "dep"), { recursive: true });
    writeFileSync(join(repo, "node_modules", "dep", "index.js"), "module.exports = 1\n");
    const record = await runDelegate({ provider: fakeProvider("cat node_modules/dep/index.js && echo y > e.txt"), kind: "implement", brief: "x", cwd: repo }, testConfig());
    expect(readFileSync(join(record.runDir, "output.md"), "utf8")).toContain("module.exports");
    expect(record.changedFiles).toEqual(["e.txt"]);
  });

  test("changes a delegate commits anyway are still captured", async () => {
    const repo = tempRepo();
    const provider = fakeProvider('echo x > d.txt && git add d.txt && git -c user.name=t -c user.email=t@t commit -qm sneaky && echo ok');
    const record = await runDelegate({ provider, kind: "implement", brief: "x", cwd: repo }, testConfig());
    expect(record.changedFiles).toEqual(["d.txt"]);
  });

  test("timeouts kill the whole process group", async () => {
    const dir = tempDir();
    const marker = join(dir, "still-running");
    const provider = fakeProvider(`(sleep 3; touch ${marker}) & sleep 30`);
    const record = await runDelegate({ provider, kind: "ask", brief: "x", cwd: dir, timeoutMs: 500 }, testConfig());
    expect(record.status).toBe("timeout");
    await Bun.sleep(3500);
    expect(existsSync(marker)).toBe(false);
  });

  test("write runs outside a git repo are refused", async () => {
    await expect(runDelegate({ provider: fakeProvider("echo"), kind: "implement", brief: "x", cwd: tempDir() }, testConfig())).rejects.toThrow("isn't a git repo");
  });

  test("--no-repo runs in an empty folder", async () => {
    const repo = tempRepo();
    const record = await runDelegate({ provider: fakeProvider("ls | wc -l"), kind: "ask", brief: "x", cwd: repo, noRepo: true }, testConfig());
    expect(readFileSync(join(record.runDir, "output.md"), "utf8").trim()).toBe("0");
  });

  test("a failing provider reports its stderr", async () => {
    const record = await runDelegate({ provider: fakeProvider("echo boom >&2; exit 3"), kind: "ask", brief: "x", cwd: tempDir() }, testConfig());
    expect(record.status).toBe("failed");
    expect(record.error).toContain("boom");
  });

  test("parallel snapshots of one repo don't trip over each other", async () => {
    const repo = tempRepo();
    git(repo, "status");
    const config = testConfig();
    const runs = await Promise.all([1, 2, 3, 4].map(() => runDelegate({ provider: fakeProvider("cat a.txt"), kind: "ask", brief: "x", cwd: repo }, config)));
    expect(runs.map((r) => r.status)).toEqual(["ok", "ok", "ok", "ok"]);
  });
});
