import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, closeSync, openSync } from "node:fs";

export type ProcessResult = {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  cancelled: boolean;
  durationMs: number;
};

export type ProcessOptions = {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  stdin?: string;
  stdoutFile: string;
  stderrFile: string;
  timeoutMs: number;
};

const KILL_GRACE_MS = 10_000;
const live = new Set<ChildProcess>();
let cancelled = false;

/** Kill a child and everything it started. Each child leads its own process group. */
function killGroup(child: ChildProcess, signal: NodeJS.Signals) {
  if (child.pid === undefined || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try { child.kill(signal); } catch {}
  }
}

function onParentSignal(signal: NodeJS.Signals) {
  cancelled = true;
  for (const child of live) killGroup(child, "SIGTERM");
  setTimeout(() => {
    for (const child of live) killGroup(child, "SIGKILL");
    process.exit(signal === "SIGINT" ? 130 : 143);
  }, 2_000).unref();
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => onParentSignal(signal));
}

/**
 * Run a command in its own process group with output going straight to files,
 * so a huge transcript never sits in memory. On timeout the whole group gets
 * SIGTERM, then SIGKILL if it hasn't gone after a grace period.
 */
export function runProcess(options: ProcessOptions): Promise<ProcessResult> {
  const started = Date.now();
  const out = openSync(options.stdoutFile, "w");
  const err = openSync(options.stderrFile, "w");
  return new Promise((resolve) => {
    let timedOut = false;
    let settled = false;
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["pipe", out, err],
      detached: true,
    });
    live.add(child);

    const timer = setTimeout(() => {
      timedOut = true;
      killGroup(child, "SIGTERM");
      setTimeout(() => killGroup(child, "SIGKILL"), KILL_GRACE_MS).unref();
    }, options.timeoutMs);

    const finish = (exitCode: number | null, signal: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      live.delete(child);
      closeSync(out);
      closeSync(err);
      resolve({ exitCode, signal, timedOut, cancelled, durationMs: Date.now() - started });
    };

    child.on("error", (error) => {
      try { appendFileSync(options.stderrFile, `\n${error.message}\n`); } catch {}
      finish(127, null);
    });
    child.on("close", (code, signal) => finish(code, signal));

    child.stdin?.on("error", () => {});
    child.stdin?.end(options.stdin ?? "");
  });
}
