import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readlinkSync, realpathSync, symlinkSync } from "node:fs";
import { dirname, join, relative } from "node:path";

export type Workspace = {
  /** Where the delegate runs. Inside a snapshot this mirrors the caller's subfolder. */
  dir: string;
  kind: "snapshot" | "worktree" | "in-place";
  repoRoot?: string;
  worktree?: string;
  baseline?: string;
  branch?: string;
  /** Ignored dependency folders linked in from the caller's repo, kept out of the diff. */
  linked?: string[];
  notes: string[];
};

export type Changes = { files: string[]; stat: string; patch: string };

const MAX_UNTRACKED_BYTES = 20 * 1024 * 1024;

/**
 * Installed dependencies are ignored by git, so a fresh worktree has none and
 * nothing can build or test. Link the caller's copies in instead. The write
 * sandboxes block writes through the link, since it points outside the worktree.
 */
const LINKED_DEPENDENCY_DIRS = ["node_modules", ".venv"];

function git(cwd: string, args: string[], input?: string) {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", input, maxBuffer: 512 * 1024 * 1024 });
  return { ok: result.status === 0, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function mustGit(cwd: string, args: string[], input?: string): string {
  const result = git(cwd, args, input);
  if (!result.ok) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  return result.stdout;
}

export function repoRootOf(cwd: string): string | null {
  const result = git(cwd, ["rev-parse", "--show-toplevel"]);
  return result.ok ? result.stdout.trim() : null;
}

/**
 * Give the delegate its own copy of the repo: a worktree at HEAD plus the
 * caller's uncommitted and untracked changes, committed as a baseline so we
 * can tell exactly what the delegate changed. Read-only work uses a detached
 * snapshot that's thrown away; write work gets a `delegate/<id>` branch that
 * stays until `delegate clean`.
 */
export function prepareWorkspace(options: { cwd: string; mode: "read" | "write"; inPlace: boolean; id: string; dataDir: string }): Workspace {
  const repoRoot = repoRootOf(options.cwd);
  if (!repoRoot) {
    if (options.mode === "write") throw new Error(`${options.cwd} isn't a git repo, and write work needs one so its changes can be reviewed.`);
    return { dir: options.cwd, kind: "in-place", notes: [] };
  }
  if (options.inPlace) {
    if (options.mode === "write") throw new Error("--in-place is only for read-only work. Write work always gets its own worktree.");
    return { dir: options.cwd, kind: "in-place", repoRoot, notes: [] };
  }

  const worktree = join(options.dataDir, "worktrees", options.id);
  mkdirSync(dirname(worktree), { recursive: true });
  const branch = options.mode === "write" ? `delegate/${options.id}` : undefined;
  mustGit(repoRoot, ["worktree", "add", "--quiet", ...(branch ? ["-b", branch] : ["--detach"]), worktree, "HEAD"]);

  const notes: string[] = [];
  const patch = mustGit(repoRoot, ["diff", "HEAD", "--binary"]);
  if (patch.trim()) {
    const applied = git(worktree, ["apply", "--binary", "--whitespace=nowarn"], patch);
    if (!applied.ok) notes.push(`Couldn't copy your uncommitted changes into the snapshot, so it's at HEAD: ${applied.stderr.trim()}`);
  }
  const untracked = mustGit(repoRoot, ["ls-files", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean);
  let skipped = 0;
  for (const file of untracked) {
    const from = join(repoRoot, file);
    const to = join(worktree, file);
    try {
      const stat = lstatSync(from);
      if (stat.size > MAX_UNTRACKED_BYTES) { skipped++; continue; }
      mkdirSync(dirname(to), { recursive: true });
      if (stat.isSymbolicLink()) symlinkSync(readlinkSync(from), to);
      else copyFileSync(from, to);
    } catch { skipped++; }
  }
  if (skipped) notes.push(`Left ${skipped} untracked file(s) out of the snapshot (over 20 MB or unreadable).`);

  mustGit(worktree, ["add", "-A"]);
  mustGit(worktree, ["-c", "user.name=delegate", "-c", "user.email=delegate@localhost", "commit", "--quiet", "--no-verify", "--allow-empty", "-m", "delegate baseline"]);
  const baseline = mustGit(worktree, ["rev-parse", "HEAD"]).trim();

  const linked: string[] = [];
  for (const name of LINKED_DEPENDENCY_DIRS) {
    const from = join(repoRoot, name);
    const to = join(worktree, name);
    if (existsSync(from) && !existsSync(to)) {
      try { symlinkSync(from, to); linked.push(name); } catch {}
    }
  }

  // git reports the real path (e.g. /private/var on macOS), so compare like with like.
  const sub = relative(realpathSync(repoRoot), realpathSync(options.cwd));
  const dir = sub && !sub.startsWith("..") ? join(worktree, sub) : worktree;
  return { dir: existsSync(dir) ? dir : worktree, kind: branch ? "worktree" : "snapshot", repoRoot, worktree, baseline, branch, linked, notes };
}

/** Everything the delegate changed since the baseline, including anything it committed. */
export function workspaceChanges(ws: Workspace): Changes {
  if (!ws.worktree || !ws.baseline) return { files: [], stat: "", patch: "" };
  const exclude = (ws.linked ?? []).map((name) => `:(exclude)${name}`);
  mustGit(ws.worktree, ["add", "-A", "--", ".", ...exclude]);
  return {
    files: mustGit(ws.worktree, ["diff", "--cached", "--name-only", ws.baseline]).split("\n").filter(Boolean),
    stat: mustGit(ws.worktree, ["diff", "--cached", "--shortstat", ws.baseline]).trim(),
    patch: mustGit(ws.worktree, ["diff", "--cached", "--binary", ws.baseline]),
  };
}

export function removeWorktree(repoRoot: string, worktree: string, branch?: string) {
  git(repoRoot, ["worktree", "remove", "--force", worktree]);
  if (branch) git(repoRoot, ["branch", "-D", branch]);
}

/** Apply a delegate's patch to the caller's repo, falling back to a 3-way merge. */
export function applyPatch(repoRoot: string, patch: string): { ok: boolean; message: string } {
  if (!patch.trim()) return { ok: true, message: "Nothing to apply." };
  const direct = git(repoRoot, ["apply", "--binary", "--whitespace=nowarn"], patch);
  if (direct.ok) return { ok: true, message: "Applied cleanly." };
  const threeWay = git(repoRoot, ["apply", "--binary", "--3way", "--whitespace=nowarn"], patch);
  if (threeWay.ok) return { ok: true, message: "Applied with a 3-way merge. Check `git status` for conflicts." };
  return { ok: false, message: threeWay.stderr.trim() || direct.stderr.trim() };
}
