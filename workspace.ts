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
export function prepareWorkspace(options: {
  cwd: string; mode: "read" | "write"; inPlace: boolean; id: string; dataDir: string;
  /** Link the caller's node_modules/.venv in. Only safe when the provider sandboxes writes. */
  linkDependencies?: boolean;
  /** The provider's read-only mode really stops writes, so running in place is safe. */
  enforcesReadOnly?: boolean;
}): Workspace {
  const repoRoot = repoRootOf(options.cwd);
  if (!repoRoot) {
    if (options.mode === "write") throw new Error(`${options.cwd} isn't a git repo, and write work needs one so its changes can be reviewed.`);
    if (!options.inPlace && !options.enforcesReadOnly) {
      throw new Error(`${options.cwd} isn't a git repo, so there's nothing to snapshot, and this provider's read-only mode doesn't reliably stop writes. ` +
        "Pass --in-place to let it work on these files anyway, or --no-repo if it doesn't need them.");
    }
    return { dir: options.cwd, kind: "in-place", notes: [] };
  }
  if (!git(repoRoot, ["rev-parse", "--verify", "--quiet", "HEAD"]).ok) {
    if (options.mode === "write") throw new Error(`${repoRoot} has no commits yet. Make a first commit so the delegate's changes can be reviewed.`);
    return { dir: options.cwd, kind: "in-place", repoRoot, notes: ["This repo has no commits yet, so the delegate ran in your working tree."] };
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
  let baseline: string;
  const linked: string[] = [];
  try {
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
    if (existsSync(join(repoRoot, ".gitmodules"))) notes.push("This repo has submodules, and they aren't included in the snapshot.");

    mustGit(worktree, ["add", "-A"]);
    mustGit(worktree, [
      "-c", "user.name=delegate", "-c", "user.email=delegate@localhost", "-c", "commit.gpgsign=false",
      "commit", "--quiet", "--no-verify", "--allow-empty", "-m", "delegate baseline",
    ]);
    baseline = mustGit(worktree, ["rev-parse", "HEAD"]).trim();

    if (options.linkDependencies) {
      for (const name of LINKED_DEPENDENCY_DIRS) {
        const from = join(repoRoot, name);
        const to = join(worktree, name);
        if (existsSync(from) && !existsSync(to)) {
          try { symlinkSync(from, to); linked.push(name); } catch {}
        }
      }
    } else if (options.mode === "write" && LINKED_DEPENDENCY_DIRS.some((name) => existsSync(join(repoRoot, name)))) {
      notes.push("Your node_modules/.venv weren't linked in, because this provider's writes aren't sandboxed. It can install its own in the worktree.");
    }
  } catch (error) {
    removeWorktree(repoRoot, worktree, branch);
    throw error;
  }

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

/**
 * Apply a delegate's patch to the caller's repo. It only applies if it applies
 * cleanly, unless threeWay is set, which merges and can leave conflict markers.
 */
export function applyPatch(repoRoot: string, patch: string, threeWay = false): { ok: boolean; message: string } {
  if (!patch.trim()) return { ok: true, message: "Nothing to apply." };
  if (threeWay) {
    const merged = git(repoRoot, ["apply", "--binary", "--3way", "--whitespace=nowarn"], patch);
    return merged.ok
      ? { ok: true, message: "Applied with a 3-way merge." }
      : { ok: false, message: `${merged.stderr.trim()}\nResolve the conflict markers, then \`git add\` the files.` };
  }
  const check = git(repoRoot, ["apply", "--check", "--binary", "--whitespace=nowarn"], patch);
  if (!check.ok) {
    return { ok: false, message: `It doesn't apply cleanly, so nothing was changed:\n${check.stderr.trim()}\nRun it again with --3way to merge it, which may leave conflict markers.` };
  }
  const applied = git(repoRoot, ["apply", "--binary", "--whitespace=nowarn"], patch);
  return applied.ok ? { ok: true, message: "Applied cleanly." } : { ok: false, message: applied.stderr.trim() };
}

/** The repo a worktree belongs to, for cleaning up worktrees whose run record is gone. */
export function repoOfWorktree(worktree: string): string | null {
  const result = git(worktree, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  return result.ok ? dirname(result.stdout.trim()) : null;
}
