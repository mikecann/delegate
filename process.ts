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

/**
 * Signal a child's whole process group. The group outlives its leader, so this
 * still reaches children it left behind after it exited.
 */
function signalGroup(pid: number | undefined, signal: NodeJS.Signals | 0): boolean {
  if (pid === undefined) return false;
  try { process.kill(-pid, signal); return true; } catch { return false; }
}

/** SIGTERM the group, wait for it to go, then SIGKILL whatever is left. */
async function reapGroup(pid: number | undefined, graceMs: number) {
  if (!signalGroup(pid, 0)) return;
  signalGroup(pid, "SIGTERM");
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline && signalGroup(pid, 0)) await Bun.sleep(100);
  signalGroup(pid, "SIGKILL");
}

function onParentSignal(signal: NodeJS.Signals) {
  cancelled = true;
  for (const child of live) signalGroup(child.pid, "SIGTERM");
  setTimeout(() => {
    for (const child of live) signalGroup(child.pid, "SIGKILL");
    process.exit(signal === "SIGINT" ? 130 : 143);
  }, 2_000).unref();
}

// However we exit (a fatal error, process.exit in a command), take the delegates with us.
process.on("exit", () => {
  for (const child of live) signalGroup(child.pid, "SIGKILL");
});

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => onParentSignal(signal));
}

/**
 * Run a command in its own process group with output going straight to files,
 * so a huge transcript never sits in memory. On timeout the whole group gets
 * SIGTERM, then SIGKILL if it hasn't gone after a grace period. Anything still
 * in the group when the leader exits is reaped the same way.
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
      signalGroup(child.pid, "SIGTERM");
      setTimeout(() => signalGroup(child.pid, "SIGKILL"), KILL_GRACE_MS).unref();
    }, options.timeoutMs);

    const finish = async (exitCode: number | null, signal: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Whatever the leader left running (servers, watchers, children that
      // ignored SIGTERM) goes too, before we report back.
      await reapGroup(child.pid, timedOut ? KILL_GRACE_MS : 2_000);
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
