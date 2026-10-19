import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { Config } from "./config.ts";
import { runProcess } from "./process.ts";
import type { Kind, Provider } from "./providers.ts";
import { buildPrompt, capText, formatDuration, formatTokens, stripSignoff } from "./text.ts";
import { prepareWorkspace, removeWorktree, workspaceChanges, type Workspace } from "./workspace.ts";

export type RunStatus = "running" | "ok" | "failed" | "timeout" | "cancelled" | "empty";

export type RunRecord = {
  id: string;
  provider: string;
  kind: Kind;
  mode: "read" | "write";
  status: RunStatus;
  error?: string;
  cwd: string;
  repoRoot?: string;
  workspace: Workspace["kind"];
  worktree?: string;
  branch?: string;
  baseline?: string;
  /** Read-only runs that changed files anyway (the changes were thrown away). */
  strayWrites?: string[];
  changedFiles?: string[];
  changeStat?: string;
  notes: string[];
  exitCode: number | null;
  durationMs: number;
  tokens?: number;
  costUsd?: number;
  startedAt: string;
  runDir: string;
  /** Set while running, so `clean` can tell a live run from an interrupted one. */
  pid?: number;
};

export type RunOptions = {
  provider: Provider;
  kind: Kind;
  brief: string;
  cwd: string;
  write?: boolean;
  inPlace?: boolean;
  /** Run in an empty folder, with no repo access at all. */
  noRepo?: boolean;
  timeoutMs?: number;
  model?: string;
  effort?: string;
  top?: boolean;
  maxWords?: number;
  /** Groups runs under a parent folder, e.g. one consensus. */
  parentDir?: string;
  label?: string;
};

/** Read-only snapshots in flight, removed if we exit early (Ctrl+C, a fatal error). */
const liveSnapshots = new Map<string, string>();
process.on("exit", () => {
  for (const [worktree, repoRoot] of liveSnapshots) removeWorktree(repoRoot, worktree);
});

export function newId(prefix: string): string {
  const now = new Date();
  const stamp = now.toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
  return `${stamp}-${prefix}-${randomBytes(2).toString("hex")}`;
}

export async function runDelegate(options: RunOptions, config: Config): Promise<RunRecord> {
  const mode = options.write || options.kind === "implement" ? "write" : "read";
  const id = newId(options.label ?? options.provider.id);
  const runDir = join(options.parentDir ?? join(config.dataDir, "runs"), id);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "brief.md"), options.brief);
  // Written before the worktree exists, so `clean --all` never mistakes this run for an abandoned one.
  writeFileSync(join(runDir, "status.json"), JSON.stringify({
    id, provider: options.provider.id, kind: options.kind, mode, status: "running", pid: process.pid,
    cwd: options.cwd, workspace: "in-place", worktree: join(config.dataDir, "worktrees", id), notes: [],
    exitCode: null, durationMs: 0, startedAt: new Date().toISOString(), runDir,
  } satisfies RunRecord, null, 2));

  let ws: Workspace;
  try {
    if (options.noRepo) {
      if (mode === "write") throw new Error("--no-repo is only for read-only work.");
      const empty = join(runDir, "empty");
      mkdirSync(empty, { recursive: true });
      ws = { dir: empty, kind: "in-place", notes: [] };
    } else {
      ws = prepareWorkspace({
        cwd: options.cwd, mode, inPlace: !!options.inPlace, id, dataDir: config.dataDir,
        linkDependencies: mode === "read" || options.provider.sandboxesWrites,
        enforcesReadOnly: options.provider.enforcesReadOnly,
      });
    }
  } catch (e) {
    // Report setup problems as a failed run rather than throwing, so a consensus
    // panel carries on without this panellist and there's always a status.json.
    const record: RunRecord = {
      id, provider: options.provider.id, kind: options.kind, mode, status: "failed", error: (e as Error).message,
      cwd: options.cwd, workspace: "in-place", notes: [], exitCode: null, durationMs: 0, startedAt: new Date().toISOString(), runDir,
    };
    writeFileSync(join(runDir, "status.json"), JSON.stringify(record, null, 2));
    return record;
  }
  if (mode === "read" && ws.worktree && ws.repoRoot) liveSnapshots.set(ws.worktree, ws.repoRoot);

  const promptFile = join(runDir, "prompt.md");
  const outputFile = join(runDir, "output.md");
  const prompt = buildPrompt(options.brief, { kind: options.kind, mode, dir: ws.dir, snapshot: ws.kind !== "in-place", maxWords: options.maxWords });
  writeFileSync(promptFile, prompt);

  const ctx = { dir: ws.dir, mode, kind: options.kind, prompt, promptFile, outputFile, model: options.model, effort: options.effort, top: options.top } as const;
  const invocation = options.provider.invocation(ctx);
  writeFileSync(join(runDir, "command.json"), JSON.stringify({ command: invocation.command, args: invocation.args, cwd: ws.dir }, null, 2));

  const startedAt = new Date().toISOString();
  const timeoutMs = options.timeoutMs ?? config.timeoutMinutes[mode] * 60_000;
  const proc = await runProcess({
    command: invocation.command,
    args: invocation.args,
    env: invocation.env,
    stdin: invocation.stdin,
    cwd: ws.dir,
    stdoutFile: join(runDir, "stdout.log"),
    stderrFile: join(runDir, "stderr.log"),
    timeoutMs,
  });

  const stdout = readFileSync(join(runDir, "stdout.log"), "utf8");
  const parsed = options.provider.parse(stdout, ctx);
  parsed.text = stripSignoff(parsed.text);
  if (parsed.text) writeFileSync(outputFile, parsed.text + "\n");

  let status: RunStatus = "ok";
  let error = parsed.error;
  if (proc.cancelled) status = "cancelled";
  else if (proc.timedOut) { status = "timeout"; error = `Timed out after ${formatDuration(timeoutMs)} and was stopped.`; }
  else if (proc.exitCode !== 0) {
    status = "failed";
    error = [parsed.error, lastLines(join(runDir, "stderr.log"), 5)].filter(Boolean).join("\n") || `exited with code ${proc.exitCode}`;
  } else if (!parsed.text) { status = "empty"; error ??= "The delegate finished without a final message."; }
  else if (parsed.error) status = "failed";

  const record: RunRecord = {
    id, provider: options.provider.id, kind: options.kind, mode, status, error,
    cwd: options.cwd, repoRoot: ws.repoRoot, workspace: ws.kind, worktree: ws.worktree, branch: ws.branch, baseline: ws.baseline,
    notes: ws.notes, exitCode: proc.exitCode, durationMs: proc.durationMs,
    tokens: parsed.tokens, costUsd: parsed.costUsd, startedAt, runDir,
  };

  if (ws.worktree && ws.repoRoot) {
    try {
      const changes = workspaceChanges(ws);
      if (mode === "write") {
        record.changedFiles = changes.files;
        record.changeStat = changes.stat;
        writeFileSync(join(runDir, "changes.patch"), changes.patch);
      } else if (changes.files.length) {
        record.strayWrites = changes.files;
      }
    } catch (e) {
      record.notes.push(`Couldn't read the delegate's changes: ${(e as Error).message}`);
    }
    if (mode === "read") {
      removeWorktree(ws.repoRoot, ws.worktree);
      liveSnapshots.delete(ws.worktree);
    }
  }

  writeFileSync(join(runDir, "status.json"), JSON.stringify(record, null, 2));
  try {
    appendFileSync(join(config.dataDir, "runs.jsonl"), JSON.stringify({
      id, provider: record.provider, kind: record.kind, status, durationMs: record.durationMs,
      tokens: record.tokens, costUsd: record.costUsd, cwd: record.cwd, startedAt,
    }) + "\n");
  } catch {}
  return record;
}

function lastLines(path: string, n: number): string {
  try { return readFileSync(path, "utf8").trim().split("\n").slice(-n).join("\n"); } catch { return ""; }
}

/** A run that says it's running and whose delegate process is still alive. */
export function isLive(record: RunRecord): boolean {
  if (record.status !== "running" || !record.pid) return false;
  try { process.kill(record.pid, 0); return true; } catch { return false; }
}

export function readOutput(record: RunRecord): string {
  try { return readFileSync(join(record.runDir, "output.md"), "utf8").trim(); } catch { return ""; }
}

export function statusLine(record: RunRecord): string {
  const parts = [record.id, record.provider, record.kind, record.status, formatDuration(record.durationMs), formatTokens(record.tokens)];
  return parts.filter(Boolean).join(" · ");
}

/** What the orchestrator sees: a status line, the capped answer and where everything else is. */
export function formatRun(record: RunRecord, limits = { lines: 80, chars: 6000 }): string {
  const out: string[] = [`delegate: ${statusLine(record)}`];
  if (record.error) out.push(`error: ${record.error}`);
  for (const note of record.notes) out.push(`note: ${note}`);
  if (record.strayWrites?.length) out.push(`note: it changed ${record.strayWrites.length} file(s) despite being read-only; those changes were thrown away.`);
  const answer = readOutput(record);
  if (answer) {
    const capped = capText(answer, limits.lines, limits.chars);
    out.push("", capped.text);
    if (capped.truncated) out.push("", `[cut short: ${capped.totalLines} lines in total. Full answer: ${join(record.runDir, "output.md")}]`);
  }
  out.push("");
  if (record.mode === "write") {
    if (record.changedFiles?.length) {
      out.push(`changes: ${record.changeStat} (${record.changedFiles.slice(0, 8).join(", ")}${record.changedFiles.length > 8 ? ", ..." : ""})`);
      out.push(`review: delegate diff ${record.id}   apply: delegate apply ${record.id}   discard: delegate clean ${record.id}`);
    } else {
      out.push("changes: none");
    }
  }
  out.push(`files: ${record.runDir}`);
  return out.join("\n");
}

export function exitCodeFor(status: RunStatus): number {
  return { running: 1, ok: 0, failed: 1, empty: 1, timeout: 124, cancelled: 130 }[status];
}
